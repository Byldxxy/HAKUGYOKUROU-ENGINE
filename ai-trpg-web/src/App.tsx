import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Auth from './pages/Auth'; 
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import Game from './pages/Game';
import CreateCharacter from './pages/CreateCharacter';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* SECTION: 入口路由 */}
        {/* NOTE: / 是登录/注册页，登录成功后进入大厅首页 /hall。 */}
        <Route path="/" element={<Auth />} />
        <Route path="/hall" element={<Home />} />

        {/* SECTION: 房间与游戏路由 */}
        {/* NOTE: roomId 是大厅和游戏页共同的房间上下文。 */}
        <Route path="/lobby/:roomId" element={<Lobby />} />
        <Route path="/game/:roomId" element={<Game />} />

        {/* SECTION: 角色卡路由 */}
        {/* NOTE: 新建和编辑共用同一页，编辑数据通过 navigate state 传入。 */}
        <Route path="/create-character" element={<CreateCharacter />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
