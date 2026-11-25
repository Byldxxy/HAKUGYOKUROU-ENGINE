import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './Game.css';
import OfflineRollPreference from '../../components/OfflineRollPreference';
import NotebookRecap from './NotebookRecap';
import HostApiPanel from '../../components/HostApiPanel';
import RelationGraph from '../../components/RelationGraph';
import { useCampaignNotebook } from './useCampaignNotebook';
import { apiFetch, apiUrl } from '../../config';
import type { Character, PublicPlayer, Message, GameCharacter, RollRules } from '../../domain/types';
import { socketRequest, socketErrorMessage, ensureSocketConnected, socket } from '../../socket';
import {
  parseRollRequests,
  parseStatDirectives,
  stripDirectives,
  type RollRequest,
} from '../../domain/directives';

type RollRequestWithState = RollRequest & {
  id?: string;
  characterId?: string;
  originalPlayer?: string;
  rules?: RollRules;
  resolved?: boolean;
  result?: string;
};

type TurnState = {
  retryMessage?: string;
  canRetry?: boolean;
  mode: 'waiting_players' | 'waiting_rolls' | 'waiting_dm' | 'completed';
  inputLocked: boolean;
  actedPlayers: string[];
  pendingPlayers: string[];
  pendingRollPlayers: string[];
  rollRequests: Array<RollRequestWithState & {
    id: string;
    resolved: boolean;
    result: string;
  }>;
  pendingRolls: Array<RollRequestWithState & {
    id: string;
    resolved: boolean;
    result: string;
  }>;
};

type CampaignState = {
  recap?: Array<{round: number; logIndex: number; text: string; kind: string}>;
  scenarioId: string;
  chapterId: string;
  title: string;
  phase: 'active' | 'completed' | 'redirected';
  inventory?: Array<{ group: 'card' | 'story' | 'shared'; name: string }>;
  revealedClues: Array<{ id: string; title: string; content: string }>;
  ending: { id: string; label: string } | null;
};

// SECTION: 检定结果查找
// NOTE: 新日志优先按 rollId 匹配；旧日志没有 rollId 时，用“角色 + 技能”兼容历史数据。
const findRollResult = (messages: Message[], dmIndex: number, roll: RollRequestWithState) => {
  if (roll.result) return roll.result;

  for (let index = dmIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'dm') break;
    if (message.role !== 'roll') continue;

    const content = String(message.content || '');
    if ((roll.id && message.rollId === roll.id) ||
      (message.sender.trim() === roll.player.trim() && content.startsWith(`[对 ${roll.skill} 进行检定]`))) {
      return content;
    }
  }

  return '';
};

export default function Game() {
  const navigate = useNavigate();
  const { roomId } = useParams();

  // SECTION: UI 状态
  // NOTE: activeCard 控制角色详情弹窗；myCharacter 是当前客户端唯一的“我”。
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [myCharacter, setMyCharacter] = useState<GameCharacter | null>(null);

  // SECTION: 战役笔记状态
  // NOTE: 关系图状态提升到 Game，避免切换笔记页签时节点和边丢失。
  const [isNotebookOpen, setIsNotebookOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'relation' | 'notes' | 'clues' | 'inventory' | 'recap'>('relation');
  const { freeNotes, setFreeNotes, clues, setClues, graphNodes, setGraphNodes, graphEdges, setGraphEdges,
    ready: notebookReady, error: notebookError, flush: flushNotebook } = useCampaignNotebook(roomId);

  // SECTION: 聊天与回合状态
  // NOTE: turnState 来自后端，是输入锁和等待提示的权威来源。
  const [inputText, setInputText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectionReady, setConnectionReady] = useState(false);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [turnState, setTurnState] = useState<TurnState | null>(null);
  const [campaignState, setCampaignState] = useState<CampaignState | null>(null);

  // SECTION: 手动存档
  // NOTE: 当前存档以房间日志为主体，服务端按登录会话归属存档。
  const handleSaveGame = async () => {
    const saveName = window.prompt('请输入存档名称：', `战役_${new Date().toLocaleDateString()}`);
    if (!saveName) return;

    try {
      await flushNotebook();
      const res = await apiFetch('/api/saves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, saveName })
      });
      const data = await res.json();
      if (data.success) {
        alert('💾 ' + data.message);
      } else {
        alert('存档失败：' + data.error);
      }
    } catch {
      alert('网络连接断开，存档请求失败！');
    }
  };

  // SECTION: 检定同步锁
  // NOTE: rolledIndices 只处理“点击后、广播回来前”的短暂窗口；刷新后的去重由后端 rollId 保证。
  const [rolledIndices, setRolledIndices] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // SECTION: 聊天自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // SECTION: Socket 事件绑定
  // NOTE: new_message 只追加聊天；turn_state 只更新状态，二者职责分离。
  useEffect(() => {
    ensureSocketConnected();
    const handleNewMessage = (msg: Message) => {
      setChatMessages(prev => [...prev, msg]);
    };
    const handleTurnState = (state: TurnState) => {
      setTurnState(state);
    };
    const handleCampaignState = (state: CampaignState) => {
      setCampaignState(state);
    };
    socket.on('new_message', handleNewMessage);
    socket.on('turn_state', handleTurnState);
    socket.on('campaign_state', handleCampaignState);
    const handleSnapshot = (data: { roomId: string; messages: Message[]; campaign: CampaignState; turnState: TurnState }) => {
      if (data.roomId !== roomId) return;
      setChatMessages(data.messages);
      setCampaignState(data.campaign);
      setTurnState(data.turnState);
      setRolledIndices([]);
      setConnectionReady(true);
    };
    const join = async () => {
      try {
        const { characterId } = await socketRequest('join_room', { roomId, flushNotebook: true });
        if (characterId) { localStorage.setItem('trpg_current_char_id', characterId); setSelectedId(characterId); }
      }
      catch (error) { alert((error as Error).message); navigate('/hall', { replace: true }); }
    };
    const disconnected = () => setConnectionReady(false);
    const sessionError = (data: { reason: string }) => { alert(socketErrorMessage(data.reason)); navigate('/hall', { replace: true }); };
    socket.on('room_snapshot', handleSnapshot);
    socket.on('connect', join);
    socket.on('disconnect', disconnected);
    socket.on('session_error', sessionError);
    if (socket.connected) void join();
    return () => {
      socket.off('room_snapshot', handleSnapshot);
      socket.off('connect', join);
      socket.off('disconnect', disconnected);
      socket.off('session_error', sessionError);
      socket.off('new_message', handleNewMessage);
      socket.off('turn_state', handleTurnState);
      socket.off('campaign_state', handleCampaignState);
    };
  }, [roomId, navigate]);

  // SECTION: 玩家普通行动
  // NOTE: 普通行动不带 isRoll，后端会把它纳入“本轮已行动玩家”统计。
  const handleSendMessage = async () => {
    if (!inputText.trim() || !connectionReady) return;
    const sent = inputText;
    try {
      await socketRequest('player_action', { roomId, message: sent });
      setInputText(current => current === sent ? '' : current);
    } catch (error) { alert((error as Error).message); }
  };

  // 检定数值、技能与随机数均由服务端计算。
  const handleSkillRoll = async (rollId: string) => {
    if (!connectionReady || !turnState?.pendingRolls.some(roll => roll.id === rollId && roll.characterId === myCharacter?.id) || rolledIndices.includes(rollId)) return;
    setRolledIndices(prev => [...prev, rollId]);
    try { await socketRequest('player_action', { roomId, rollId, isRoll: true }); }
    catch (error) { alert((error as Error).message); }
    finally { setRolledIndices(prev => prev.filter(id => id !== rollId)); }
  };

  // SECTION: 当前出战角色加载
  // NOTE: 大厅只存当前角色 ID，游戏页必须重新拉完整角色卡用于技能和属性检定。
  useEffect(() => {
    const fetchCharacter = async () => {
      if (!selectedId) return;
      try {
        const res = await apiFetch('/api/characters');
        const data = await res.json();
        if (data.success) {
          const targetChar = data.cards.find((c: Character) => c.id === selectedId);
          if (targetChar) {
            const full = targetChar.fullData;
            const parsedSkills: Record<string, number> = {};
            (full.skills || []).forEach((s: Character['fullData']['skills'][number]) => {
              const shortName = s.name.split(' ')[0];
              parsedSkills[shortName] = s.base + (s.job || 0) + (s.interest || 0) + (s.grow || 0);
            });

            if (full.stats) {
              parsedSkills['力量'] = full.stats.str;
              parsedSkills['体质'] = full.stats.con;
              parsedSkills['体型'] = full.stats.siz;
              parsedSkills['敏捷'] = full.stats.dex;
              parsedSkills['外貌'] = full.stats.app;
              parsedSkills['智力'] = full.stats.int;
              parsedSkills['灵感'] = full.stats.int;
              parsedSkills['意志'] = full.stats.pow;
              parsedSkills['教育'] = full.stats.edu;
              parsedSkills['幸运'] = full.stats.luc;
              parsedSkills['理智'] = targetChar.san;
              parsedSkills['SAN'] = targetChar.san;
            }

            setMyCharacter({
              id: targetChar.id, avatar: full.avatar,
              name: full.basicInfo.name,
              role: full.basicInfo.occupation || '未知职业',
              appearance: full.bgInfo?.description || '这个调查员很神秘，没有留下任何外貌描述。',
              hp: { current: targetChar.hp, max: targetChar.hp },
              san: { current: targetChar.san, max: full.stats.pow },
              mp: { current: targetChar.mp, max: targetChar.mp },
              skills: parsedSkills
            });
          }
        }
      } catch (error) {
        console.error('拉取角色卡失败:', error);
      }
    };

    fetchCharacter();
  }, [selectedId]);

  // SECTION: 队友状态镜像
  // NOTE: lobby_update 是房间玩家列表的广播源，游戏页用它生成左侧队友卡片。
  const [offlineRoll, setOfflineRoll] = useState<boolean>();
  const [isOwner, setIsOwner] = useState(false);
  const [teammates, setTeammates] = useState<GameCharacter[]>([]);

  useEffect(() => {
    const handleLobbyUpdate = (data: { players: PublicPlayer[]; ownerId?: string }) => {
      setIsOwner(data.ownerId === socket.id);
      setOfflineRoll(data.players.find(player => player.id === socket.id)?.offlineRoll);
      const selfId = localStorage.getItem('trpg_current_char_id');
      setTeammates(data.players.filter(p => p.characterId !== selfId).map(p => ({
        id: p.characterId || p.name, avatar: p.avatarPath ? apiUrl(p.avatarPath) : undefined, name: p.name, role: p.role, appearance: '', skills: {},
        hp: { current: p.hp, max: p.hpMax }, san: { current: p.san, max: p.sanMax }, mp: { current: p.mp, max: p.mpMax },
      })));
      const self = data.players.find(p => p.characterId === selfId);
      if (self) setMyCharacter(current => current ? ({ ...current,
        hp: { current: self.hp, max: self.hpMax }, san: { current: self.san, max: self.sanMax }, mp: { current: self.mp, max: self.mpMax },
      }) : current);
    };

    socket.on('lobby_update', handleLobbyUpdate);
    if (myCharacter?.id && connectionReady) void socketRequest('sync_character', { roomId }).catch(() => {});
    return () => { socket.off('lobby_update', handleLobbyUpdate); };
  }, [myCharacter?.id, connectionReady, roomId]);

  // SECTION: 线索提取
  // NOTE: 右键选中文本会写入关键线索列表，随后由笔记防抖保存。
  const handleContextMenu = (e: React.MouseEvent) => {
    const selectedText = window.getSelection()?.toString().trim();
    if (selectedText && notebookReady) {
      e.preventDefault();
      setClues(prev => prev.includes(selectedText) ? prev : [...prev, selectedText]);
      alert(`已成功提取线索: "${selectedText.substring(0, 10)}..."`);
    }
  };

  // SECTION: 角色卡弹窗内容
  // NOTE: 自己能看完整技能，队友只显示表观信息。
  const renderModalContent = () => {
    if (activeCard === 'self' && myCharacter) {
      return (
        <>
          <h3 className="modal-title">{myCharacter.name} - 完整角色卡</h3>
          {myCharacter.avatar && <img className="card-portrait" src={myCharacter.avatar} alt={myCharacter.name + '的头像'} />}
          <p className="modal-desc"><strong>职业：</strong>{myCharacter.role}</p>
          <p className="modal-desc"><strong>外貌：</strong>{myCharacter.appearance}</p>
          <div className="stat-divider"></div>
          <p className="modal-desc"><strong>技能列表：</strong></p>
          <div className="skill-grid">
            {Object.entries(myCharacter.skills).map(([key, value]) => (
              <div key={key} className="skill-tag">{key}: {String(value)}</div>
            ))}
          </div>
        </>
      );
    } else if (activeCard) {
      const mate = teammates.find(t => t.id === activeCard);
      if (mate) return (
        <>
          <h3 className="modal-title">队友观察：{mate.name}</h3>
          {mate.avatar && <img className="card-portrait" src={mate.avatar} alt={mate.name + '的头像'} />}
          <p className="modal-desc"><strong>表观职业：</strong>{mate.role}</p>
          <p className="modal-desc"><strong>外貌描述：</strong>{mate.appearance}</p>
          <p className="modal-warning">※ 你无法查看对方的具体技能点数。</p>
        </>
      );
    }
    return null;
  };
  if (!myCharacter) {
    return (
      <div className="game-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <h2>📡 正在同步调查员 [神经链路] 与 [核心数据]...</h2>
      </div>
    );
  }

  // SECTION: 本地回合兜底推导
  // NOTE: 后端 turn_state 未抵达时，前端仍可用聊天历史推导基础锁定状态。
  const allPlayers = [myCharacter.name, ...teammates.map(t => t.name)];
  const playerDisplayNames = new Map<string, string>([
    [myCharacter.name, myCharacter.name],
    ...teammates.map(t => [t.name, t.name] as [string, string])
  ]);
  const lastDmIndex = chatMessages.map(m => m.role).lastIndexOf('dm');
  const currentRoundMessages = chatMessages.slice(lastDmIndex + 1);
  const actedPlayers = Array.from(new Set(currentRoundMessages.map(m => m.sender)));
  const pendingPlayers = turnState?.pendingPlayers || allPlayers.filter(name => !actedPlayers.includes(name));
  const pendingPlayerLabels = pendingPlayers.map(name => playerDisplayNames.get(name) || name);
  const activeActedPlayers = turnState?.actedPlayers || actedPlayers;
  const isMyTurnDone = activeActedPlayers.includes(myCharacter.name);

  const lastDmMessage = lastDmIndex !== -1 ? String(chatMessages[lastDmIndex]?.content || '') : '';
  const fallbackRollRequests: RollRequestWithState[] = parseRollRequests(lastDmMessage).map((roll) => ({
    ...roll,
    id: `${lastDmIndex}-${roll.index}-${roll.player}-${roll.skill}`,
  }));
  const activeRollRequests = turnState?.rollRequests || fallbackRollRequests;
  const pendingRolls = turnState?.pendingRolls || activeRollRequests.filter(roll => !findRollResult(chatMessages, lastDmIndex, roll));
  const pendingRollPlayers = turnState?.pendingRollPlayers || Array.from(new Set(pendingRolls.map(roll => roll.player)));
  const isWaitingForMyRoll = pendingRolls.some(roll => roll.characterId === myCharacter.id);
  const isRollGateLocked = activeRollRequests.length > 0;
  const isCampaignLocked = Boolean(campaignState && campaignState.phase !== 'active');
  // NOTE: 输入锁优先使用后端 turn_state；本地历史推导只作为重连前的兜底。
  const isTurnLocked = turnState
    ? (
      (turnState.mode === 'waiting_dm' && activeRollRequests.length === 0) ||
      (turnState.mode === 'waiting_players' && isMyTurnDone)
    )
    : (isMyTurnDone);
  const isInputLocked = !connectionReady || isCampaignLocked || isRollGateLocked || isTurnLocked;

  // SECTION: 输入提示文案
  // NOTE: 文案优先级为检定锁、回合锁、可自由行动。
  let inputPlaceholder = "描述你的行动、语言，或心理活动（Shift+Enter 换行）...";
  if (isCampaignLocked) {
    inputPlaceholder = campaignState?.ending
      ? '本章已经结束。'
      : '当前章节已进入结算状态。';
  } else if (isRollGateLocked) {
    if (isWaitingForMyRoll) {
      inputPlaceholder = "请先完成上方检定...";
    } else if (pendingRollPlayers.length > 0) {
      inputPlaceholder = `等待 ${pendingRollPlayers.join('、')} 掷骰...`;
    } else {
      inputPlaceholder = "等待系统 DM 结算检定...";
    }
  } else if (isTurnLocked) {
    if (pendingPlayers.length > 0) {
      inputPlaceholder = `等待 ${pendingPlayerLabels.join('、')} 行动...`;
    } else {
      inputPlaceholder = "队伍行动完毕，等待系统 DM 推进剧情...";
    }
  }

  return (
    <div className="game-container">
      <div className="game-header flat-box">
        <span className="room-info">{campaignState?.title || '桃花岛历险记'} // {roomId}</span>
        <div style={{ display: 'flex', gap: '15px' }}>
          {isOwner && roomId && <HostApiPanel roomId={roomId} />}
          <button className="flat-btn secondary small" onClick={handleSaveGame}>存档</button>
          <button className="flat-btn secondary small" onClick={async () => { try { await socketRequest('leave_room', { roomId }); navigate('/hall'); } catch (error) { alert((error as Error).message); } }}>退出</button>
        </div>
      </div>

      <div className="game-body">
        <aside className="game-sidebar">
          <div className="flat-box my-character-panel">
            <div
              className="avatar-box clickable"
              onClick={() => setActiveCard('self')}
              title="点击查看完整角色卡"
            >
              {myCharacter.avatar && <img src={myCharacter.avatar} alt="" className="game-portrait" />}
              <span className={myCharacter.avatar ? 'portrait-name' : undefined}>{myCharacter.name}</span>
            </div>
            <div className="stats-board">
              <div className="stat-item">
                <span className="stat-label">HP</span>
                <div className="stat-bar-bg"><div className="stat-bar-fill hp" style={{ width: `${(myCharacter.hp.current/myCharacter.hp.max)*100}%` }}></div></div>
                <span style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 'bold', color: '#A0858D', minWidth: '45px', textAlign: 'right', display: 'inline-block', marginLeft: '10px' }}>{myCharacter.hp.current}/{myCharacter.hp.max}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">SAN</span>
                <div className="stat-bar-bg"><div className="stat-bar-fill san" style={{ width: `${(myCharacter.san.current/myCharacter.san.max)*100}%` }}></div></div>
                <span style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 'bold', color: '#A0858D', minWidth: '45px', textAlign: 'right', display: 'inline-block', marginLeft: '10px' }}>{myCharacter.san.current}/{myCharacter.san.max}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">MP</span>
                <div className="stat-bar-bg"><div className="stat-bar-fill mp" style={{ width: `${(myCharacter.mp.current/myCharacter.mp.max)*100}%` }}></div></div>
                <span style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 'bold', color: '#A0858D', minWidth: '45px', textAlign: 'right', display: 'inline-block', marginLeft: '10px' }}>{myCharacter.mp.current}/{myCharacter.mp.max}</span>
              </div>
            </div>
            <button
              className="flat-btn secondary notebook-btn"
              onClick={() => setIsNotebookOpen(true)}
            >
              📓 打开战役笔记
            </button>
            {roomId && <OfflineRollPreference roomId={roomId} enabled={connectionReady ? offlineRoll : undefined} />}
          </div>
          <div className="teammates-section">
            <h4 className="section-subtitle">小队成员</h4>
            {teammates.map(mate => (
              <div key={mate.id} className="flat-box teammate-card">
                <div
                  className="teammate-name clickable"
                  onClick={() => setActiveCard(mate.id)}
                  title="点击观察外貌"
                >
                  {mate.name} <span className="teammate-role">({mate.role})</span>
                </div>
                <div className="teammate-mini-stats">
                  <span className="mini-stat hp">HP {mate.hp.current}/{mate.hp.max}</span>
                  <span className="mini-stat san">SAN {mate.san.current}/{mate.san.max}</span>
                  <span className="mini-stat mp">MP {mate.mp.current}/{mate.mp.max}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>
        <main className="game-main flat-box">
          <div className="chat-history" onContextMenu={handleContextMenu}>
            {chatMessages.map((msg, idx) => {
              const messageContent = String(msg.content || '');
              const parsedRolls = parseRollRequests(messageContent);
              // NOTE: 最新 DM 优先使用后端带 rollId 的 turn_state，历史 DM 用本地解析结果。
              const rolls: RollRequestWithState[] = idx === lastDmIndex && turnState
                ? turnState.rollRequests
                : parsedRolls.map((roll) => ({
                  ...roll,
                  rules: msg.rollRules?.[roll.index],
                  id: `${msg.logIndex ?? idx}-${roll.index}-${roll.player}-${roll.skill}`,
                }));
              const stats = parseStatDirectives(messageContent);
              const hasRoll = rolls.length > 0;
              const hasStat = stats.length > 0;

              if (msg.role === 'dm' && (hasRoll || hasStat)) {
                // NOTE: DM 正文展示时剥离控制指令，避免玩家看到协议噪声。
                const pureText = stripDirectives(messageContent);

                return (
                  <div id={msg.logIndex === undefined ? undefined : `log-message-${msg.logIndex}`} tabIndex={-1} key={idx} className="message dm">
                    <span className="sender-name">系统 DM</span>
                    <div className="message-content">
                      {pureText}
                      {stats.length > 0 && (
                        <div className="stat-change-list">
                          {stats.map((st, sIdx) => (
                            <span key={sIdx} className={`stat-change ${st.rawValue.startsWith('-') ? 'negative' : 'positive'}`}>
                              ⚠️ {st.player} 的 {st.type} {st.rawValue}
                            </span>
                          ))}
                        </div>
                      )}
                      {rolls.map((rollItem, rIdx) => {
                         const targetSkill = rollItem.skill;
                         const targetPlayer = rollItem.player;
                         // NOTE: rollKey 是本地按钮锁的键；后端仍以 rollId 做最终去重。
                         const rollKey = rollItem.id || `${idx}-${rollItem.index ?? rIdx}-${targetPlayer}-${targetSkill}`;
                         const rollResult = findRollResult(chatMessages, idx, rollItem);
                         const isRolling = rolledIndices.includes(rollKey);

                         return (
                           <div key={rIdx} className="roll-request">
                             <span className="roll-request-title">
                               [系统判定] 需要 {targetPlayer} 进行【{targetSkill}】检定
                             </span>

                             {rollItem.rules && <div className="roll-target">
                               {{regular:'常规', hard:'困难', extreme:'极难'}[rollItem.rules.difficulty]} · 目标 ≤ {rollItem.rules.target}
                               {rollItem.rules.modifier !== 0 && ` · ${Math.abs(rollItem.rules.modifier)} 枚${rollItem.rules.modifier > 0 ? '奖励骰' : '惩罚骰'}`}
                             </div>}
                             {rollResult ? (
                               <div className="roll-result">
                                 {rollResult}
                               </div>
                             ) : rollItem.characterId === myCharacter.id && idx === lastDmIndex ? (
                               <button
                                 className="flat-btn primary"
                                 onClick={() => handleSkillRoll(rollKey)}
                                 disabled={isRolling || !connectionReady || idx !== lastDmIndex || !turnState?.pendingRolls.some(roll => roll.id === rollKey)}
                               >
                                 {isRolling ? '同步中...' : '🎲 立即检定'}
                               </button>
                             ) : (
                               <span className="roll-waiting">{idx === lastDmIndex ? `⏳ 等待 ${targetPlayer} 掷骰…` : '本轮已结束'}</span>
                             )}
                           </div>
                         );
                      })}
                    </div>
                  </div>
                );
              }
              if (msg.role === 'roll') return null;

              return (
                <div id={msg.logIndex === undefined ? undefined : `log-message-${msg.logIndex}`} tabIndex={-1} key={idx} className={`message ${msg.role}`}>
                  <span className="sender-name">{msg.sender}</span>
                  <div className="message-content">{msg.content}</div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          <div className="control-panel" style={{ flexDirection: 'column', gap: '10px' }}>
            {turnState?.canRetry && (
              <button className="flat-btn secondary" onClick={() => socketRequest('retry_dm', { roomId }).catch(error => alert(error.message))}>
                {turnState.retryMessage || '主持回复失败'} 点击重试
              </button>
            )}

            <div className="composer-row">
              <textarea
                className="flat-textarea"
                placeholder={inputPlaceholder}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isInputLocked}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isInputLocked) handleSendMessage();
                  }
                }}
              ></textarea>

              <button
                className="flat-btn primary send-btn"
                onClick={handleSendMessage}
                disabled={isInputLocked}
              >
                执行
              </button>
            </div>
          </div>
        </main>
      </div>
      {activeCard && (
        <div className="modal-overlay" onClick={() => setActiveCard(null)}>
          <div className="modal-content flat-box" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" aria-label="关闭角色卡" onClick={() => setActiveCard(null)}>×</button>
            {renderModalContent()}
          </div>
        </div>
      )}
      {isNotebookOpen && (
        <div className="modal-overlay" onClick={() => setIsNotebookOpen(false)}>
          <div className="notebook-modal flat-box" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" aria-label="关闭战役笔记" onClick={() => setIsNotebookOpen(false)}>×</button>
            <div className="notebook-tabs">
              {([['relation', '关系图谱'], ['notes', '自由笔记'], ['clues', '关键线索'], ['inventory', '物品栏'], ['recap', '上次跑到哪了']] as const).map(([tab, label]) => (
                <button type="button" key={tab} aria-pressed={activeTab === tab}
                  className={`tab-item ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{label}</button>
              ))}
            </div>
            <div className="notebook-content">
              {activeTab === 'recap' && <NotebookRecap entries={campaignState?.recap ?? []} onJump={index => {
                setIsNotebookOpen(false);
                window.requestAnimationFrame(() => {
                  const message = document.getElementById(`log-message-${index}`);
                  message?.focus({ preventScroll: true });
                  message?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                });
              }} />}
              {activeTab === 'inventory' && (
                <div className="notebook-inventory">
                  {!connectionReady || !campaignState?.inventory ? <p role="status">正在同步物品…</p> :
                    ([['card', '角色卡自带'], ['story', '剧情所得'], ['shared', '队伍共有']] as const).map(([group, title]) => {
                      const items = campaignState.inventory!.filter(item => item.group === group);
                      return <section key={group}>
                        <h3>{title}</h3>
                        {items.length ? <ul>{items.map((item, i) => <li key={i}>{item.name}</li>)}</ul> : <p>暂无物品</p>}
                      </section>;
                    })}
                </div>
              )}
              {['notes', 'clues', 'relation'].includes(activeTab) && (!notebookReady || notebookError) && (
                <p role="status">{notebookError || '正在同步个人笔记…'}</p>
              )}
              {activeTab === 'notes' && notebookReady && (
                <textarea
                  className="flat-textarea full-height"
                  value={freeNotes}
                  onChange={(e) => setFreeNotes(e.target.value)}
                  placeholder="在这里自由记录跑团灵感、疑问或吐槽..."
                />
              )}

              {activeTab === 'clues' && (
                <div className="clues-list">
                  <p className="clues-hint">※ 在右侧游戏对话区选中文本并「右键」，即可自动提取到此处。</p>
                  {campaignState?.revealedClues.map((clue) => (
                    <div key={clue.id} className="clue-item campaign-clue-item">
                      <strong>{clue.title}</strong>
                      <span>{clue.content}</span>
                    </div>
                  ))}
                  {clues.length === 0 && !campaignState?.revealedClues.length ? (
                    <div className="empty-state">暂无关键线索</div>
                  ) : (
                    clues.map((clue, idx) => (
                      <div key={idx} className="clue-item">
                        <span className="clue-idx">({idx + 1})</span> {clue}
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'relation' && notebookReady && (
                <RelationGraph
                  nodes={graphNodes} setNodes={setGraphNodes}
                  edges={graphEdges} setEdges={setGraphEdges}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
