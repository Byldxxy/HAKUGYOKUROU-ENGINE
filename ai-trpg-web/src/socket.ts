import { io } from 'socket.io-client';
import { SOCKET_URL } from './config';

// SECTION: Socket 单例
// NOTE: 全站复用同一个连接，避免每个页面各自创建连接导致大厅出现重复玩家。
export const socket = io(SOCKET_URL, {
  // NOTE: 手动连接，页面确认 roomId/角色信息后再 join，避免空身份提前入房。
  autoConnect: false,
  // NOTE: 保留 polling 兜底，再由 Socket.IO 自动升级到 WebSocket，兼容反向代理尚未完成 Upgrade 的环境。
  transports: ['polling', 'websocket'],
  withCredentials: true,
});

socket.on('connect_error', (error) => {
  if (error.message !== 'unauthorized') return;
  localStorage.removeItem('trpg_username');
  localStorage.removeItem('trpg_current_char_id');
  if (window.location.pathname !== '/') window.location.assign('/');
});

// SECTION: 连接兜底
// NOTE: 所有页面发 Socket 事件前都先走这里，保证刷新后的首次 emit 不会丢。
export const ensureSocketConnected = () => {
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
};

// SECTION: 可靠发送
// NOTE: 如果当前还没连上，就等 connect 后补发一次，适合 join_lobby/join_room。
export const emitWhenConnected = (eventName: string, ...args: unknown[]) => {
  ensureSocketConnected();

  if (socket.connected) {
    socket.emit(eventName, ...args);
    return;
  }

  socket.once('connect', () => {
    socket.emit(eventName, ...args);
  });
};
