import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './Lobby.css';
import { useChatEnter } from '../../components/useChatEnter';
import OfflineRollPreference from '../../components/OfflineRollPreference';
import HostApiPanel, { type HostReadiness } from '../../components/HostApiPanel';
import { apiFetch, apiUrl } from '../../config';
import type { Character, PublicPlayer, Save, LobbyMessage } from '../../domain/types';
import { socketRequest, socketErrorMessage, ensureSocketConnected, socket } from '../../socket';
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

const scenarioIntroductions: Record<string, string> = {
  peach: '一次秦岭徒步遇上了反常的桃花雾。适合想和同伴展开长线冒险的调查员。',
  ontology: '你在自己的葬礼上醒来，面前的人都唤你祭司。围绕身份与记忆展开的悬疑调查。',
  harbour: '港口声音馆明早开幕，一段旧录音还缺一个署名。适合初团的短篇，可自由走访档案室和会客室。',
};

const playerBlocker = (player: PublicPlayer) => {
  if (!player.id) return '等待重连';
  if (!player.characterId) return '未选角色';
  if (player.fitsRoomRules === false) return '角色卡不符合房规';
  return '';
};

export default function Lobby() {
  const { roomId } = useParams();
  return <RoomLobby key={roomId} roomId={roomId} />;
}

function RoomLobby({ roomId }: { roomId?: string }) {
  const navigate = useNavigate();

  const [chatInput, setChatInput] = useState('');
  const sendingChat = useRef(false);
  const enterKey = useChatEnter();
  const [chatMessages, setChatMessages] = useState<LobbyMessage[]>([]);
  const [previousPage, setPreviousPage] = useState<number | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatReady, setChatReady] = useState(false);
  const chatBox = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const heightBeforePrepend = useRef<number | null>(null);
  useLayoutEffect(() => {
    const box = chatBox.current;
    if (!box) return;
    if (heightBeforePrepend.current !== null) {
      box.scrollTop += box.scrollHeight - heightBeforePrepend.current;
      heightBeforePrepend.current = null;
    } else if (followLatest.current) box.scrollTop = box.scrollHeight;
  }, [chatMessages]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [hostStatus, setHostStatus] = useState<HostReadiness | null>(null);
  const characterControls = useRef<HTMLDivElement>(null);
  const focusCharacterChoice = () => characterControls.current?.querySelector<HTMLButtonElement>('button')?.focus();
  // SECTION: 大厅状态
  // NOTE: 房主身份由后端 ownerName 广播决定，前端不自行猜测。
  const [roomPlayers, setRoomPlayers] = useState<PublicPlayer[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [roomOwnerName, setRoomOwnerName] = useState('');

  // SECTION: 角色与存档状态
  // NOTE: activeCharacter 决定玩家在大厅和游戏内的展示名，也是 ROLL 归属依据。
  const [characterList, setCharacterList] = useState<Character[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null);
  const [isCharactersLoaded, setIsCharactersLoaded] = useState(false);
  const [saveList, setSaveList] = useState<Save[]>([]);
  const [selectedSaveId, setSelectedSaveId] = useState('');
  const [selectedScriptId, setSelectedScriptId] = useState('peach');
  const [roomRules, setRoomRules] = useState<RoomRules>(DEFAULT_ROOM_RULES);
  const [roomRuleDrafts, setRoomRuleDrafts] = useState<RoomRuleDrafts>(() => createRoomRuleDrafts(DEFAULT_ROOM_RULES));
  const [editingRoomRule, setEditingRoomRule] = useState<keyof RoomRules | null>(null);

  // SECTION: 剧本选项
  // NOTE: 当前只作为 UI 选择保留，AI 实际模型和提示词仍由后端配置控制。
  const scriptOptions = [
    { value: 'peach', label: '桃花岛历险记' },
    { value: 'ontology', label: '本质' },
    { value: 'harbour', label: '闭馆前的十秒' },
    { value: 'ctms', label: 'CTMS货舱危机（待接入）', disabled: true },
    { value: 'custom', label: '自定义空白团（待接入）', disabled: true },
  ];

  // SECTION: 角色卡加载
  // NOTE: 加载完成前不 join_lobby，避免用“未知调查员”占位写入房间玩家列表。
  const loadCharacters = useCallback(() => apiFetch('/api/characters')
    .then(response => { if (!response.ok) throw new Error('角色卡加载失败'); return response.json(); })
    .then(data => {
      const cards: Character[] = data.success ? (data.cards || []) : [];
      const savedCharId = localStorage.getItem('trpg_current_char_id');
      const selected = cards.find(card => card.id === savedCharId) || cards[0] || null;
      setCharacterList(cards);
      setActiveCharacter(selected);
      if (selected) localStorage.setItem('trpg_current_char_id', selected.id);
      else localStorage.removeItem('trpg_current_char_id');
      setIsCharactersLoaded(true);
    }).catch(error => { console.error(error); alert('角色卡加载失败，请刷新重试。'); }), []);

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
    let active = true;
    ensureSocketConnected();
    const handleLobbyUpdate = (data: { players: PublicPlayer[]; ownerName: string; ownerId: string; roomConfig: { scriptId: string; rules: RoomRules } }) => {
      setRoomPlayers(data.players);
      setStartError('');
      setRoomOwnerName(data.ownerName);
      setIsOwner(socket.id === data.ownerId);
      if (data.roomConfig?.scriptId) setSelectedScriptId(data.roomConfig.scriptId);
      if (data.roomConfig?.rules) setRoomRules(data.roomConfig.rules);
    };

    const handleLobbyChatSnapshot = (data: { roomId: string; messages: LobbyMessage[]; previousPage: number | null }) => {
      if (data.roomId !== roomId) return;
      followLatest.current = true;
      setChatMessages(data.messages);
      setPreviousPage(data.previousPage);
      setChatReady(true);
    };
    const handleLobbyChatReceive = (msg: LobbyMessage & { roomId: string }) => {
      if (msg.roomId === roomId) setChatMessages(prev => [...prev, msg]);
    };
    const disconnected = () => setChatReady(false);

    const handleGoToGame = () => {
      navigate(`/game/${roomId}`);
    };

    const handleConnectError = (error: Error) => {
      if (error.message === 'unauthorized') return;
      console.error('Lobby 实时连接失败', error);
    };

    socket.on('lobby_update', handleLobbyUpdate);
    socket.on('disconnect', disconnected);
    socket.on('lobby_chat_snapshot', handleLobbyChatSnapshot);
    socket.on('lobby_chat_receive', handleLobbyChatReceive);
    socket.on('go_to_game', handleGoToGame);
    socket.on('connect_error', handleConnectError);
    const join = async () => {
      try {
        const result = await socketRequest('join_lobby', { roomId, characterInfo: { id: activeCharacter?.id || null } });
        if (!active) return;
        if (result.started) {
          if (result.characterId) localStorage.setItem('trpg_current_char_id', result.characterId);
          navigate(`/game/${roomId}`, { replace: true });
        }
      } catch (error) { if (active) { alert((error as Error).message); navigate('/hall', { replace: true }); } }
    };
    const handleSessionError = (data: { reason: string }) => {
      alert(socketErrorMessage(data.reason)); navigate('/hall', { replace: true });
    };
    socket.on('session_error', handleSessionError);
    socket.on('connect', join);
    if (socket.connected) void join();
    return () => {
      active = false;
      socket.off('connect', join);
      socket.off('session_error', handleSessionError);
      socket.off('lobby_update', handleLobbyUpdate);
      socket.off('go_to_game', handleGoToGame);
      socket.off('disconnect', disconnected);
      socket.off('lobby_chat_snapshot', handleLobbyChatSnapshot);
      socket.off('lobby_chat_receive', handleLobbyChatReceive);
      socket.off('connect_error', handleConnectError);
    };
  }, [roomId, activeCharacter?.id, isCharactersLoaded, navigate]);

  // SECTION: 大厅聊天发送
  // NOTE: 发送后只清空本地输入，显示由 lobby_chat_receive 广播统一追加。
  const handleLobbyChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy || !chatReady || sendingChat.current) return;
    sendingChat.current = true;
    setChatBusy(true);
    try {
      await socketRequest('lobby_chat_send', { roomId, msg: { text } });
      setChatInput(current => current.trim() === text ? '' : current);
    } catch (error) { alert((error as Error).message); }
    finally { sendingChat.current = false; setChatBusy(false); }
  };
  const loadOlderChat = async () => {
    if (previousPage === null || chatBusy) return;
    setChatBusy(true);
    try {
      const page = await socketRequest('lobby_chat_history', { roomId, page: previousPage });
      heightBeforePrepend.current = chatBox.current?.scrollHeight ?? null;
      setChatMessages(current => [...(page.messages || []).filter(msg => !current.some(m => m.id === msg.id)), ...current]);
      setPreviousPage(page.previousPage ?? null);
    } catch (error) { alert((error as Error).message); }
    finally { setChatBusy(false); }
  };

  const updateRoomConfig = async (scriptId: string, rules: RoomRules) => {
    try { await socketRequest('update_room_config', { roomId, scriptId, rules }); }
    catch (error) { alert((error as Error).message); }
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

  const missingApi = hostStatus && !hostStatus.configured;
  const missingCredits = hostStatus?.mode === 'site' && (hostStatus.balance ?? 0) < 1;
  const playerBlockers = roomPlayers.filter(playerBlocker).length;
  const blockers = playerBlockers + Number(Boolean(missingApi || missingCredits));
  const startBlocked = !chatReady || !hostStatus || !roomPlayers.length || blockers > 0;

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
                    value={editingRoomRule === 'pointBuyLimit' ? roomRuleDrafts.pointBuyLimit : String(roomRules.pointBuyLimit)}
                    onChange={(event) => setRoomRuleDrafts(current => ({ ...current, pointBuyLimit: event.target.value }))}
                    onFocus={() => { setRoomRuleDrafts(createRoomRuleDrafts(roomRules)); setEditingRoomRule('pointBuyLimit'); }}
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
                    value={editingRoomRule === 'occupationSkillLimit' ? roomRuleDrafts.occupationSkillLimit : String(roomRules.occupationSkillLimit)}
                    onChange={(event) => setRoomRuleDrafts(current => ({ ...current, occupationSkillLimit: event.target.value }))}
                    onFocus={() => { setRoomRuleDrafts(createRoomRuleDrafts(roomRules)); setEditingRoomRule('occupationSkillLimit'); }}
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
                    value={editingRoomRule === 'interestSkillLimit' ? roomRuleDrafts.interestSkillLimit : String(roomRules.interestSkillLimit)}
                    onChange={(event) => setRoomRuleDrafts(current => ({ ...current, interestSkillLimit: event.target.value }))}
                    onFocus={() => { setRoomRuleDrafts(createRoomRuleDrafts(roomRules)); setEditingRoomRule('interestSkillLimit'); }}
                    onBlur={() => { commitRoomRule('interestSkillLimit'); setEditingRoomRule(null); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  />
                </label>
              </div>

              {!selectedSaveId && <p className="scenario-introduction">{scenarioIntroductions[selectedScriptId]}</p>}
              <label>选择存档</label>
              <StyledSelect
                value={selectedSaveId}
                options={saveOptions}
                onChange={value => { setSelectedSaveId(value); setStartError(''); }}
                disabled={!isOwner}
              />
            </div>
          ) : (
            <div className="waiting-box">房主正在配置本次战役</div>
          )}

          <h3 className="section-title lobby-section-spaced">我的调查员档案</h3>
          {/* SECTION: 出战角色选择 */}
          {/* NOTE: 切换角色会同步 localStorage，并通过 join_lobby effect 更新后端玩家身份。 */}
          <div className="character-panel" ref={characterControls}>
            {characterList.length === 0 ? (
              <div className="character-empty-state">
                <span>[警告] 检测到当前账号暂无活动的角色卡。</span>
                <button className="flat-btn primary small" onClick={() => navigate('/create-character', { state: { roomId, roomRules, lockRoomLimits: true } })}>
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
                    setActiveCharacter(selected || null);
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
                      state: { character: activeCharacter, roomId, roomRules, lockRoomLimits: true },
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
                          const response = await apiFetch(`/api/characters/${activeCharacter.id}`, { method: 'DELETE' });
                          if (!response.ok) throw new Error('delete');
                          await loadCharacters();
                        } catch {
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
                      state: { roomId, roomRules, lockRoomLimits: true },
                    })}
                  >
                    新建
                  </button>
                </div>
              </div>
            )}
          </div>

          {roomId && <OfflineRollPreference roomId={roomId} enabled={roomPlayers.find(p => p.id === socket.id)?.offlineRoll} />}
          <h3 className="section-title lobby-section-spaced">开团准备</h3>
          {/* SECTION: 玩家列表 */}
          {/* NOTE: key 混合角色名和 socket id，兼顾同名角色测试与连接刷新。 */}
          <ul className="player-list">
            {roomPlayers.map(player => (
              <li key={`${player.characterName || player.name}-${player.id}`} className="player-item">
                <div className="player-info">
                  <span className={`status-dot ${playerBlocker(player) ? 'unready' : 'ready'}`}></span>
                  {player.avatarPath && <img className="player-portrait" src={apiUrl(player.avatarPath)} alt={player.name + '的头像'} />}
                  <span className="player-name">
                    {player.characterName || player.name || '未命名调查员'}
                    {player.name === roomOwnerName ? ' 👑 (房主)' : ' 👥'}
                  </span>
                </div>
                <div className="player-readiness">
                  <span>{playerBlocker(player) || player.role || '已就绪'}</span>
                  {player.id === socket.id && !player.characterId && (
                    <button type="button" className="readiness-link" onClick={focusCharacterChoice}>
                      {characterList.length ? '选择角色' : '建立角色'}
                    </button>
                  )}
                  {player.id === socket.id && player.fitsRoomRules === false && activeCharacter && (
                    <button type="button" className="readiness-link" onClick={() => navigate('/create-character', {
                      state: { character: activeCharacter, roomId, roomRules, lockRoomLimits: true },
                    })}>调整角色卡</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {isOwner && roomId && (
            <div className="host-readiness">
              <span role="status">{!hostStatus ? '正在确认主持配置…' : missingApi ? '主持接口待配置'
                : missingCredits ? '站点额度不足 1 点' : hostStatus.mode === 'custom' ? '自有主持接口已配置' : '站点主持接口已配置'}</span>
              <HostApiPanel roomId={roomId} onReadiness={setHostStatus} />
            </div>
          )}
          {isOwner && (!chatReady || blockers > 0 || selectedSaveId || startError) && (
            <p className="start-readiness" role="status">
              {!chatReady ? '正在同步房间…' : blockers ? `还有 ${blockers} 项开团准备待完成`
                : startError || '读档时需原班玩家选择各自的原角色卡。'}
            </p>
          )}
          {isOwner ? (
            <button
              className="flat-btn primary start-btn"
              disabled={starting || startBlocked}
              onClick={async () => {
                setStarting(true);
                setStartError('');
                try { await socketRequest('host_start_game', { roomId, loadSaveId: selectedSaveId }); }
                catch (error) { setStartError((error as Error).message); }
                finally { setStarting(false); }
              }}
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
          <div className="chat-box" ref={chatBox} onScroll={event => {
            const box = event.currentTarget;
            followLatest.current = box.scrollHeight - box.clientHeight - box.scrollTop < 24;
          }}>
            {previousPage === null ? <div className="chat-msg system">欢迎来到房间。</div> :
              <button className="flat-btn secondary small" disabled={chatBusy || !chatReady} onClick={loadOlderChat}>查看更早的闲聊</button>}
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
              placeholder="随便聊点什么..." maxLength={2000}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              {...enterKey.compositionEvents}
              onKeyDown={(e) => { if (enterKey.shouldSubmit(e)) void handleLobbyChat(); }}
            />
            <button className="flat-btn secondary" disabled={chatBusy || !chatReady || !chatInput.trim()} onClick={handleLobbyChat}>发送</button>
          </div>
        </div>
      </div>
    </div>
  );
}
