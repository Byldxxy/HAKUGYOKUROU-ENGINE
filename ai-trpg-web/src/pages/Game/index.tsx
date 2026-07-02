// 修改前：import { useState } from 'react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './Game.css';
import RelationGraph, { type GraphNode, type GraphEdge } from '../../components/RelationGraph';
import { apiUrl } from '../../config';
import { emitWhenConnected, ensureSocketConnected, socket } from '../../socket';

type RollRequest = {
  skill: string;
  player: string;
};

const parseRollRequests = (content: string): RollRequest[] => {
  const rollRegex = /<<ROLL:([^:<>]+):([^<>]+?)(?:>>|>)/g;
  return Array.from(content.matchAll(rollRegex), match => ({
    skill: match[1].trim(),
    player: match[2].trim(),
  }));
};

const findRollResult = (messages: any[], dmIndex: number, roll: RollRequest) => {
  for (let index = dmIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'dm') break;
    if (message.role !== 'roll' || message.sender !== roll.player) continue;

    const content = String(message.content || '');
    if (content.startsWith(`[对 ${roll.skill} 进行检定]`)) {
      return content;
    }
  }

  return '';
};

export default function Game() {
  const navigate = useNavigate();
  const { roomId } = useParams();

  // 控制角色卡弹窗状态
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [myCharacter, setMyCharacter] = useState<any>(null);

  // --- 笔记本相关的状态 ---
  const [isNotebookOpen, setIsNotebookOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'relation' | 'notes' | 'clues'>('relation');
  const [freeNotes, setFreeNotes] = useState('');
  const [clues, setClues] = useState<string[]>([]);
  const [isNotebookLoaded, setIsNotebookLoaded] = useState(false);
  const saveNotebookTimerRef = useRef<number | null>(null);

  // --- 新增：跑团正式发言与后端通信状态 ---
  const [inputText, setInputText] = useState('');

  // --- 新增：强制破窗解锁状态 ---
  const [forceUnlock, setForceUnlock] = useState(false);
  
  // 👇 1. 将原本写死的开场白，替换为一个空数组
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  // 👇 2. 新增：进入房间时，立即向后端索要当前房间的历史记忆
  useEffect(() => {
    const fetchRoomHistory = async () => {
      try {
        const res = await fetch(apiUrl(`/api/room_history?roomId=${roomId}`));
        const data = await res.json();
        
        if (data.success && data.messages.length > 0) {
          // 如果有历史记录（说明房主读档了），直接把旧记录铺到公屏上
          setChatMessages(data.messages);
        } else {
          // 如果没有记录（说明是全新开局），塞入初始开场白
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

  // --- 新增：房主专属存档功能 ---
  const handleSaveGame = async () => {
    const saveName = window.prompt('请输入存档名称：', `桃花岛战役_${new Date().toLocaleDateString()}`);
    if (!saveName) return; // 如果玩家点取消，就停止

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

  // 用来记录哪些消息（按索引）已经被点过检定按钮了
  const [rolledIndices, setRolledIndices] = useState<string[]>([]);

  // --- 新增：自动滚动到底部的逻辑 ---
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 每次 chatMessages 发生变化时，平滑滚动到锚点位置
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

// --- 2. 新增：实时联机通讯逻辑 ---
  useEffect(() => {
    ensureSocketConnected();
    // A. 组件一加载，就告诉后端我要加入这个特定房间
    if (roomId) emitWhenConnected('join_room', roomId);

    // B. 监听后端的 'new_message' 广播，一收到消息就塞进聊天列表
    const handleNewMessage = (msg: any) => {
      setChatMessages(prev => [...prev, msg]);
    };
    socket.on('new_message', handleNewMessage);

    // C. 清理函数：离开页面时关掉监听，防止消息重复渲染
    return () => {
      socket.off('new_message', handleNewMessage);
    };
  }, [roomId]);

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    // 直接把动作抛给后端
    emitWhenConnected('player_action', {
      roomId: roomId,
      playerName: myCharacter.name,
      message: inputText
    });

    // 清空输入框，等待广播传回消息自动上屏
    setInputText(''); 
    setForceUnlock(false);
  };

// --- 新增：严格版 COC 7th D100 检定引擎 ---
  const handleSkillRoll = (skillName: string, playerName: string, msgIndex: string) => {// 👈 新增了 msgIndex 参数
    // 确保只有被叫到名字的玩家才能按这个按钮（二次防呆）
    if (playerName !== myCharacter.name) return;

    // 👇 核心防呆锁：如果这个请求已经投掷过，直接拦截不执行！
    if (rolledIndices.includes(msgIndex)) return;
    
    // 把当前这条消息的索引加入“正在同步”黑名单
    setRolledIndices(prev => [...prev, msgIndex]);
    // 👆 防呆锁结束

    // 获取玩家该技能的点数，如果没有这个技能，默认值为 1
    const skillValue = myCharacter.skills[skillName] || 1;
    
    // 命运的骰子转动 (1-100)
    const roll = Math.floor(Math.random() * 100) + 1;
    let result = '';

    // 严格版判定规则
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

    // 组装帅气的公屏播报文本
    const rollMessage = `掷出了 D100 = ${roll} / ${skillValue}，结果：【${result}】`;
    
    // 将骰子结果发给后端（附带 isRoll: true 标记，强制触发 AI 结算）
    emitWhenConnected('player_action', {
      roomId: roomId,
      playerName: myCharacter.name,
      message: `[对 ${skillName} 进行检定]：${rollMessage}`,
      isRoll: true 
    });
  };

  // --- 新增：把关系图的记忆存放在这里，防止被销毁 ---
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);

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

  // --- 新增：自动化状态结算中心 (拦截 AI 的 STAT 指令) ---
  useEffect(() => {
    if (chatMessages.length === 0) return;
    const lastMsg = chatMessages[chatMessages.length - 1];
    
    if (lastMsg.role === 'dm') {
      const statRegex = /<<STAT:(.*?):(HP|SAN|MP):([+-]?\d+)(?:>>|>)/g;
      let match;
      while ((match = statRegex.exec(lastMsg.content)) !== null) {
        const targetPlayer = match[1].trim();
        const statName = match[2].trim().toLowerCase() as 'hp' | 'san' | 'mp'; 
        const change = parseInt(match[3].trim(), 10);

        // 如果受害者是我自己，更新我的血条
        if (myCharacter && targetPlayer === myCharacter.name) {
          setMyCharacter((prev: any) => {
            if (!prev) return prev;
            const newCurrent = Math.max(0, Math.min(prev[statName].max, prev[statName].current + change));
            return { ...prev, [statName]: { ...prev[statName], current: newCurrent } };
          });
        } 
        // 如果受害者是队友，更新队友的血条
        else {
          setTeammates((prevMates) => prevMates.map(mate => {
            if (mate.name === targetPlayer && mate[statName].current !== '?') {
              const newCurrent = Math.max(0, Math.min(mate[statName].max, mate[statName].current + change));
              return { ...mate, [statName]: { ...mate[statName], current: newCurrent } };
            }
            return mate;
          }));
        }
      }
    }
  }, [chatMessages]); // 每次有新消息都触发扫描

  // --- 2. 页面加载时，根据大厅传来的 ID 去拉取真实卡片 ---
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
            
            // 提炼技能：计算出每个技能的总成功率 (基础+职业+兴趣+成长)
            const parsedSkills: Record<string, number> = {};
            full.skills.forEach((s: any) => {
              const shortName = s.name.split(' ')[0]; // 把 "侦查 (Spot Hidden)" 变成 "侦查"
              parsedSkills[shortName] = s.base + (s.job || 0) + (s.interest || 0) + (s.grow || 0);
            });

            if (full.stats) {
              parsedSkills['力量'] = full.stats.str;
              parsedSkills['体质'] = full.stats.con;
              parsedSkills['体型'] = full.stats.siz;
              parsedSkills['敏捷'] = full.stats.dex;
              parsedSkills['外貌'] = full.stats.app;
              parsedSkills['智力'] = full.stats.int;
              parsedSkills['灵感'] = full.stats.int; // COC中，灵感检定等同于智力
              parsedSkills['意志'] = full.stats.pow;
              parsedSkills['教育'] = full.stats.edu;
              parsedSkills['幸运'] = full.stats.luc;
              parsedSkills['理智'] = targetChar.san;
              parsedSkills['SAN'] = targetChar.san; // 兼容 AI 可能的英文称呼
            }

            setMyCharacter({
              id: targetChar.id,
              name: full.basicInfo.name,
              role: full.basicInfo.occupation || '未知职业',
              appearance: full.bgInfo.description || '这个调查员很神秘，没有留下任何外貌描述。',
              hp: { current: targetChar.hp, max: targetChar.hp },
              san: { current: targetChar.san, max: full.stats.pow },
              mp: { current: targetChar.mp, max: targetChar.mp },
              skills: parsedSkills // 32个技能全部注入
            });

            // 新增：向服务器同步我的完整档案，确保队友能看见我的状态
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

  // 模拟队友的数据
  const [teammates, setTeammates] = useState<any[]>([]);

  useEffect(() => {
    const handleLobbyUpdate = (data: any) => {
      const selfName = myCharacter?.name;
      const mates = data.players.filter((p: any) => {
        const playerName = p.characterName || p.fullData?.basicInfo?.name || p.fullData?.fullData?.basicInfo?.name || p.name;
        return playerName !== selfName;
      });
      
      const formattedMates = mates.map((m: any) => {
        // 👇 核心修复：深度挖掘队友数据，如果队友没带角色卡进房间，则保底显示 '?'
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

  // 提取线索的右键菜单逻辑
  const handleContextMenu = (e: React.MouseEvent) => {
    const selectedText = window.getSelection()?.toString().trim();
    if (selectedText) {
      e.preventDefault(); // 阻止浏览器默认右键菜单
      setClues(prev => prev.includes(selectedText) ? prev : [...prev, selectedText]);
      alert(`已成功提取线索: "${selectedText.substring(0, 10)}..."`); 
    }
  };

  // 渲染角色卡弹窗内容的辅助函数
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

  // 👇 插入在这里 👇
  if (!myCharacter) {
    return (
      <div className="game-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <h2>📡 正在同步调查员 [神经链路] 与 [核心数据]...</h2>
      </div>
    );
  }
  // 👆 插入结束 👆  

  // ==========================================
  // --- 新增：回合制状态推导逻辑 ---
  // ==========================================
  
  // 1. 汇总当前小队的所有人名单 (包括自己和队友)
  const allPlayers = [myCharacter.name, ...teammates.map(t => t.name)];
  const playerDisplayNames = new Map<string, string>([
    [myCharacter.name, myCharacter.name],
    ...teammates.map(t => [t.name, t.name] as [string, string])
  ]);

  // 2. 找到聊天记录里，最后一条 DM 消息的索引位置
  const lastDmIndex = chatMessages.map(m => m.role).lastIndexOf('dm');

  // 3. 截取当前回合的消息（即最后一条 DM 消息之后的所有消息）
  const currentRoundMessages = chatMessages.slice(lastDmIndex + 1);
  
  // 4. 提取当前回合已经发过言的玩家名单（利用 Set 去重）
  const actedPlayers = Array.from(new Set(currentRoundMessages.map(m => m.sender)));

  // 5. 计算还有哪些玩家没行动（总名单 减去 已行动名单）
  const pendingPlayers = allPlayers.filter(name => !actedPlayers.includes(name));
  const pendingPlayerLabels = pendingPlayers.map(name => playerDisplayNames.get(name) || name);

  // 6. 判断我自己是否已经在这回合行动过了（如果使用了强行解锁，则无视锁定）
  const isMyTurnDone = actedPlayers.includes(myCharacter.name);
  const isTurnLocked = isMyTurnDone && !forceUnlock;

  const lastDmMessage = lastDmIndex !== -1 ? String(chatMessages[lastDmIndex]?.content || '') : '';
  const activeRollRequests = parseRollRequests(lastDmMessage);
  const pendingRolls = activeRollRequests.filter(roll => !findRollResult(chatMessages, lastDmIndex, roll));
  const pendingRollPlayers = Array.from(new Set(pendingRolls.map(roll => roll.player)));
  const isWaitingForMyRoll = pendingRolls.some(roll => roll.player === myCharacter.name);
  const isRollGateLocked = activeRollRequests.length > 0;
  const isInputLocked = isRollGateLocked || isTurnLocked;

  // 7. 动态生成输入框的占位符文本
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
      {/* 顶部导航 */}
      <div className="game-header flat-box">
        <span className="room-info">桃花岛历险记 // {roomId}</span>
        <div style={{ display: 'flex', gap: '15px' }}>
          {/* 如果需要可以加判断只让房主看到，但因为存档存在账号名下，目前开放给所有人保存也无妨 */}
          <button className="flat-btn secondary small" onClick={handleSaveGame}>存档</button>
          <button className="flat-btn secondary small" onClick={() => navigate(`/lobby/${roomId}`)}>退出</button>
        </div>
      </div>

      <div className="game-body">
        {/* 左侧：侧边栏 */}
        <aside className="game-sidebar">
          
          {/* 我的角色模块 */}
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

            {/* --- 新增：笔记本按钮 --- */}
            <button 
              className="flat-btn secondary notebook-btn"
              onClick={() => setIsNotebookOpen(true)}
              style={{ marginTop: '10px', width: '100%', height: '45px', fontSize: '0.9rem' }}
            >
              📓 打开战役笔记
            </button>
          </div>
          
          {/* 队友列表模块 */}
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
                  {/* 👇 统一加上具体的数值 👇 */}
                  <span className="mini-stat hp">HP {mate.hp.current}/{mate.hp.max}</span>
                  <span className="mini-stat san">SAN {mate.san.current}/{mate.san.max}</span>
                  <span className="mini-stat mp">MP {mate.mp.current}/{mate.mp.max}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* 右侧：主舞台 */}
        <main className="game-main flat-box">
          {/* --- 绑定右键菜单事件的聊天区 --- */}
          
          {/* 动态绑定的聊天流 (升级版) */}
          <div className="chat-history" onContextMenu={handleContextMenu}>
            {chatMessages.map((msg, idx) => {
              const messageContent = String(msg.content || '');
              const statRegex = /<<STAT:([^:<>]+):(HP|SAN|MP):([+-]?\d+)(?:>>|>)/g;
              const rollStripRegex = /<<ROLL:([^:<>]+):([^<>]+?)(?:>>|>)/g;
              const rolls = parseRollRequests(messageContent);
              const stats = Array.from(messageContent.matchAll(statRegex), match => ({
                player: match[1].trim(),
                type: match[2].trim(),
                val: match[3].trim(),
              }));
              const hasRoll = rolls.length > 0;
              const hasStat = stats.length > 0;
              
              if (msg.role === 'dm' && (hasRoll || hasStat)) {
                const pureText = messageContent
                  .replace(rollStripRegex, '')
                  .replace(statRegex, '')
                  .trim();

                return (
                  <div key={idx} className={`message dm`}>
                    <span className="sender-name">系统 DM</span>
                    <div className="message-content">
                      {pureText}
                      
                      {/* 渲染掉血/掉理智播报 */}
                      {stats.length > 0 && (
                        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {stats.map((st, sIdx) => (
                            <span key={sIdx} style={{ background: st.val.startsWith('-') ? '#FFEbee' : '#E8F5E9', color: st.val.startsWith('-') ? '#D32F2F' : '#2E7D32', padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                              ⚠️ {st.player} 的 {st.type} {st.val}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 渲染检定按钮 (这里保留你原本的 rolls.map 代码) */}
                      {rolls.map((rollItem, rIdx) => {
                         const targetSkill = rollItem.skill;
                         const targetPlayer = rollItem.player;
                         const rollKey = `${idx}-${rIdx}`;
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

              // 如果不是检定请求，正常渲染
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
          
          {/* 动态绑定的输入台（附带回合制锁定） */}
          {/* 增加 flexWrap: 'wrap'，让元素可以自然换行 */}
          <div className="control-panel" style={{ flexDirection: 'column', gap: '10px' }}>

            {/* 👇 越权发言按钮：占据 100% 宽度，直接霸占最顶行，绝对不会被遮挡 👇 */}
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

      {/* 角色卡详情弹窗 (Modal) */}
      {activeCard && (
        <div className="modal-overlay" onClick={() => setActiveCard(null)}>
          <div className="modal-content flat-box" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setActiveCard(null)}>×</button>
            {renderModalContent()}
          </div>
        </div>
      )}

      {/* --- 笔记本大弹窗 (Modal) --- */}
      {isNotebookOpen && (
        <div className="modal-overlay" onClick={() => setIsNotebookOpen(false)}>
          <div className="notebook-modal flat-box" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setIsNotebookOpen(false)}>×</button>
            
            {/* 顶部分栏 Tab */}
            <div className="notebook-tabs">
              <div className={`tab-item ${activeTab === 'relation' ? 'active' : ''}`} onClick={() => setActiveTab('relation')}>关系图谱</div>
              <div className={`tab-item ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>自由笔记</div>
              <div className={`tab-item ${activeTab === 'clues' ? 'active' : ''}`} onClick={() => setActiveTab('clues')}>关键线索</div>
            </div>

            {/* 内容区 */}
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
