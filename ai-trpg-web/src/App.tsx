import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SessionGate from './components/SessionGate';
import Auth from './pages/Auth';

const Home = lazy(() => import('./pages/Home'));
const Lobby = lazy(() => import('./pages/Lobby'));
const Game = lazy(() => import('./pages/Game'));
const CreateCharacter = lazy(() => import('./pages/CreateCharacter'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="auth-container" role="status">正在加载页面…</div>}>
        <Routes>
          {/* SECTION: 入口路由 */}
          {/* NOTE: / 是登录/注册页，登录成功后进入大厅首页 /hall。 */}
          <Route path="/" element={<Auth />} />
          <Route element={<SessionGate />}>
            <Route path="/hall" element={<Home />} />

            {/* SECTION: 房间与游戏路由 */}
            {/* NOTE: roomId 是大厅和游戏页共同的房间上下文。 */}
            <Route path="/lobby/:roomId" element={<Lobby />} />
            <Route path="/game/:roomId" element={<Game />} />

            {/* SECTION: 角色卡路由 */}
            {/* NOTE: 新建和编辑共用同一页，编辑数据通过 navigate state 传入。 */}
            <Route path="/create-character" element={<CreateCharacter />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
