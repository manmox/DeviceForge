import type { Server as HttpServer } from 'node:http';
import type { ConnectionInfo, DeviceStatus, TrafficEvent } from '@deviceforge/core';
import { WebSocket, WebSocketServer } from 'ws';
import type { DeviceStateEvent, RuntimeErrorEvent } from '../runtime-manager';

const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const FLUSH_INTERVAL_MS = 100;
const BATCH_LIMIT = 200;

export class WsHub {
  private readonly wss: WebSocketServer;
  private readonly alive = new WeakSet<WebSocket>();
  private readonly batch: TrafficEvent[] = [];
  private readonly flushTimer: NodeJS.Timeout;
  private readonly heartbeatTimer: NodeJS.Timeout;

  constructor(
    server: HttpServer,
    private readonly snapshotProvider: () => unknown,
  ) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (socket) => {
      this.alive.add(socket);
      socket.on('pong', () => this.alive.add(socket));
      socket.on('error', () => undefined);
      this.send(socket, { type: 'snapshot', payload: this.snapshotProvider() });
    });

    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.heartbeatTimer = setInterval(() => {
      // alive 表示“上一次 ping 之后收到过 pong”。每轮先终止未回应的连接，
      // 再清除标记并 ping 其余连接。
      for (const socket of this.wss.clients) {
        if (!this.alive.has(socket)) {
          socket.terminate();
          continue;
        }
        this.alive.delete(socket);
        socket.ping();
      }
    }, 30_000);
  }

  pushTraffic(event: TrafficEvent): void {
    this.batch.push(event);
    if (this.batch.length >= BATCH_LIMIT) this.flush();
  }

  status(status: DeviceStatus): void {
    this.broadcast('status', status);
  }

  connections(deviceId: string, connections: ConnectionInfo[]): void {
    this.broadcast('connections', { deviceId, connections });
  }

  error(error: RuntimeErrorEvent): void {
    this.broadcast('error', error);
  }

  state(event: DeviceStateEvent): void {
    this.broadcast('state', event);
  }

  devicesChanged(): void {
    this.broadcast('devicesChanged', { ts: Date.now() });
  }

  dictionariesChanged(): void {
    this.broadcast('dictionariesChanged', { ts: Date.now() });
  }

  close(): void {
    clearInterval(this.flushTimer);
    clearInterval(this.heartbeatTimer);
    this.flush();
    for (const socket of this.wss.clients) socket.close();
    this.wss.close();
  }

  private flush(): void {
    if (this.batch.length === 0) return;
    const events = this.batch.splice(0, this.batch.length);
    this.broadcast('traffic', events);
  }

  private broadcast(type: string, payload: unknown): void {
    const data = JSON.stringify({ type, payload });
    for (const socket of this.wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      // 对缓冲超过上限的慢客户端直接丢弃流量，避免无限积压；它们会在下一次
      // 状态事件或重连快照时恢复。
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      socket.send(data, (error) => {
        if (error) socket.terminate();
      });
    }
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }
}
