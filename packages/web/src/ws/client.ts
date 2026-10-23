import { useAppStore } from '../store';
import type { WsMessage } from '../types';

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let hasConnected = false;

export function connectWs(): void {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.addEventListener('open', () => {
    useAppStore.getState().setWsConnected(true);

    if (hasConnected) {
      const {
        selectedId,
        refreshDevices,
        selectDevice,
        loadDictionaries,
      } = useAppStore.getState();
      void refreshDevices();
      void loadDictionaries();
      if (selectedId) void selectDevice(selectedId);
    }
    hasConnected = true;
  });

  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as WsMessage;
      useAppStore.getState().handleWsMessage(message);
    } catch {
      // 忽略无法解析的帧
    }
  });

  socket.addEventListener('close', () => {
    useAppStore.getState().setWsConnected(false);
    socket = null;
    if (reconnectTimer === null) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectWs();
      }, 1500);
    }
  });

  socket.addEventListener('error', () => {
    socket?.close();
  });
}
