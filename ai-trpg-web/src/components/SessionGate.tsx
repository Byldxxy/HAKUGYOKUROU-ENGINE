import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { apiFetch } from '../config';

export default function SessionGate() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'guest' | 'error'>('loading');
  const location = useLocation();
  useEffect(() => {
    let active = true;
    apiFetch('/api/me').then(async (response) => {
      if (response.status === 401) { if (active) setStatus('guest'); return; }
      if (!response.ok) throw new Error('session');
      const data = await response.json();
      if (!active) return;
      localStorage.setItem('trpg_username', data.username);
      setStatus('ready');
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, []);
  if (status === 'loading') return <div className="auth-container">正在恢复登录状态…</div>;
  if (status === 'error') return <div className="auth-container"><p>暂时无法连接服务器。</p><button className="flat-btn secondary" onClick={() => window.location.reload()}>重试</button></div>;
  if (status === 'guest') return <Navigate to="/" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
