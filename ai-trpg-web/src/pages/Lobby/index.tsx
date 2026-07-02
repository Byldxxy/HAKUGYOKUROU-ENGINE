import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './Lobby.css';
import { apiUrl } from '../../config';
import { emitWhenConnected, ensureSocketConnected, socket } from '../../socket';

type SelectOption = {
  value: string;
  label: string;
};

function StyledSelect({
  value,
  options,
  placeholder,
  disabled = false,
  onChange,
}: {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find(option => option.value === value);

  return (
    <div
      className={`styled-select ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
      tabIndex={disabled ? -1 : 0}
      onBlur={() => setIsOpen(false)}
    >
      <button
        type="button"
        className="styled-select-trigger"
        disabled={disabled}
        onClick={() => setIsOpen(prev => !prev)}
      >
        <span>{selected?.label || placeholder || '请选择'}</span>
        <span className="styled-select-arrow">⌄</span>
      </button>

      {isOpen && !disabled && (
        <div className="styled-select-menu">
          {options.map(option => (
            <button
              type="button"
              key={option.value}
              className={`styled-select-option ${option.value === value ? 'selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <span className="styled-select-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Lobby() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  
  // --- 核心修改：将玩家列表变成实时同步的状态 ---
  const [roomPlayers, setRoomPlayers] = useState<any[]>([]);
  const [isOwner, setIsOwner] = useState(false); // 标记我自己是不是房主
  const [roomOwnerName, setRoomOwnerName] = useState(''); // 新增：记住房主的名字

  // --- 新增：真实账号与多角色卡状态体系 ---
  // 1. 角色卡管理状态：联机展示名统一来自出战角色
  const [characterList, setCharacterList] = useState<any[]>([]); // 该账号下的所有角色卡
  const [activeCharacter, setActiveCharacter] = useState<any>(null); // 本局选中的上场角色
  const [isCharactersLoaded, setIsCharactersLoaded] = useState(false);

  // --- 4. 新增：战役存档系统状态 ---
  const [saveList, setSaveList] = useState<any[]>([]);
  const [selectedSaveId, setSelectedSaveId] = useState('');
  const [selectedScriptId, setSelectedScriptId] = useState('peach');

  const scriptOptions = [
    { value: 'peach', label: '桃花岛历险记' },
    { value: 'ctms', label: 'CTMS货舱危机' },
    { value: 'custom', label: '自定义空白团' },
  ];

  const loadCharacters = useCallback(async () => {
    const username = localStorage.getItem('trpg_username');
    if (!username) {
      setIsCharactersLoaded(true);
      return;
    }

    try {
      setIsCharactersLoaded(false);
      const res = await fetch(apiUrl(`/api/characters?username=${username}`));
      const data = await res.json();
      const cards = data.success ? (data.cards || []) : [];
      const savedCharId = localStorage.getItem('trpg_current_char_id');
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

  // 页面加载时，顺便去服务器把这个房主名下的所有存档拉下来
  useEffect(() => {
    const fetchSaves = async () => {
      const username = localStorage.getItem('trpg_username');
      if (username) {
        try {
          const res = await fetch(apiUrl(`/api/saves?username=${username}`));
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
  
  // 3. 核心：跑团网络身份统一绑定角色卡名
  const myName = activeCharacter?.name || '未知调查员'; 
  const myCharacter = useMemo(
    () => activeCharacter || { name: myName, role: "暂无角色", hp: "-", san: "-", mp: "-" },
    [activeCharacter, myName]
  );

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

  useEffect(() => {
    if (!roomId || !isCharactersLoaded) return;
    ensureSocketConnected();

    // B. 听广播：只要有人进出，后端发来新名单，就立刻刷新界面
    const handleLobbyUpdate = (data: any) => {
      setRoomPlayers(data.players);
      setRoomOwnerName(data.ownerName); // 存下后端传来的房主名
      setIsOwner(myName === data.ownerName); // 靠我的名字和房主名字比对来解锁权限！
    };

    const handleLobbyChatReceive = (msg: any) => {
      setChatMessages(prev => [...prev, msg]);
    };

    const handleGoToGame = () => {
      navigate(`/game/${roomId}`);
    };

    socket.on('lobby_update', handleLobbyUpdate);
    socket.on('lobby_chat_receive', handleLobbyChatReceive);
    socket.on('go_to_game', handleGoToGame);

    // A. 进页面第一件事：向后端报到，加入大厅
    emitWhenConnected('join_lobby', {
      roomId,
      playerName: myName,
      characterInfo: myCharacter
    });

    // D. 销毁组件时卸载监听
    return () => {
      socket.off('lobby_update', handleLobbyUpdate);
      socket.off('go_to_game', handleGoToGame);
      socket.off('lobby_chat_receive', handleLobbyChatReceive);
    };
  }, [roomId, myName, myCharacter, isCharactersLoaded, navigate]);

  // --- 新增：大厅闲聊状态 ---
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { id: 1, sender: '系统', text: '欢迎来到房间。', isSystem: true },
    { id: 2, sender: '玩家A', text: '房主搞快点，我的骰子已经饥渴难耐了！', isSystem: false }
  ]);

  const handleLobbyChat = () => {
    if (!chatInput.trim()) return;
    ensureSocketConnected();
    const msgData = { id: Date.now(), sender: myName, text: chatInput, isSystem: false };
    
    // 关键：把消息通过对讲机发给后端广播！
    emitWhenConnected('lobby_chat_send', { roomId, msg: msgData });
    setChatInput('');
  };

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

    socket.emit('leave_room', { roomId, playerName: myName }, finishExit);
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
        {/* 左侧：参数配置与玩家列表 */}
        <div className="lobby-left-panel flat-box">
          <h3 className="section-title">剧本配置</h3>
          {isOwner ? (
            <div className="config-form">
              <label>选择剧本设定</label>
              <StyledSelect
                value={selectedScriptId}
                options={scriptOptions}
                onChange={setSelectedScriptId}
              />

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

          <h3 className="section-title" style={{ marginTop: '25px', marginBottom: '10px' }}>我的调查员档案</h3>
          <div className="character-panel flat-box" style={{ background: '#f5f5f5', padding: '15px', border: '1px dashed #ccc', borderRadius: '4px' }}>
            {characterList.length === 0 ? (
              <div style={{ textAlign: 'center' }}>
                <span style={{ color: '#d32f2f', fontSize: '14px', display: 'block', marginBottom: '10px' }}>[警告] 检测到当前账号暂无活动的角色卡。</span>
                <button className="flat-btn primary small" onClick={() => navigate('/create-character')}>
                  + 建立新档案 (COC 7th)
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <label style={{ fontSize: '14px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>出战角色：</label>
                
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

                {/* 2. 右侧三个等宽的操作按钮容器 */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    className="flat-btn secondary small" 
                    style={{ width: '65px', padding: '6px 0', textAlign: 'center', opacity: activeCharacter ? 1 : 0.5, cursor: activeCharacter ? 'pointer' : 'not-allowed' }}
                    disabled={!activeCharacter}
                    onClick={() => activeCharacter && navigate('/create-character', { state: { character: activeCharacter } })}
                  >
                    编辑
                  </button>
                  
                  <button 
                    className="flat-btn secondary small" 
                    style={{ width: '65px', padding: '6px 0', textAlign: 'center', opacity: activeCharacter ? 1 : 0.5, cursor: activeCharacter ? 'pointer' : 'not-allowed' }}
                    disabled={!activeCharacter}
                    onClick={async () => {
                      if (!activeCharacter) return;
                      if (window.confirm(`确定要永久销毁档案 [${activeCharacter.name}] 吗？(撕卡不可逆)`)) {
                        const username = localStorage.getItem('trpg_username');
                        try {
                          await fetch(apiUrl(`/api/characters/${username}/${activeCharacter.id}`), { method: 'DELETE' });
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
                    style={{ width: '65px', padding: '6px 0', textAlign: 'center' }}
                    onClick={() => navigate('/create-character')}
                  >
                    新建
                  </button>
                </div>
              </div>
            )}
          </div>

          <h3 className="section-title" style={{ marginTop: '30px' }}>玩家状态</h3>
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
                <span className="player-role" style={{ color: player.role === '暂无角色' ? '#999' : '#333' }}>[{player.role || '暂无角色'}]</span>
              </li>
            ))}
          </ul>

          {/* 根据是否是房主，渲染不同的按钮逻辑 */}
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
              style={{ width: '100%', padding: '12px 0', marginTop: '15px', cursor: 'not-allowed', opacity: 0.6 }}
            >
              等待房主发车...
            </button>
          )}
        </div>

        {/* 右侧：闲聊区 */}
        <div className="lobby-right-panel flat-box">
          <h3 className="section-title">闲聊频道</h3>
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
