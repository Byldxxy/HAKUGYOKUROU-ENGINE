// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Auth from './pages/Auth'; 
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import Game from './pages/Game';
import CreateCharacter from './pages/CreateCharacter';

// 注意：刚才写在外面的代码已经被删掉了

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 默认打开网站先进入登录/注册页 */}
        <Route path="/" element={<Auth />} />
        
        {/* 登录成功后进入的大厅 */}
        <Route path="/hall" element={<Home />} />
        
        <Route path="/lobby/:roomId" element={<Lobby />} />
        <Route path="/game/:roomId" element={<Game />} />

        {/* 👇 把它移动到这里！必须包裹在 <Routes> 内部，且在兜底规则的上方 👇 */}
        <Route path="/create-character" element={<CreateCharacter />} />

        {/* 未知路径统一重定向到登录页 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}