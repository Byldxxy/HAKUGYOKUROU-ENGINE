import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';
import { apiFetch } from '../../config';
import { socket } from '../../socket';
import StyledSelect from '../../components/StyledSelect';

export default function Home() {
  const navigate = useNavigate();

  // SECTION: 加入房间输入
  // NOTE: 房间号保持 6 位纯数字，和创建房间的随机规则一致。
  const [joinId, setJoinId] = useState('');
  const [characterList, setCharacterList] = useState<any[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<any>(null);

  useEffect(() => {
    const loadCharacters = async () => {
      try {
        const response = await apiFetch('/api/characters');
        const data = await response.json();
        const cards = data.success ? (data.cards || []) : [];
        const savedCharacterId = localStorage.getItem('trpg_current_char_id');
        const selected = cards.find((card: any) => card.id === savedCharacterId) || cards[0] || null;
        setCharacterList(cards);
        setActiveCharacter(selected);
        if (selected) localStorage.setItem('trpg_current_char_id', selected.id);
      } catch (error) {
        console.error('加载角色卡失败', error);
      }
    };
    loadCharacters();
  }, []);

  const characterOptions = useMemo(() => [
    { value: '', label: '无角色卡' },
    ...characterList.map((card) => ({ value: card.id, label: `${card.name} (${card.role || '未知职业'})` })),
  ], [characterList]);

  const selectCharacter = (characterId: string) => {
    const selected = characterList.find((card) => card.id === characterId) || null;
    setActiveCharacter(selected);
    if (selected) localStorage.setItem('trpg_current_char_id', selected.id);
    else localStorage.removeItem('trpg_current_char_id');
  };

  // SECTION: 创建房间
  // NOTE: 当前房间 ID 由前端随机生成；上线前可改成后端生成避免碰撞。
  const handleCreateRoom = () => {
    const randomId = Math.floor(100000 + Math.random() * 900000).toString();
    navigate(`/lobby/${randomId}`);
  };

  // SECTION: 加入房间
  // NOTE: 这里只校验长度，房间是否存在由 Socket 大厅状态自然创建/同步。
  const handleJoinRoom = () => {
    if (joinId.length === 6) {
      navigate(`/lobby/${joinId}`);
    } else {
      alert("请输入正确的 6 位数房间号！");
    }
  };

  // SECTION: 退出登录
  // NOTE: 同时清理当前角色 ID，避免下个账号继承上个账号的出战角色。
  const handleLogout = async () => {
    try {
      await apiFetch('/api/logout', { method: 'POST' });
    } catch {
      // NOTE: 即使网络失败也清理本地状态，避免共用设备残留上一个账号。
    }
    localStorage.removeItem('trpg_username');
    localStorage.removeItem('trpg_nickname');
    localStorage.removeItem('trpg_current_char_id');
    socket.disconnect();
    navigate('/');
  };

  return (
    <div className="home-container">
      <div className="boutique-card">
        <div className="header-group">
          <h1 className="title">白玉楼 TRPG</h1>
          <p className="subtitle">HAKUGYOKUROU ENGINE</p>
        </div>

        {/* SECTION: 大厅入口操作 */}
        {/* NOTE: 欢迎语固定为“Hello，调查员。”，不再展示账号或昵称。 */}
        <div className="action-group">
          <div className="user-panel">
            <span className="greeting">Hello，调查员。</span>
            <button className="logout-btn" onClick={handleLogout}>退出登录</button>
          </div>

          <div className="home-character-panel">
            <label>出战角色</label>
            <div className="home-character-row">
              <StyledSelect
                value={activeCharacter?.id || ''}
                options={characterOptions}
                onChange={selectCharacter}
              />
              <button
                type="button"
                className="flat-btn secondary edit-character-btn"
                disabled={!activeCharacter}
                onClick={() => activeCharacter && navigate('/create-character', { state: { character: activeCharacter } })}
              >
                编辑
              </button>
            </div>
          </div>

          <button className="flat-btn primary" onClick={handleCreateRoom}>
            创建新房间
          </button>
          
          <div className="divider"><span>或者</span></div>

          <div className="join-row">
            <input 
              type="text" 
              className="flat-input"
              placeholder="输入 6 位房间号" 
              maxLength={6}
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
            />
            <button className="flat-btn secondary" onClick={handleJoinRoom}>进入</button>
          </div>
        </div>
        
        <div className="footer-text">极简 · 沉浸 · 纯粹</div>
      </div>
    </div>
  );
}
