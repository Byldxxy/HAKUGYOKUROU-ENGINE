import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();

  // SECTION: 加入房间输入
  // NOTE: 房间号保持 6 位纯数字，和创建房间的随机规则一致。
  const [joinId, setJoinId] = useState('');

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
  const handleLogout = () => {
    localStorage.removeItem('trpg_username');
    localStorage.removeItem('trpg_nickname');
    localStorage.removeItem('trpg_current_char_id');
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
