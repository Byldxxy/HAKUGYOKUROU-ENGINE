import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './Game.css';
import './TurnControls.css';
import './GameHistory.css';
import { useRoomHistory, type HistorySnapshot } from './useRoomHistory';
import { useGameReadingPosition } from './useGameReadingPosition';
import { useChatEnter } from '../../components/useChatEnter';
import GameSidebar from './GameSidebar';
import NotebookRecap from './NotebookRecap';
import NotebookConflictPanel from './NotebookConflictPanel';
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
  turnId: number;
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

const describeRollRules = (rules: RollRules) => {
  const difficulty = { regular: '常规', hard: '困难', extreme: '极难' }[rules.difficulty];
  const dice = rules.modifier ? ` · ${Math.abs(rules.modifier)} 枚${rules.modifier > 0 ? '奖励骰' : '惩罚骰'}` : '';
  return `${difficulty} · 目标 ≤ ${rules.target}${dice}`;
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

  return messages[dmIndex].followingRolls?.find(message => (roll.id && message.rollId === roll.id) ||
    (message.sender.trim() === roll.player.trim() && message.content.startsWith(`[对 ${roll.skill} 进行检定]`)))?.content || '';
};

export default function Game() {
  const { roomId } = useParams();
  const account = localStorage.getItem('trpg_username');
  const draftKey = 'trpg_action:' + JSON.stringify([account, roomId]);
  return <RoomGame key={draftKey} roomId={roomId} draftKey={draftKey} />;
}

function RoomGame({ roomId, draftKey }: { roomId?: string; draftKey: string }) {
  const navigate = useNavigate();

  // SECTION: UI 状态
  // NOTE: activeCard 控制角色详情弹窗；myCharacter 是当前客户端唯一的“我”。
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [characterError, setCharacterError] = useState('');
  const [characterAttempt, setCharacterAttempt] = useState(0);
  const [myCharacter, setMyCharacter] = useState<GameCharacter | null>(null);

  // SECTION: 战役笔记状态
  // NOTE: 关系图状态提升到 Game，避免切换笔记页签时节点和边丢失。
  const [isNotebookOpen, setIsNotebookOpen] = useState(false);
  const [excerptNotice, setExcerptNotice] = useState('');
  useEffect(() => {
    if (!excerptNotice) return;
    const timer = window.setTimeout(() => setExcerptNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [excerptNotice]);
  const [activeTab, setActiveTab] = useState<'relation' | 'notes' | 'clues' | 'inventory' | 'recap'>('relation');
  const { freeNotes, setFreeNotes, clues, setClues, graphNodes, setGraphNodes, graphEdges, setGraphEdges,
    ready: notebookReady, error: notebookError, conflict: notebookConflict, resolveConflict, flush: flushNotebook } = useCampaignNotebook(roomId);

  // SECTION: 聊天与回合状态
  // NOTE: turnState 来自后端，是输入锁和等待提示的权威来源。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectionReady, setConnectionReady] = useState(false);
  const history = useRoomHistory(roomId);
  const { live, cursor, interrupt, snapshot } = history;
  const chatMessages = history.page.messages;
  const [syncError, setSyncError] = useState('');
  const retrySync = useRef<() => void>(() => {});
  const [turnState, setTurnState] = useState<TurnState | null>(null);
  const [campaignState, setCampaignState] = useState<CampaignState | null>(null);

  // SECTION: 手动存档
  // NOTE: 当前存档以房间日志为主体，服务端按登录会话归属存档。
  const handleSaveGame = async () => {
    if (notebookConflict) {
      setIsNotebookOpen(true);
      setActiveTab('notes');
      return;
    }
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
    } catch (error) {
      alert(error instanceof Error ? error.message : '存档请求失败，请重试。');
    }
  };

  // SECTION: 检定同步锁
  // NOTE: rolledIndices 只处理“点击后、广播回来前”的短暂窗口；刷新后的去重由后端 rollId 保证。
  const [rolledIndices, setRolledIndices] = useState<string[]>([]);
  const { historyRef, reviewing, unread, onHistoryScroll, returnToLatest, jumpToSource, keepPosition, cancelPosition } =
    useGameReadingPosition(chatMessages, history.arrivals, Boolean(myCharacter), history.archive);

  // SECTION: Socket 事件绑定
  // NOTE: new_message 只追加聊天；turn_state 只更新状态，二者职责分离。
  useEffect(() => {
    ensureSocketConnected();
    let active = true;
    const handleNewMessage = live;
    const handleTurnState = (state: TurnState) => {
      setTurnState(state);
    };
    const handleCampaignState = (state: CampaignState) => {
      setCampaignState(state);
    };
    socket.on('new_message', handleNewMessage);
    socket.on('turn_state', handleTurnState);
    socket.on('campaign_state', handleCampaignState);
    const handleSnapshot = async (data: HistorySnapshot & { roomId: string; campaign: CampaignState; turnState: TurnState }) => {
      if (data.roomId !== roomId) return;
      setSyncError('');
      setCampaignState(data.campaign);
      setTurnState(data.turnState);
      setRolledIndices([]);
      try {
        if (await snapshot(data) && active) setConnectionReady(true);
      } catch (error) {
        if (active) { setSyncError((error as Error).message); setConnectionReady(false); }
      }
    };
    const join = async () => {
      try {
        const { characterId } = await socketRequest('join_room', { roomId, flushNotebook: true, historyVersion: 1, afterSeq: cursor.current });
        if (active && characterId) { localStorage.setItem('trpg_current_char_id', characterId); setSelectedId(characterId); }
      }
      catch (error) {
        if (!active || !socket.connected) return;
        if (['forbidden', 'not_started', 'invalid_character'].includes((error as { reason?: string }).reason || '')) {
          alert((error as Error).message);
          navigate('/hall', { replace: true });
        } else {
          setConnectionReady(false);
          setSyncError((error as Error).message);
        }
      }
    };
    retrySync.current = join;
    const disconnected = () => { interrupt(); setConnectionReady(false); };
    const sessionError = (data: { reason: string }) => { alert(socketErrorMessage(data.reason)); navigate('/hall', { replace: true }); };
    socket.on('room_snapshot', handleSnapshot);
    socket.on('connect', join);
    socket.on('disconnect', disconnected);
    socket.on('session_error', sessionError);
    if (socket.connected) void join();
    return () => {
      active = false;
      socket.off('room_snapshot', handleSnapshot);
      socket.off('connect', join);
      socket.off('disconnect', disconnected);
      socket.off('session_error', sessionError);
      socket.off('new_message', handleNewMessage);
      socket.off('turn_state', handleTurnState);
      socket.off('campaign_state', handleCampaignState);
    };
  }, [roomId, navigate, cursor, live, interrupt, snapshot]);

  // 检定数值、技能与随机数均由服务端计算。
  const rollAttempts = useRef(new Map<string, string>());
  const handleSkillRoll = async (rollId: string) => {
    if (!connectionReady || !turnState?.pendingRolls.some(roll => roll.id === rollId && roll.characterId === myCharacter?.id) || rolledIndices.includes(rollId)) return;
    setRolledIndices(prev => [...prev, rollId]);
    let clientActionId = rollAttempts.current.get(rollId);
    if (!clientActionId) {
      clientActionId = crypto.randomUUID();
      rollAttempts.current.set(rollId, clientActionId);
    }
    try {
      await socketRequest('player_action', { roomId, rollId, isRoll: true, clientActionId, expectedTurnId: turnState.turnId });
      rollAttempts.current.delete(rollId);
    }
    catch (error) { alert((error as Error).message); }
    finally { setRolledIndices(prev => prev.filter(id => id !== rollId)); }
  };

  // SECTION: 当前出战角色加载
  // NOTE: 大厅只存当前角色 ID，游戏页必须重新拉完整角色卡用于技能和属性检定。
  useEffect(() => {
    const controller = new AbortController();
    const fetchCharacter = async () => {
      if (!selectedId) return;
      try {
        const response = await apiFetch('/api/characters/' + encodeURIComponent(selectedId), { signal: controller.signal });
        if (!response.ok) throw new Error('角色卡读取失败');
        const { card: targetChar }: { card: Character } = await response.json();
        if (controller.signal.aborted) return;
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
          id: targetChar.id, avatar: targetChar.avatarPath ? apiUrl(targetChar.avatarPath) : null,
          name: full.basicInfo.name,
          role: full.basicInfo.occupation || '未知职业',
          appearance: full.bgInfo?.description || '这个调查员很神秘，没有留下任何外貌描述。',
          hp: { current: targetChar.hp, max: targetChar.hp },
          san: { current: targetChar.san, max: full.stats.pow },
          mp: { current: targetChar.mp, max: targetChar.mp },
          skills: parsedSkills
        });
      } catch (error) {
        if (!controller.signal.aborted) setCharacterError((error as Error).message);
      }
    };
    void fetchCharacter();
    return () => controller.abort();
  }, [selectedId, characterAttempt]);

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

  const addExcerpt = (text: string) => {
    if (notebookReady && text) {
      setClues(prev => prev.includes(text) || prev.length >= 500 ? prev : [...prev, text]);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!notebookReady || !text || !selection ||
        !e.currentTarget.contains(selection.anchorNode) || !e.currentTarget.contains(selection.focusNode)) return;
    e.preventDefault();
    if (clues.length >= 500 && !clues.includes(text)) {
      setExcerptNotice('手摘线索已满，请先整理笔记。');
    } else {
      addExcerpt(text);
      setExcerptNotice(clues.includes(text) ? '笔记中已有这段原话。' : '已摘入个人笔记。');
    }
  };

  const messageHeading = (sender: string, text: string) => {
    const excerpt = text.trim();
    const recorded = clues.includes(excerpt);
    const full = clues.length >= 500 && !recorded;
    return <div className="message-heading">
      <span className="sender-name">{sender}</span>
      {excerpt && <button type="button" className="excerpt-button"
        disabled={recorded || !notebookReady || full} onClick={() => addExcerpt(excerpt)}>
        {recorded ? '已摘录' : full ? '线索已满' : '摘入笔记'}
      </button>}
    </div>;
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
        {syncError ? <div role="alert"><p>{syncError}</p>
          <button className="flat-btn secondary" onClick={() => retrySync.current()}>重试同步</button>
        </div> : characterError ? <div role="alert"><p>无法读取当前调查员档案。</p>
          <button className="flat-btn secondary" onClick={() => { setCharacterError(''); setCharacterAttempt(value => value + 1); }}>重试</button>
        </div> : <h2>正在读取调查员档案…</h2>}
      </div>
    );
  }

  const lastDmIndex = chatMessages.findIndex(m => m.role === 'dm' && m.logIndex === turnState?.turnId);
  const firstVisibleDm = chatMessages.findIndex(m => m.role === 'dm');
  const firstDm = firstVisibleDm < 0 ? chatMessages.length : firstVisibleDm;
  const myRoll = connectionReady && turnState?.mode === 'waiting_rolls'
    ? turnState.pendingRolls.find(roll => roll.characterId === myCharacter.id) : undefined;
  const isInputLocked = !connectionReady || !turnState || turnState.inputLocked ||
    turnState.actedPlayers.includes(myCharacter.name);
  let turnSummary = '';
  if (!connectionReady || !turnState) {
    turnSummary = '正在重新连接房间…';
  } else if (turnState.mode === 'completed') {
    turnSummary = campaignState?.ending?.label || '本章已经结束';
  } else if (turnState.canRetry) {
    turnSummary = turnState.retryMessage || '主持回复失败';
  } else if (myRoll) {
    turnSummary = `你的检定 · ${myRoll.skill}`;
  } else if (turnState.mode === 'waiting_rolls') {
    turnSummary = `等待 ${turnState.pendingRollPlayers.join('、')} 掷骰`;
  } else if (turnState.mode === 'waiting_dm') {
    turnSummary = 'KP 正在回应…';
  } else if (isInputLocked) {
    turnSummary = `行动已提交，等待 ${turnState.pendingPlayers.join('、') || '队友'} 行动`;
  }

  return (
    <div className="game-container">
      <div className="game-header flat-box">
        <span className="room-info">{campaignState?.title || '桃花岛历险记'} // {roomId}</span>
        <div className="game-header-actions">
          {isOwner && roomId && <HostApiPanel roomId={roomId} />}
          <button className="flat-btn secondary small" onClick={handleSaveGame}>存档</button>
          <button className="flat-btn secondary small" onClick={async () => { try { await socketRequest('leave_room', { roomId }); navigate('/hall'); } catch (error) { alert((error as Error).message); } }}>退出</button>
        </div>
      </div>

      <div className="game-body">
        <GameSidebar self={myCharacter} teammates={teammates} roomId={roomId}
          offlineRoll={connectionReady ? offlineRoll : undefined}
          onCharacter={setActiveCard} onNotebook={() => setIsNotebookOpen(true)} />
        <main className="game-main flat-box">
          <div className="game-history-viewport">
          <div className="chat-history" aria-busy={history.busy} ref={historyRef} onScroll={onHistoryScroll} onContextMenu={handleContextMenu}>
            {history.page.hasEarlier && <button type="button" className="flat-btn secondary small history-page"
              disabled={history.busy} onClick={() => history.load('beforeSeq', chatMessages[0].logIndex!, keepPosition)}>
              更早的记录</button>}
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
                  <div id={msg.logIndex === undefined ? undefined : `log-message-${msg.logIndex}`} tabIndex={-1} data-seq={msg.logIndex} key={msg.logIndex ?? idx} className="message dm">
                    {messageHeading('系统 DM', pureText)}
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
                               {describeRollRules(rollItem.rules)}
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
              if (msg.role === 'roll' && idx >= firstDm) return null;

              return (
                <div id={msg.logIndex === undefined ? undefined : `log-message-${msg.logIndex}`} tabIndex={-1} data-seq={msg.logIndex} key={msg.logIndex ?? idx} className={`message ${msg.role}`}>
                  {messageHeading(msg.sender, msg.content)}
                  <div className="message-content">{msg.content}</div>
                </div>
              );
            })}
          </div>
          {history.error && <span role="alert" className="history-error">{history.error}</span>}
          {reviewing && <div className="history-navigation">
            {history.archive && history.page.hasLater && <button type="button" className="flat-btn secondary small history-page"
              disabled={history.busy} onClick={() => history.load('afterSeq', chatMessages.at(-1)!.logIndex!)}>后续记录</button>}
            <button type="button" className="flat-btn secondary small history-return"
              onClick={() => { history.leaveArchive(); returnToLatest(); }}>
              {unread ? `${unread} 条新消息` : '回到最新'} ↓
            </button>
          </div>}
          </div>
          <ActionComposer roomId={roomId} draftKey={draftKey} turnId={turnState?.turnId} isInputLocked={isInputLocked}
            turnSummary={turnSummary} myRoll={myRoll} rolling={Boolean(myRoll && rolledIndices.includes(myRoll.id))}
            onRoll={handleSkillRoll} canRetry={Boolean(turnState?.canRetry && connectionReady)}
            syncError={syncError} retrySync={() => retrySync.current()} />
        </main>
      </div>
      {excerptNotice && <div className="excerpt-feedback" role="status">{excerptNotice}</div>}
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
                window.requestAnimationFrame(async () => {
                  if (!jumpToSource(index) && !await history.load('aroundSeq', index)) cancelPosition();
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
              {['notes', 'clues', 'relation'].includes(activeTab) && notebookConflict &&
                <NotebookConflictPanel key={notebookConflict.revision} conflict={notebookConflict} onSave={resolveConflict} />}
              {['notes', 'clues', 'relation'].includes(activeTab) && !notebookConflict && (!notebookReady || notebookError) && (
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

              {activeTab === 'clues' && !notebookConflict && (
                <div className="clues-list">
                  <p className="clues-hint">点击消息旁的「摘入笔记」可保存整段原话；在电脑上也可以选中一段文字后右键摘录。</p>
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

type ComposerProps = {
  roomId?: string; draftKey: string; turnId?: number; isInputLocked: boolean; turnSummary: string;
  myRoll?: RollRequestWithState; rolling: boolean; onRoll: (id: string) => void;
  canRetry: boolean; syncError: string; retrySync: () => void;
};
type PendingAction = { message: string; clientActionId: string; expectedTurnId: number };
function ActionComposer({ roomId, draftKey, turnId, isInputLocked, turnSummary, myRoll, rolling, onRoll,
  canRetry, syncError, retrySync }: ComposerProps) {
  const requestKey = draftKey + ':pending';
  const [initialRequest] = useState<PendingAction | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(requestKey) || 'null'); } catch { return null; }
  });
  const pending = useRef(initialRequest);
  const clearPending = () => {
    pending.current = null;
    try { sessionStorage.removeItem(requestKey); } catch { /* memory only */ }
  };
  const [inputText, setInputText] = useState(() => {
    try { return sessionStorage.getItem(draftKey) || ''; } catch { return ''; }
  });
  const draftText = useRef(inputText);
  const sendingAction = useRef(false);
  const [actionSending, setActionSending] = useState(false);
  const enterKey = useChatEnter();
  const editAction = (value: string) => {
    if (pending.current && pending.current.message !== value) clearPending();
    draftText.current = value;
    setInputText(value);
    try {
      if (value) sessionStorage.setItem(draftKey, value);
      else sessionStorage.removeItem(draftKey);
    } catch { /* The in-memory editor still works when storage is unavailable. */ }
  };
  const handleSendMessage = async () => {
    if (!inputText.trim() || turnId === undefined || isInputLocked || sendingAction.current) return;
    sendingAction.current = true;
    setActionSending(true);
    const sent = inputText;
    try {
      let request = pending.current;
      if (!request || request.message !== sent) {
        request = { message: sent, clientActionId: crypto.randomUUID(), expectedTurnId: turnId };
        pending.current = request;
        try { sessionStorage.setItem(requestKey, JSON.stringify(request)); } catch { /* memory only */ }
      }
      await socketRequest('player_action', { roomId, ...request });
      clearPending();
      if (draftText.current === sent) {
        draftText.current = '';
        setInputText('');
        try { if (sessionStorage.getItem(draftKey) === sent) sessionStorage.removeItem(draftKey); }
        catch { /* Drafts can also be memory-only. */ }
      }
    } catch (error) {
      if ((error as { reason?: string }).reason === 'stale_turn') clearPending();
      alert((error as Error).message);
    }
    finally { sendingAction.current = false; setActionSending(false); }
  };

  return (
    <div className="control-panel" style={{ flexDirection: 'column', gap: '10px' }}>
      <div className="composer-row">
        {isInputLocked && (
          <div className="turn-summary" role="status" aria-live="polite">
            <strong>{syncError || turnSummary}</strong>
            {myRoll?.rules && <span>{describeRollRules(myRoll.rules)}</span>}
          </div>
        )}
        <textarea
          className="flat-textarea"
          hidden={isInputLocked}
          aria-label="调查员行动"
          placeholder="描述你的行动、语言，或心理活动…"
          value={inputText}
          onChange={(e) => editAction(e.target.value)}
          {...enterKey.compositionEvents}
          disabled={isInputLocked}
          onKeyDown={(e) => {
            if (enterKey.shouldSubmit(e)) void handleSendMessage();
          }}
        ></textarea>

        {syncError ? (
          <button type="button" className="flat-btn secondary send-btn" onClick={retrySync}>重试同步</button>
        ) : myRoll ? (
          <button type="button" className="flat-btn primary send-btn turn-roll-btn"
            onClick={() => myRoll.id && onRoll(myRoll.id)} disabled={rolling}>
            <span>掷骰 · {myRoll.skill}</span>
          </button>
        ) : canRetry ? (
          <button type="button" className="flat-btn secondary send-btn"
            onClick={() => socketRequest('retry_dm', { roomId }).catch(error => alert(error.message))}>重试主持</button>
        ) : (
          <button className="flat-btn primary send-btn" onClick={handleSendMessage}
            disabled={isInputLocked || actionSending || !inputText.trim()}>执行</button>
        )}
      </div>
    </div>
  );
}
