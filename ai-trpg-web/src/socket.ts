import { io } from 'socket.io-client';
import { SOCKET_URL } from './config';

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket'],
});

export const ensureSocketConnected = () => {
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
};

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
