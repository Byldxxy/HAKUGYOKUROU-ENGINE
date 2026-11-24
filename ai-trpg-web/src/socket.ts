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

export type SocketAck = { success: boolean; reason?: string; message?: string; roomId?: string; started?: boolean; characterId?: string };
export const socketRequest = (event: string, payload: unknown): Promise<SocketAck> => new Promise((resolve, reject) => {
  ensureSocketConnected();
  socket.timeout(10000).emit(event, payload, (error: Error | null, result: SocketAck) => {
    if (error) reject(new Error('连接超时，请检查网络后重试。'));
    else if (!result?.success) reject(new Error(result?.message || socketErrorMessage(result?.reason)));
    else resolve(result);
  });
});
export const socketErrorMessage = (reason?: string) => ({
  room_not_found: '房间不存在，请检查六位房间号。',
  game_started: '游戏已经开始，不能进行此操作。',
  duplicate_name: '房间内已有同名角色，请先修改角色姓名。',
  missing_character: '所有玩家须在线并选择角色卡后才能开始。',
  invalid_character: '角色卡不存在或不属于当前账号。',
  save_party_mismatch: '请让存档中的全部账号选择原角色卡后再继续游戏。',
  invalid_save: '存档无效或无法读取。',
  forbidden: '你没有访问该房间或执行此操作的权限。',
  session_replaced: '当前账号已在另一窗口进入房间。',
  turn_locked: '本轮已经行动，请等待其他玩家。',
  invalid_roll: '该检定已完成、已失效或不属于你。',
  waiting_dm: '正在等待主持回复；失败时可点击重试。',
  rate_limited: '操作过于频繁，请稍后再试。',
}[reason || ''] || '操作失败，请刷新后重试。');
