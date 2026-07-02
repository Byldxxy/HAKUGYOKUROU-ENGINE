import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './Game.css';
import RelationGraph, { type GraphNode, type GraphEdge } from '../../components/RelationGraph';
import { apiUrl } from '../../config';
import { emitWhenConnected, ensureSocketConnected, socket } from '../../socket';
import {
  parseRollRequests,
  parseStatDirectives,
  stripDirectives,
  type RollRequest,
} from '../../domain/directives';

type RollRequestWithState = RollRequest & {
  id?: string;
  originalPlayer?: string;
  resolved?: boolean;
  result?: string;
};

type TurnState = {
  mode: 'waiting_players' | 'waiting_rolls' | 'waiting_dm';
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

// SECTION: 检定结果查找
// NOTE: 新日志优先按 rollId 匹配；旧日志没有 rollId 时，用“角色 + 技能”兼容历史数据。
const findRollResult = (messages: any[], dmIndex: number, roll: RollRequestWithState) => {
  if (roll.result) return roll.result;

  for (let index = dmIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'dm') break;
    if (message.role !== 'roll' || message.sender !== roll.player) continue;

    const content = String(message.content || '');
    if ((roll.id && message.rollId === roll.id) || (!message.rollId && content.startsWith(`[对 ${roll.skill} 进行检定]`))) {
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
  const [myCharacter, setMyCharacter] = useState<any>(null);

  // SECTION: 战役笔记状态
  // NOTE: 关系图状态提升到 Game，避免切换笔记页签时节点和边丢失。
  const [isNotebookOpen, setIsNotebookOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'relation' | 'notes' | 'clues'>('relation');
  const [freeNotes, setFreeNotes] = useState('');
  const [clues, setClues] = useState<string[]>([]);
  const [isNotebookLoaded, setIsNotebookLoaded] = useState(false);
  const saveNotebookTimerRef = useRef<number | null>(null);

  // SECTION: 聊天与回合状态
  // NOTE: turnState 来自后端，是输入锁和等待提示的权威来源。
  const [inputText, setInputText] = useState('');
  const [forceUnlock, setForceUnlock] = useState(false);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [turnState, setTurnState] = useState<TurnState | null>(null);

  // SECTION: 房间历史加载
  // NOTE: 首屏先拉取 JSONL 历史，保证刷新后消息、检定结果和 DM 回复都能恢复。
  useEffect(() => {
    const fetchRoomHistory = async () => {
      setTurnState(null);
      try {
        const res = await fetch(apiUrl(`/api/room_history?roomId=${roomId}`));
        const data = await res.json();

        if (data.success && data.messages.length > 0) {
          setChatMessages(data.messages);
        } else {
          setChatMessages([
            { role: 'dm', sender: '系统 DM', content: '伴随着一阵低沉的机械轰鸣，这艘古老星舰的休眠舱缓缓开启。桃花岛的空气过滤系统似乎出了些故障，空气中弥漫着机油的奇特味道。' }
          ]);
        }
      } catch (error) {
        console.error('拉取历史记录失败', error);
      }
    };
    if (roomId) fetchRoomHistory();
  }, [roomId]);

  // SECTION: 手动存档
  // NOTE: 当前存档以房间日志为主体，username 用于把存档归到当前账号名下。
  const handleSaveGame = async () => {
    const saveName = window.prompt('请输入存档名称：', `桃花岛战役_${new Date().toLocaleDateString()}`);
    if (!saveName) return;

    const username = localStorage.getItem('trpg_username');
    try {
      const res = await fetch(apiUrl('/api/saves'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, roomId, saveName })
      });
      const data = await res.json();
      if (data.success) {
        alert('💾 ' + data.message);
      } else {
        alert('存档失败：' + data.error);
      }
    } catch (e) {
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
    if (roomId) emitWhenConnected('join_room', roomId);
    const handleNewMessage = (msg: any) => {
      setChatMessages(prev => [...prev, msg]);
    };
    const handleTurnState = (state: TurnState) => {
      setTurnState(state);
    };
    socket.on('new_message', handleNewMessage);
    socket.on('turn_state', handleTurnState);
    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('turn_state', handleTurnState);
    };
  }, [roomId]);

  // SECTION: 玩家普通行动
  // NOTE: 普通行动不带 isRoll，后端会把它纳入“本轮已行动玩家”统计。
  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    emitWhenConnected('player_action', {
      roomId: roomId,
      playerName: myCharacter.name,
      message: inputText
    });
    setInputText('');
    setForceUnlock(false);
  };

  // SECTION: COC D100 检定
  // NOTE: 前端只负责生成随机骰和显示结果文本；是否允许重复提交由后端 rollId 决定。
  const handleSkillRoll = (skillName: string, playerName: string, rollId: string) => {
    if (playerName !== myCharacter.name) return;
    if (rolledIndices.includes(rollId)) return;
    setRolledIndices(prev => [...prev, rollId]);
    const skillValue = myCharacter.skills[skillName] || 1;
    const roll = Math.floor(Math.random() * 100) + 1;
    let result = '';
    if (roll === 1) {
      result = '大成功 (Critical Success)';
    } else if (skillValue < 50 && roll >= 96) {
      result = '大失败 (Fumble)';
    } else if (skillValue >= 50 && roll === 100) {
      result = '大失败 (Fumble)';
    } else if (roll <= Math.floor(skillValue / 5)) {
      result = '极难成功 (Extreme Success)';
    } else if (roll <= Math.floor(skillValue / 2)) {
      result = '困难成功 (Hard Success)';
    } else if (roll <= skillValue) {
      result = '常规成功 (Regular Success)';
    } else {
      result = '失败 (Failure)';
    }
    const rollMessage = `掷出了 D100 = ${roll} / ${skillValue}，结果：【${result}】`;
    emitWhenConnected('player_action', {
      roomId: roomId,
      playerName: myCharacter.name,
      message: `[对 ${skillName} 进行检定]：${rollMessage}`,
      rollId,
      isRoll: true
    });
  };

  // SECTION: 关系图状态
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);

  // SECTION: 战役笔记加载
  // NOTE: 笔记按 roomId + username 读取，同一账号在不同房间有独立笔记。
  useEffect(() => {
    const fetchNotebook = async () => {
      const username = localStorage.getItem('trpg_username');
      if (!roomId || !username) return;

      setIsNotebookLoaded(false);
      try {
        const params = new URLSearchParams({ roomId, username });
        const res = await fetch(apiUrl(`/api/notebooks?${params.toString()}`));
        const data = await res.json();
        if (data.success && data.notebook) {
          setFreeNotes(data.notebook.freeNotes || '');
          setClues(Array.isArray(data.notebook.clues) ? data.notebook.clues : []);
          setGraphNodes(Array.isArray(data.notebook.graphNodes) ? data.notebook.graphNodes : []);
          setGraphEdges(Array.isArray(data.notebook.graphEdges) ? data.notebook.graphEdges : []);
        }
      } catch (error) {
        console.error('拉取战役笔记失败:', error);
      } finally {
        setIsNotebookLoaded(true);
      }
    };

    fetchNotebook();
  }, [roomId]);

  // SECTION: 战役笔记保存
  // NOTE: 防抖写入，避免每次输入都立刻落到后端 JSON 文件。
  useEffect(() => {
    const username = localStorage.getItem('trpg_username');
    if (!roomId || !username || !isNotebookLoaded) return;

    if (saveNotebookTimerRef.current) {
      window.clearTimeout(saveNotebookTimerRef.current);
    }

    saveNotebookTimerRef.current = window.setTimeout(async () => {
      try {
        await fetch(apiUrl('/api/notebooks'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            username,
            notebook: {
              freeNotes,
              clues,
              graphNodes,
              graphEdges,
            },
          }),
        });
      } catch (error) {
        console.error('保存战役笔记失败:', error);
      }
    }, 500);

    return () => {
      if (saveNotebookTimerRef.current) {
        window.clearTimeout(saveNotebookTimerRef.current);
      }
    };
  }, [roomId, isNotebookLoaded, freeNotes, clues, graphNodes, graphEdges]);

  // SECTION: STAT 指令结算
  // NOTE: AI 的 STAT 指令只更新本地 UI 状态；持久化角色生命值之后可以再独立设计。
  useEffect(() => {
    if (chatMessages.length === 0) return;
    const lastMsg = chatMessages[chatMessages.length - 1];

    if (lastMsg.role === 'dm') {
      parseStatDirectives(lastMsg.content).forEach((directive) => {
        const targetPlayer = directive.player;
        const statName = directive.type.toLowerCase() as 'hp' | 'san' | 'mp';
        const change = directive.value;
        if (myCharacter && targetPlayer === myCharacter.name) {
          setMyCharacter((prev: any) => {
            if (!prev) return prev;
            const newCurrent = Math.max(0, Math.min(prev[statName].max, prev[statName].current + change));
            return { ...prev, [statName]: { ...prev[statName], current: newCurrent } };
          });
        }
        else {
          setTeammates((prevMates) => prevMates.map(mate => {
            if (mate.name === targetPlayer && mate[statName].current !== '?') {
              const newCurrent = Math.max(0, Math.min(mate[statName].max, mate[statName].current + change));
              return { ...mate, [statName]: { ...mate[statName], current: newCurrent } };
            }
            return mate;
          }));
        }
      });
    }
  }, [chatMessages]);

  // SECTION: 当前出战角色加载
  // NOTE: 大厅只存当前角色 ID，游戏页必须重新拉完整角色卡用于技能和属性检定。
  useEffect(() => {
    const fetchCharacter = async () => {
      const username = localStorage.getItem('trpg_username');
      const charId = localStorage.getItem('trpg_current_char_id');

      if (!username || !charId) {
        alert('未检测到出战角色，请返回大厅选择！');
        navigate(`/lobby/${roomId}`);
        return;
      }

      try {
        const res = await fetch(apiUrl(`/api/characters?username=${username}`));
        const data = await res.json();
        if (data.success) {
          const targetChar = data.cards.find((c: any) => c.id === charId);
          if (targetChar) {
            const full = targetChar.fullData;
            const parsedSkills: Record<string, number> = {};
            full.skills.forEach((s: any) => {
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
              id: targetChar.id,
              name: full.basicInfo.name,
              role: full.basicInfo.occupation || '未知职业',
              appearance: full.bgInfo.description || '这个调查员很神秘，没有留下任何外貌描述。',
              hp: { current: targetChar.hp, max: targetChar.hp },
              san: { current: targetChar.san, max: full.stats.pow },
              mp: { current: targetChar.mp, max: targetChar.mp },
              skills: parsedSkills
            });
            emitWhenConnected('sync_character', {
              roomId,
              nickname: full.basicInfo.name,
              fullData: targetChar
            });
          }
        }
      } catch (error) {
        console.error('拉取角色卡失败:', error);
      }
    };

    fetchCharacter();
  }, [roomId, navigate]);

  // SECTION: 队友状态镜像
  // NOTE: lobby_update 是房间玩家列表的广播源，游戏页用它生成左侧队友卡片。
  const [teammates, setTeammates] = useState<any[]>([]);

  useEffect(() => {
    const handleLobbyUpdate = (data: any) => {
      const selfName = myCharacter?.name;
      const mates = data.players.filter((p: any) => {
        const playerName = p.characterName || p.fullData?.basicInfo?.name || p.fullData?.fullData?.basicInfo?.name || p.name;
        return playerName !== selfName;
      });

      const formattedMates = mates.map((m: any) => {
        const hp = m.hp ?? m.fullData?.hp ?? (m.fullData?.stats ? Math.floor((m.fullData.stats.con + m.fullData.stats.siz)/10) : '?');
        const san = m.san ?? m.fullData?.san ?? m.fullData?.stats?.pow ?? '?';
        const mp = m.mp ?? m.fullData?.mp ?? (m.fullData?.stats ? Math.floor(m.fullData.stats.pow/5) : '?');

        return {
          id: m.id,
          name: m.characterName || m.fullData?.basicInfo?.name || m.fullData?.fullData?.basicInfo?.name || m.name,
          role: m.role || m.fullData?.basicInfo?.occupation || '未选定角色',
          hp: { current: hp, max: hp },
          san: { current: san, max: san },
          mp: { current: mp, max: mp }
        };
      });
      setTeammates(formattedMates);
    };

    socket.on('lobby_update', handleLobbyUpdate);
    return () => { socket.off('lobby_update', handleLobbyUpdate); };
  }, [myCharacter?.name]);

  // SECTION: 线索提取
  // NOTE: 右键选中文本会写入关键线索列表，随后由笔记防抖保存。
  const handleContextMenu = (e: React.MouseEvent) => {
    const selectedText = window.getSelection()?.toString().trim();
    if (selectedText) {
      e.preventDefault();
      setClues(prev => prev.includes(selectedText) ? prev : [...prev, selectedText]);
      alert(`已成功提取线索: "${selectedText.substring(0, 10)}..."`);
    }
  };

  // SECTION: 角色卡弹窗内容
  // NOTE: 自己能看完整技能，队友只显示表观信息。
  const renderModalContent = () => {
    if (activeCard === 'self') {
      return (
        <>
          <h3 className="modal-title">{myCharacter.name} - 完整角色卡</h3>
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
  const isWaitingForMyRoll = pendingRolls.some(roll => roll.player === myCharacter.name);
  const isRollGateLocked = activeRollRequests.length > 0;
  // NOTE: 输入锁优先使用后端 turn_state；本地历史推导只作为重连前的兜底。
  const isTurnLocked = turnState
    ? (
      (turnState.mode === 'waiting_dm' && activeRollRequests.length === 0) ||
      (turnState.mode === 'waiting_players' && isMyTurnDone && !forceUnlock)
    )
    : (isMyTurnDone && !forceUnlock);
  const isInputLocked = isRollGateLocked || isTurnLocked;

  // SECTION: 输入提示文案
  // NOTE: 文案优先级为检定锁、回合锁、可自由行动。
  let inputPlaceholder = "描述你的行动、语言，或心理活动（Shift+Enter 换行）...";
  if (isRollGateLocked) {
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
        <span className="room-info">桃花岛历险记 // {roomId}</span>
        <div style={{ display: 'flex', gap: '15px' }}>
          <button className="flat-btn secondary small" onClick={handleSaveGame}>存档</button>
          <button className="flat-btn secondary small" onClick={() => navigate(`/lobby/${roomId}`)}>退出</button>
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
              <span>{myCharacter.name}</span>
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
              style={{ marginTop: '10px', width: '100%', height: '45px', fontSize: '0.9rem' }}
            >
              📓 打开战役笔记
            </button>
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
                  {mate.name} <span style={{ fontSize:'0.75rem', color:'#A0858D', fontWeight:'normal' }}>({mate.role})</span>
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
              const rolls: RollRequestWithState[] = idx === lastDmIndex && turnState?.rollRequests?.length
                ? turnState.rollRequests
                : parsedRolls.map((roll) => ({
                  ...roll,
                  id: `${idx}-${roll.index}-${roll.player}-${roll.skill}`,
                }));
              const stats = parseStatDirectives(messageContent);
              const hasRoll = rolls.length > 0;
              const hasStat = stats.length > 0;

              if (msg.role === 'dm' && (hasRoll || hasStat)) {
                // NOTE: DM 正文展示时剥离控制指令，避免玩家看到协议噪声。
                const pureText = stripDirectives(messageContent);

                return (
                  <div key={idx} className={`message dm`}>
                    <span className="sender-name">系统 DM</span>
                    <div className="message-content">
                      {pureText}
                      {stats.length > 0 && (
                        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {stats.map((st, sIdx) => (
                            <span key={sIdx} style={{ background: st.rawValue.startsWith('-') ? '#FFEbee' : '#E8F5E9', color: st.rawValue.startsWith('-') ? '#D32F2F' : '#2E7D32', padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}>
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
                           <div key={rIdx} style={{ marginTop: '15px', padding: '15px', background: '#FAF5F7', border: '1.5px dashed #4A2A33', borderRadius: '4px', textAlign: 'center' }}>
                             <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#d81b60', display: 'block', marginBottom: '10px' }}>
                               [系统判定] 需要 {targetPlayer} 进行【{targetSkill}】检定
                             </span>

                             {rollResult ? (
                               <div style={{ margin: '8px auto 0', padding: '12px 16px', maxWidth: '720px', border: '1.5px dashed #4A2A33', borderRadius: '4px', background: '#fff', color: '#4A2A33', fontWeight: 'bold', lineHeight: 1.7 }}>
                                 {rollResult}
                               </div>
                             ) : myCharacter.name === targetPlayer ? (
                               <button
                                 className="flat-btn primary"
                                 style={{ padding: '8px 25px', opacity: isRolling ? 0.6 : 1, whiteSpace: 'nowrap', minWidth: '120px' }}
                                 onClick={() => handleSkillRoll(targetSkill, targetPlayer, rollKey)}
                                 disabled={isRolling}
                               >
                                 {isRolling ? '同步中...' : '🎲 立即检定'}
                               </button>
                             ) : (
                               <span style={{ color: '#A0858D', fontSize: '0.85rem' }}>⏳ 等待 {targetPlayer} 掷骰...</span>
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
                <div key={idx} className={`message ${msg.role}`}>
                  <span className="sender-name">{msg.sender}</span>
                  <div className="message-content">{msg.content}</div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          <div className="control-panel" style={{ flexDirection: 'column', gap: '10px' }}>
            {isTurnLocked && !isRollGateLocked && (
              <button
                onClick={() => setForceUnlock(true)}
                title="强制打破回合锁，自由发言"
                style={{
                  background: 'transparent', border: 'none', color: '#d81b60',
                  cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold',
                  padding: 0, textAlign: 'left', width: 'fit-content'
                }}
              >
                防卡死越权发言
              </button>
            )}

            <div style={{ display: 'flex', gap: '15px', alignItems: 'stretch', width: '100%' }}>
              <textarea
                className="flat-textarea"
                placeholder={inputPlaceholder}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isInputLocked}
                style={{ backgroundColor: isInputLocked ? '#f0ecec' : '#fff' }}
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
            <button className="close-btn" onClick={() => setActiveCard(null)}>×</button>
            {renderModalContent()}
          </div>
        </div>
      )}
      {isNotebookOpen && (
        <div className="modal-overlay" onClick={() => setIsNotebookOpen(false)}>
          <div className="notebook-modal flat-box" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setIsNotebookOpen(false)}>×</button>
            <div className="notebook-tabs">
              <div className={`tab-item ${activeTab === 'relation' ? 'active' : ''}`} onClick={() => setActiveTab('relation')}>关系图谱</div>
              <div className={`tab-item ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>自由笔记</div>
              <div className={`tab-item ${activeTab === 'clues' ? 'active' : ''}`} onClick={() => setActiveTab('clues')}>关键线索</div>
            </div>
            <div className="notebook-content">
              {activeTab === 'notes' && (
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
                  {clues.length === 0 ? (
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

              {activeTab === 'relation' && (
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
