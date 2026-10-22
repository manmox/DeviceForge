import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import type { ReconnectConfig, TcpClientTransport } from '../schema/device';
import type { ConnectionInfo, TransportStatus } from '../types';
import type { TransportAdapter, TransportEvents } from './types';

const RECONNECT_FACTOR = 2;
const RECONNECT_JITTER = 0.2;
const MIN_RECONNECT_DELAY_MS = 10;

interface ActiveConnection {
  info: ConnectionInfo;
  socket: Socket;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function formatHostPort(host: string, port: number): string {
  const formattedHost =
    host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${formattedHost}:${port}`;
}

/**
 * 计算下一次重连等待时间。attempt 从 1 开始；成功后由调用方清零。
 * 指数因子固定为 2，抖动固定为 ±20%，避免为每个设备暴露过多参数。
 */
export function nextReconnectDelay(
  attempt: number,
  reconnect: ReconnectConfig,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(
    reconnect.maxDelayMs,
    reconnect.minDelayMs * RECONNECT_FACTOR ** exponent,
  );
  const jittered = base * (1 + (random() * 2 - 1) * RECONNECT_JITTER);
  return Math.max(
    MIN_RECONNECT_DELAY_MS,
    Math.min(reconnect.maxDelayMs, Math.round(jittered)),
  );
}

export class TcpClientTransportAdapter implements TransportAdapter {
  readonly kind = 'tcp-client';

  private events?: TransportEvents;
  private active?: ActiveConnection;
  private endpointList: string[] = [];
  private currentStatus: TransportStatus = { kind: 'tcp-client', state: 'idle' };
  private running = false;
  private generation = 0;
  private attempt = 0;
  private outageReported = false;
  private paused = false;
  private retryTimer?: NodeJS.Timeout;
  private connectTimer?: NodeJS.Timeout;
  private connectSocket?: Socket;

  constructor(private readonly config: TcpClientTransport) {}

  async start(events: TransportEvents): Promise<void> {
    if (this.running) throw new Error('TCP client 已经启动');

    this.events = events;
    this.running = true;
    this.generation += 1;
    this.attempt = 0;
    this.outageReported = false;
    this.paused = false;
    this.endpointList = [formatHostPort(this.config.host, this.config.port)];
    this.currentStatus = { kind: 'tcp-client', state: 'connecting' };
    // 设备启动不等待上游可用；首拨放到下一个事件循环，避免阻塞 start。
    const generation = this.generation;
    events.onStatus(this.status());
    setImmediate(() => {
      if (this.isCurrent(generation)) this.dial(generation, 'initial');
    });
  }

  async stop(): Promise<void> {
    const events = this.events;
    this.running = false;
    this.generation += 1;
    this.clearRetryTimer();
    this.clearConnectTimer();

    const socket = this.connectSocket;
    this.connectSocket = undefined;
    this.active = undefined;
    this.endpointList = [];
    this.attempt = 0;
    this.outageReported = false;
    this.paused = false;
    this.currentStatus = { kind: 'tcp-client', state: 'idle' };

    // 先广播 idle，再清空事件并销毁 socket；后续 close/error 回调会被 generation 忽略。
    events?.onStatus(this.status());
    this.events = undefined;
    socket?.destroy();
  }

  async send(connectionId: string, data: Buffer): Promise<void> {
    const connection = this.active;
    if (
      !connection ||
      connection.info.id !== connectionId ||
      connection.socket.destroyed
    ) {
      throw new Error('上游尚未连接');
    }

    await new Promise<void>((resolve, reject) => {
      connection.socket.write(data, (error?: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });

    connection.info.txBytes += data.length;
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = this.active;
    if (!connection || connection.info.id !== connectionId) return;

    // 主动断开暂停自动重连；设备重启后会重新开始连接流程。
    this.paused = true;
    this.clearRetryTimer();
    this.clearConnectTimer();
    connection.socket.destroy();
  }

  connections(): ConnectionInfo[] {
    return this.active ? [{ ...this.active.info }] : [];
  }

  endpoints(): string[] {
    return [...this.endpointList];
  }

  lastConnectionId(): string | undefined {
    return this.active?.info.id;
  }

  status(): TransportStatus {
    return { ...this.currentStatus };
  }

  private isCurrent(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private dial(generation: number, mode: 'initial' | 'retry'): void {
    if (!this.isCurrent(generation)) return;

    this.clearRetryTimer();
    if (mode === 'retry') {
      this.currentStatus = {
        kind: 'tcp-client',
        state: 'reconnecting',
        attempt: this.attempt,
        error: this.currentStatus.error,
      };
      this.emitStatus();
    }

    let socket: Socket;
    try {
      socket = createConnection({
        host: this.config.host,
        port: this.config.port,
      });
    } catch (error) {
      this.failDial(generation, asError(error));
      return;
    }

    this.connectSocket = socket;
    socket.setNoDelay(true);

    let connected = false;
    let closed = false;
    let lastError: Error | undefined;

    socket.on('error', (error: Error) => {
      // 连接错误只记录下来，统一由 close 路径清理并调度重连。
      lastError = error;
    });

    this.connectTimer = setTimeout(() => {
      this.connectTimer = undefined;
      if (!this.isCurrent(generation) || closed || connected) return;
      lastError = new Error(`连接超时（${this.config.connectTimeoutMs}ms）`);
      socket.destroy(lastError);
    }, this.config.connectTimeoutMs);

    socket.once('connect', () => {
      if (!this.isCurrent(generation) || closed) {
        socket.destroy();
        return;
      }

      connected = true;
      this.clearConnectTimer();
      this.connectSocket = socket;

      const info: ConnectionInfo = {
        id: randomUUID(),
        remoteAddress: socket.remoteAddress ?? this.config.host,
        remotePort: socket.remotePort ?? this.config.port,
        connectedAt: Date.now(),
        rxBytes: 0,
        txBytes: 0,
      };

      this.active = { info, socket };
      this.attempt = 0;
      this.outageReported = false;
      this.paused = false;
      this.currentStatus = {
        kind: 'tcp-client',
        state: 'connected',
      };
      this.emitStatus();

      socket.on('data', (data: Buffer) => {
        if (!this.isCurrent(generation) || this.active?.socket !== socket) return;
        info.rxBytes += data.length;
        try {
          this.events?.onData(info.id, data);
        } catch (error) {
          this.events?.onError(asError(error), info.id);
        }
      });

      try {
        this.events?.onConnect({ ...info });
      } catch (error) {
        this.events?.onError(asError(error), info.id);
      }
    });

    socket.once('close', () => {
      if (closed) return;
      closed = true;
      if (this.connectSocket === socket) {
        this.connectSocket = undefined;
        this.clearConnectTimer();
      }

      const wasActive = this.active?.socket === socket;
      if (wasActive) {
        const id = this.active!.info.id;
        this.active = undefined;
        try {
          this.events?.onDisconnect(id);
        } catch (error) {
          this.events?.onError(asError(error), id);
        }
      }

      if (!this.isCurrent(generation)) return;

      if (wasActive) {
        this.handleActiveClose(generation, lastError);
      } else {
        this.failDial(generation, lastError);
      }
    });
  }

  private handleActiveClose(generation: number, error?: Error): void {
    if (!this.isCurrent(generation)) return;

    const message = error?.message ?? '上游连接已断开';

    if (this.paused) {
      this.currentStatus = {
        kind: 'tcp-client',
        state: 'disconnected',
      };
      this.emitStatus();
      return;
    }

    this.attempt = 1;
    this.reportOutage(error ?? new Error(message));

    if (!this.config.reconnect.enabled) {
      this.currentStatus = {
        kind: 'tcp-client',
        state: 'error',
        error: message,
        attempt: this.attempt,
      };
      this.emitStatus();
      return;
    }

    this.scheduleReconnect(generation, this.attempt, message);
  }

  private failDial(generation: number, error?: Error): void {
    if (!this.isCurrent(generation)) return;

    this.clearConnectTimer();
    this.connectSocket = undefined;

    const message = error?.message ?? '无法连接上游';
    this.attempt += 1;
    this.reportOutage(error ?? new Error(message));

    if (!this.config.reconnect.enabled) {
      this.currentStatus = {
        kind: 'tcp-client',
        state: 'error',
        error: message,
        attempt: this.attempt,
      };
      this.emitStatus();
      return;
    }

    this.scheduleReconnect(generation, this.attempt, message);
  }

  private scheduleReconnect(
    generation: number,
    attempt: number,
    error: string,
  ): void {
    const delay = nextReconnectDelay(attempt, this.config.reconnect);
    this.currentStatus = {
      kind: 'tcp-client',
      state: 'reconnecting',
      attempt,
      error,
      nextRetryAt: Date.now() + delay,
    };
    this.emitStatus();

    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.isCurrent(generation)) this.dial(generation, 'retry');
    }, delay);
  }

  private reportOutage(error: Error): void {
    if (this.outageReported) return;
    this.outageReported = true;
    this.events?.onError(error);
  }

  private emitStatus(): void {
    this.events?.onStatus(this.status());
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private clearConnectTimer(): void {
    if (!this.connectTimer) return;
    clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }
}
