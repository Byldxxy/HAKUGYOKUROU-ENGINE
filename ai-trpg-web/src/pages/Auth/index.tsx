import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '../../config';
import './Auth.css';

export default function Auth() {
  const navigate = useNavigate();

  // SECTION: 表单状态
  // NOTE: 注册页已经删除昵称输入，账号只用于登录，游戏名由角色卡决定。
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // SECTION: 登录/注册提交
  // NOTE: 两种模式复用一个 submit，先做前端轻校验，再交给后端做最终判断。
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isLoginMode) {
      if (!username || !password) return alert("请输入完整的账号和密码！");

      try {
        const response = await fetch(apiUrl('/api/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
          localStorage.setItem('trpg_username', data.username);
          // NOTE: nickname 是旧版本字段，登录后清掉，避免继续影响 ROLL 归属。
          localStorage.removeItem('trpg_nickname');
          navigate('/hall');
        } else {
          alert(data.error);
        }
      } catch (error) {
        alert("无法连接到白玉楼引擎服务器，请检查终端状态！");
      }

    } else {
      if (!username || !password || !confirmPassword) return alert("请填写完整的注册信息！");
      if (password !== confirmPassword) return alert("两次输入的密码不一致，请重新确认！");

      try {
        const response = await fetch(apiUrl('/api/register'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
          // NOTE: 注册成功后直接进入大厅，减少“注册后还要再登录”的本地测试成本。
          localStorage.setItem('trpg_username', data.username);
          localStorage.removeItem('trpg_nickname');
          alert("档案建立成功，即将进入大厅！");
          navigate('/hall');
        } else {
          alert(data.error);
        }
      } catch (error) {
        alert("无法连接到白玉楼引擎服务器，请检查终端状态！");
      }
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card flat-box">
        <div className="auth-header">
          <h1 className="title">白玉楼 TRPG</h1>
          <p className="subtitle">HAKUGYOKUROU ENGINE</p>
        </div>

        {/* SECTION: 登录/注册切换 */}
        {/* NOTE: 两个标签高度和阴影在 CSS 中与提交按钮风格对齐。 */}
        <div className="auth-tabs">
          <button className={`tab-btn ${isLoginMode ? 'active' : ''}`} onClick={() => setIsLoginMode(true)} type="button">登 录</button>
          <button className={`tab-btn ${!isLoginMode ? 'active' : ''}`} onClick={() => setIsLoginMode(false)} type="button">注 册</button>
        </div>

        {/* SECTION: 账号表单 */}
        {/* NOTE: 注册模式只额外出现确认密码，不再收集昵称。 */}
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label>登录账号 (Username)</label>
            <input 
              type="text" 
              className="flat-input auth-input" 
              placeholder="用于登录的唯一ID"
              value={username} onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label>安全密钥 (Password)</label>
            <input 
              type="password" 
              className="flat-input auth-input" 
              placeholder="输入密码"
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {!isLoginMode && (
            <div className="input-group">
              <label>确认密钥 (Confirm)</label>
              <input 
                type="password" 
                className="flat-input auth-input" 
                placeholder="请再次输入密码"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          )}

          <button type="submit" className="flat-btn primary submit-btn">
            {isLoginMode ? '验证并进入' : '建立档案并进入'}
          </button>
        </form>

        <div className="auth-footer">※ 档案将被永久加密储存于服务器</div>
      </div>
    </div>
  );
}
