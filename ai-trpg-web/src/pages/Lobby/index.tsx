import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './Lobby.css';
import { apiFetch } from '../../config';
import { emitWhenConnected, ensureSocketConnected, socket } from '../../socket';
import StyledSelect from '../../components/StyledSelect';
import { DEFAULT_ROOM_RULES, type RoomRules } from '../../domain/roomRules';

type RoomRuleDrafts = Record<keyof RoomRules, string>;

const ROOM_RULE_RANGES: Record<keyof RoomRules, { min: number; max: number }> = {
  pointBuyLimit: { min: 100, max: 1000 },
  occupationSkillLimit: { min: 1, max: 100 },
  interestSkillLimit: { min: 1, max: 100 },
};

const createRoomRuleDrafts = (rules: RoomRules): RoomRuleDrafts => ({
  pointBuyLimit: String(rules.pointBuyLimit),
  occupationSkillLimit: String(rules.occupationSkillLimit),
  interestSkillLimit: String(rules.interestSkillLimit),
});

export default function Lobby() {
  const navigate = useNavigate();
  const { roomId } = useParams();

  // SECTION: 大厅状态
  // NOTE: 房主身份由后端 ownerName 广播决定，前端不自行猜测。
  const [roomPlayers, setRoomPlayers] = useState<any[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [roomOwnerName, setRoomOwnerName] = useState('');

  // SECTION: 角色与存档状态
  // NOTE: activeCharacter 决定玩家在大厅和游戏内的展示名，也是 ROLL 归属依据。
  const [characterList, setCharacterList] = useState<any[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<any>(null);
  const [isCharactersLoaded, setIsCharactersLoaded] = useState(false);
  const [saveList, setSaveList] = useState<any[]>([]);
  const [selectedSaveId, setSelectedSaveId] = useState('');
  const [selectedScriptId, setSelectedScriptId] = useState('peach');
  const [roomRules, setRoomRules] = useState<RoomRules>(DEFAULT_ROOM_RULES);
  const [roomRuleDrafts, setRoomRuleDrafts] = useState<RoomRuleDrafts>(() => createRoomRuleDrafts(DEFAULT_ROOM_RULES));
  const [editingRoomRule, setEditingRoomRule] = useState<keyof RoomRules | null>(null);

  // NOTE: 服务端房规更新后刷新输入草稿；用户键入期间只改草稿，不逐字符广播。
  useEffect(() => {
    if (!editingRoomRule) setRoomRuleDrafts(createRoomRuleDrafts(roomRules));
  }, [roomRules, editingRoomRule]);

  // SECTION: 剧本选项
  // NOTE: 当前只作为 UI 选择保留，AI 实际模型和提示词仍由后端配置控制。
  const scriptOptions = [
    { value: 'peach', label: '桃花岛历险记' },
    { value: 'ontology', label: '本质' },
    { value: 'ctms', label: 'CTMS货舱危机（待接入）', disabled: true },
    { value: 'custom', label: '自定义空白团（待接入）', disabled: true },
  ];

  // SECTION: 角色卡加载
  // NOTE: 加载完成前不 join_lobby，避免用“未知调查员”占位写入房间玩家列表。
  const loadCharacters = useCallback(async () => {
    const username = localStorage.getItem('trpg_username');
    if (!username) {
      setIsCharactersLoaded(true);
      return;
    }

    try {
      setIsCharactersLoaded(false);
      const res = await apiFetch('/api/characters');
      const data = await res.json();
      const cards = data.success ? (data.cards || []) : [];
      const savedCharId = localStorage.getItem('trpg_current_char_id');
      // NOTE: 优先恢复上次选中的角色；没有缓存时默认使用第一张卡。
      const selected = cards.find((card: any) => card.id === savedCharId) || cards[0] || null;

      setCharacterList(cards);
      setActiveCharacter(selected);
      if (selected) {
        localStorage.setItem('trpg_current_char_id', selected.id);
      } else {
        localStorage.removeItem('trpg_current_char_id');
      }
    } catch (error) {
      console.error('拉取角色卡失败', error);
    } finally {
      setIsCharactersLoaded(true);
    }
  }, []);

  // SECTION: 存档列表加载
  // NOTE: 存档只供房主选择，普通玩家仍会看到等待配置提示。
  useEffect(() => {
    const fetchSaves = async () => {
      const username = localStorage.getItem('trpg_username');
      if (username) {
        try {
          const res = await apiFetch('/api/saves');
          const data = await res.json();
          if (data.success) setSaveList(data.saves || []);
        } catch (e) {
          console.error('拉取存档失败', e);
        }
      }
    };
    fetchSaves();
  }, []);

  useEffect(() => {
    loadCharacters();
  }, [loadCharacters]);

  // SECTION: 当前玩家身份
  // NOTE: 未选角色时 Lobby 暂用登录账号展示；进入游戏后仍必须使用角色卡姓名。
  const myName = activeCharacter?.name || localStorage.getItem('trpg_username') || '未登录玩家';

  // SECTION: 下拉选项派生
  // NOTE: useMemo 减少每次输入聊天时重建选项数组。
  const characterOptions = useMemo(
    () => [
      { value: '', label: '-- 请选择出战角色 --' },
      ...characterList.map(card => ({ value: card.id, label: `${card.name} (${card.role})` })),
    ],
    [characterList]
  );

  const saveOptions = useMemo(
    () => [
      { value: '', label: '新游戏' },
      ...saveList.map(save => ({
        value: save.id,
        label: `${save.name} (${new Date(save.date).toLocaleString()})`,
      })),
    ],
    [saveList]
  );

  // SECTION: 大厅 Socket 同步
  // NOTE: 角色卡加载完成后才加入房间，并把角色摘要交给后端维护玩家列表。
  useEffect(() => {
    if (!roomId || !isCharactersLoaded) return;
    ensureSocketConnected();
    const handleLobbyUpdate = (data: any) => {
      setRoomPlayers(data.players);
      setRoomOwnerName(data.ownerName);
      setIsOwner(myName === data.ownerName);
      if (data.roomConfig?.scriptId) setSelectedScriptId(data.roomConfig.scriptId);
      if (data.roomConfig?.rules) setRoomRules(data.roomConfig.rules);
    };

    const handleLobbyChatReceive = (msg: any) => {
      // NOTE: 闲聊消息不持久化，只在当前大厅会话中广播显示。
      setChatMessages(prev => [...prev, msg]);
    };

    const handleGoToGame = () => {
      navigate(`/game/${roomId}`);
    };

    const handleConnectError = (error: Error) => {
      if (error.message === 'unauthorized') return;
      console.error('Lobby 实时连接失败', error);
    };

    socket.on('lobby_update', handleLobbyUpdate);
    socket.on('lobby_chat_receive', handleLobbyChatReceive);
    socket.on('go_to_game', handleGoToGame);
    socket.on('connect_error', handleConnectError);
    emitWhenConnected(
      'join_lobby',
      { roomId, characterInfo: { id: activeCharacter?.id || null } },
      (result: { success?: boolean; reason?: string }) => {
        if (result?.success) return;
        console.error('加入 Lobby 失败', result?.reason || 'unknown');
      }
    );
    return () => {
      socket.off('lobby_update', handleLobbyUpdate);
      socket.off('go_to_game', handleGoToGame);
      socket.off('lobby_chat_receive', handleLobbyChatReceive);
      socket.off('connect_error', handleConnectError);
    };
  }, [roomId, myName, activeCharacter?.id, isCharactersLoaded, navigate]);

  // SECTION: 大厅闲聊状态
  // NOTE: 初始两条消息只是 UI 占位，不会写入后端日志。
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { id: 1, sender: '系统', text: '欢迎来到房间。', isSystem: true },
    { id: 2, sender: '玩家A', text: '房主搞快点，我的骰子已经饥渴难耐了！', isSystem: false }
  ]);

  // SECTION: 大厅聊天发送
  // NOTE: 发送后只清空本地输入，显示由 lobby_chat_receive 广播统一追加。
  const handleLobbyChat = () => {
    if (!chatInput.trim()) return;
    ensureSocketConnected();
    const msgData = { id: Date.now(), sender: myName, text: chatInput, isSystem: false };
    emitWhenConnected('lobby_chat_send', { roomId, msg: msgData });
    setChatInput('');
  };

  const updateRoomConfig = (scriptId: string, rules: RoomRules) => {
    setSelectedScriptId(scriptId);
    setRoomRules(rules);
    socket.emit('update_room_config', { roomId, scriptId, rules });
  };

  const updateRoomRule = (key: keyof RoomRules, value: number) => {
    updateRoomConfig(selectedScriptId, { ...roomRules, [key]: value });
  };

  const commitRoomRule = (key: keyof RoomRules) => {
    const draft = roomRuleDrafts[key].trim();
    const parsed = Number(draft);
    if (!draft || !Number.isFinite(parsed)) {
      setRoomRuleDrafts(current => ({ ...current, [key]: String(roomRules[key]) }));
      return;
    }

    const { min, max } = ROOM_RULE_RANGES[key];
    const normalized = Math.min(max, Math.max(min, Math.round(parsed)));
    setRoomRuleDrafts(current => ({ ...current, [key]: String(normalized) }));
    if (normalized !== roomRules[key]) updateRoomRule(key, normalized);
  };

  // SECTION: 退出大厅
  // NOTE: 使用 ack + 300ms 兜底，避免网络抖动时用户卡在大厅页。
  const handleExitLobby = () => {
    if (!roomId || !socket.connected) {
      navigate('/hall');
      return;
    }

    let finished = false;
    const finishExit = () => {
      if (finished) return;
      finished = true;
      navigate('/hall');
    };

    socket.emit('leave_room', { roomId }, finishExit);
    window.setTimeout(finishExit, 300);
  };

  return (
    <div className="lobby-container">
      <div className="lobby-header flat-box">
        <h2>房间号: <span className="highlight-text">{roomId}</span></h2>
        <button 
          className="flat-btn secondary small" 
          onClick={handleExitLobby}
        >
          退出大厅
        </button>
      </div>

      <div className="lobby-content">
        <div className="lobby-left-panel flat-box">
          <h3 className="section-title">剧本配置</h3>
          {/* SECTION: 房主配置区 */}
          {/* NOTE: 非房主不显示配置表单，避免误以为能更改剧本或存档。 */}
          {isOwner ? (
            <div className="config-form">
              <div className="room-rule-grid">
                <div className="room-rule-script">
                  <label>选择剧本</label>
                  <StyledSelect
                    value={selectedScriptId}
                    options={scriptOptions}
                    onChange={(scriptId) => updateRoomConfig(scriptId, roomRules)}
                  />
                </div>
                <label className="room-rule-field">
                  <span>购点上限</span>
                  <input
                    type="number"
                    min="100"
                    max="1000"
                    value={roomRuleDrafts.pointBuyLimit}
                    onChange={(event) => setRoomRuleDrafts(current => ({ ...current, pointBuyLimit: event.target.value }))}
                    onFocus={() => setEditingRoomRule('pointBuyLimit')}
                    onBlur={() => { commitRoomRule('pointBuyLimit'); setEditingRoomRule(null); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  />
                </label>
                <label className="room-rule-field">
                  <span>职业技能上限</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={roomRuleDrafts.occupationSkillLimit}
                    onChange={(event) => setRoomRuleDrafts(current => ({ ...current, occupationSkillLimit: event.target.value }))}
                    onFocus={() => setEditingRoomRule('occupationSkillLimit')}
                    onBlur={() => { commitRoomRule('occupationSkillLimit'); setEditingRoomRule(null); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  />
                </label>
                <label className="room-rule-field">
                  <span>兴趣技能上限</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={roomRuleDrafts.interestSkillLimit}
                    onChange={(event) => setRoomRuleDrafts(current => ({ ...current, interestSkillLimit: event.target.value }))}
                    onFocus={() => setEditingRoomRule('interestSkillLimit')}
                    onBlur={() => { commitRoomRule('interestSkillLimit'); setEditingRoomRule(null); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  />
                </label>
              </div>

              <label>选择存档</label>
              <StyledSelect
                value={selectedSaveId}
                options={saveOptions}
                onChange={setSelectedSaveId}
                disabled={!isOwner}
              />
            </div>
          ) : (
            <div className="waiting-box">房主正在配置世界观，请稍等...</div>
          )}

          <h3 className="section-title lobby-section-spaced">我的调查员档案</h3>
          {/* SECTION: 出战角色选择 */}
          {/* NOTE: 切换角色会同步 localStorage，并通过 join_lobby effect 更新后端玩家身份。 */}
          <div className="character-panel">
            {characterList.length === 0 ? (
              <div className="character-empty-state">
                <span>[警告] 检测到当前账号暂无活动的角色卡。</span>
                <button className="flat-btn primary small" onClick={() => navigate('/create-character')}>
                  + 建立新档案 (COC 7th)
                </button>
              </div>
            ) : (
              <div className="character-select-row">
                <label>出战角色：</label>
                
                <StyledSelect
                  value={activeCharacter?.id || ''}
                  options={characterOptions}
                  onChange={(selectedId) => {
                    const selected = characterList.find(c => c.id === selectedId);
                    setActiveCharacter(selected);
                    if (selected) {
                      localStorage.setItem('trpg_current_char_id', selected.id);
                    } else {
                      localStorage.removeItem('trpg_current_char_id');
                    }
                  }}
                />
                <div className="character-actions">
                  <button 
                    className="flat-btn secondary small" 
                    disabled={!activeCharacter}
                    onClick={() => activeCharacter && navigate('/create-character', {
                      state: { character: activeCharacter, roomRules, lockRoomLimits: true },
                    })}
                  >
                    编辑
                  </button>

                  <button 
                    className="flat-btn secondary small" 
                    disabled={!activeCharacter}
                    onClick={async () => {
                      if (!activeCharacter) return;
                      if (window.confirm(`确定要永久销毁档案 [${activeCharacter.name}] 吗？(撕卡不可逆)`)) {
                        try {
                          await apiFetch(`/api/characters/${activeCharacter.id}`, { method: 'DELETE' });
                          await loadCharacters();
                        } catch (err) {
                          alert("撕卡失败，请检查星舰网络连接！");
                        }
                      }
                    }}
                  >
                    删除
                  </button>

                  <button 
                    className="flat-btn secondary small" 
                    onClick={() => navigate('/create-character', {
                      state: { roomRules, lockRoomLimits: true },
                    })}
                  >
                    新建
                  </button>
                </div>
              </div>
            )}
          </div>

          <h3 className="section-title lobby-section-spaced">玩家状态</h3>
          {/* SECTION: 玩家列表 */}
          {/* NOTE: key 混合角色名和 socket id，兼顾同名角色测试与连接刷新。 */}
          <ul className="player-list">
            {roomPlayers.map(player => (
              <li key={`${player.characterName || player.name}-${player.id}`} className="player-item">
                <div className="player-info">
                  <span className={`status-dot ${player.isReady ? 'ready' : 'unready'}`}></span>
                  <span className="player-name">
                    {player.characterName || player.name || '未命名调查员'}
                    {player.name === roomOwnerName ? ' 👑 (房主)' : ' 👥'}
                  </span>
                </div>
                <span className={`player-role ${player.role === '无角色卡' ? 'empty' : ''}`}>[{player.role || '无角色卡'}]</span>
              </li>
            ))}
          </ul>
          {isOwner ? (
            <button 
              className="flat-btn primary start-btn" 
              onClick={() => socket.emit('host_start_game', { roomId, loadSaveId: selectedSaveId })}
            >
              开始游戏 (全员发车)
            </button>
          ) : (
            <button 
              className="flat-btn secondary start-btn" 
              disabled 
            >
              等待房主发车...
            </button>
          )}
        </div>
        <div className="lobby-right-panel flat-box">
          <h3 className="section-title">闲聊频道</h3>
          {/* SECTION: 大厅聊天 */}
          {/* NOTE: 这里只是开局前沟通，不进入正式房间日志和 AI 上下文。 */}
          <div className="chat-box">
            {chatMessages.map(msg => (
              <div key={msg.id} className={`chat-msg ${msg.isSystem ? 'system' : ''}`}>
                <span>[{msg.sender}]</span> {msg.text}
              </div>
            ))}
          </div>
          <div className="chat-input-area">
            <input 
              type="text" 
              className="flat-input" 
              placeholder="随便聊点什么..." 
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLobbyChat()} 
            />
            <button className="flat-btn secondary" onClick={handleLobbyChat}>发送</button>
          </div>
        </div>
      </div>
    </div>
  );
}
