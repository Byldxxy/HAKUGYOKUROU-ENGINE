import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const [joinId, setJoinId] = useState('');

  const handleCreateRoom = () => {
    const randomId = Math.floor(100000 + Math.random() * 900000).toString();
    navigate(`/lobby/${randomId}`);
  };

  const handleJoinRoom = () => {
    if (joinId.length === 6) {
      navigate(`/lobby/${joinId}`);
    } else {
      alert("请输入正确的 6 位数房间号！");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('trpg_username');
    localStorage.removeItem('trpg_nickname');
    localStorage.removeItem('trpg_current_char_id');
    navigate('/'); // 踢回登录页
  };

  return (
    <div className="home-container">
      <div className="boutique-card">
        <div className="header-group">
          <h1 className="title">白玉楼 TRPG</h1>
          <p className="subtitle">HAKUGYOKUROU ENGINE</p>
        </div>

        <div className="action-group">
          {/* --- 新增：用户欢迎面板与退出按钮 --- */}
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
