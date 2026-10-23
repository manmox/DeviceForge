import type { TransportConfig } from '../schema/device';
import type { TransportStatus } from '../types';

export interface ProtocolTrack {
  /** 协议流水号。 */
  key: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface ProtocolSendContext {
  sequence: string;
  /** 第几次重发，从 1 开始；初始发送不经过 session.send。 */
  attempt: number;
  maxRetries: number;
  reason: 'retry' | 'reconnect';
  topic?: string;
}

export type ProtocolNoticeLevel = 'info' | 'warning' | 'error';

export interface ProtocolSessionOptions {
  mode: TransportConfig['type'];
  send(
    connectionId: string,
    data: Buffer,
    ctx: ProtocolSendContext,
  ): Promise<void>;
  notify(
    level: ProtocolNoticeLevel,
    message: string,
    connectionId?: string,
  ): void;
}

export interface PendingHandle {
  connectionId: string;
  sequence: string;
}

interface PendingDelivery {
  connectionId: string;
  sequence: string;
  data: Buffer;
  timeoutMs: number;
  maxRetries: number;
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
  paused: boolean;
  busy: boolean;
  topic?: string;
  /** 断线恢复期间若发送仍在进行，等它结束后再迁移。 */
  resumeConnectionId?: string;
}

function keyOf(connectionId: string, sequence: string): string {
  return `${connectionId}\u0000${sequence}`;
}

function entryKey(entry: PendingDelivery): string {
  return keyOf(entry.connectionId, entry.sequence);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 通用 ACK 会话 / 重传队列。
 *
 * - 每个连接、每个流水号独立跟踪，TCP Server 多客户端也适用；
 * - 初始发送由 DeviceRuntime 完成，超时重发由本类通过 send 回调完成；
 * - TCP Client 断线时暂停而不是丢弃，重连并执行完 connect 规则后恢复；
 * - 所有定时器在 stop 时清理，异步 send 完成后会再次检查 pending 身份。
 */
export class ProtocolSession {
  private readonly pending = new Map<string, PendingDelivery>();
  private stopped = false;
  private resuming = false;
  private queuedReadyConnectionId?: string;

  constructor(private readonly options: ProtocolSessionOptions) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  /** 只登记，不启动定时器；应在 transport.send 之前调用。 */
  register(
    connectionId: string,
    track: ProtocolTrack,
    data: Buffer,
    topic?: string,
  ): PendingHandle {
    const handle: PendingHandle = {
      connectionId,
      sequence: track.key,
    };
    if (this.stopped) return handle;

    const key = keyOf(connectionId, track.key);
    const existing = this.pending.get(key);
    if (existing) {
      this.remove(existing);
      this.options.notify(
        'warning',
        `流水号 ${track.key} 重复登记，旧待确认报文已被替换`,
        connectionId,
      );
    }

    this.pending.set(key, {
      connectionId,
      sequence: track.key,
      data,
      timeoutMs: track.timeoutMs,
      maxRetries: track.maxRetries,
      attempts: 0,
      paused: false,
      busy: false,
      topic,
    });
    return handle;
  }

  /** 发送成功后启动 ACK 超时。ACK 可能已经先到并移除了条目。 */
  arm(handle: PendingHandle): void {
    const entry = this.lookup(handle);
    if (!entry || entry.paused || this.stopped) return;
    this.startTimer(entry);
  }

  /** 发送失败时撤销登记。 */
  cancel(handle: PendingHandle): void {
    const entry = this.lookup(handle);
    if (!entry) return;
    this.remove(entry);
  }

  acknowledge(connectionId: string, key: string, ok: boolean): void {
    if (this.stopped) return;
    const entry = this.pending.get(keyOf(connectionId, key));
    if (!entry) {
      this.options.notify(
        'info',
        `收到未跟踪的 ACK 流水号 ${key}`,
        connectionId,
      );
      return;
    }

    if (!ok) {
      this.options.notify(
        'warning',
        `ACK 流水号 ${key} 状态非 OK，继续等待重试`,
        connectionId,
      );
      return;
    }

    this.remove(entry);
  }

  onConnectionClosed(connectionId: string): void {
    if (this.stopped) return;

    if (this.options.mode === 'tcp-server' || this.options.mode === 'mqtt-broker') {
      const entries = [...this.pending.values()].filter(
        (entry) => entry.connectionId === connectionId,
      );
      for (const entry of entries) this.remove(entry);
      if (entries.length > 0) {
        this.options.notify(
          'warning',
          `连接断开，丢弃 ${entries.length} 条未确认报文`,
          connectionId,
        );
      }
      return;
    }

    this.pauseConnection(connectionId);
  }

  onTransportStatus(status: TransportStatus): void {
    if (this.stopped) return;

    if (this.options.mode === 'tcp-client' || this.options.mode === 'mqtt-client') {
      if (status.state === 'reconnecting') {
        this.pauseAll();
        return;
      }
      if (status.state === 'disconnected') {
        this.clearAll('设备已主动断开，丢弃未确认报文');
        return;
      }
      if (status.state === 'error') {
        this.clearAll('传输错误且不再重连，丢弃未确认报文');
      }
      return;
    }

    if (status.state === 'error' || status.state === 'idle') {
      this.clearAll('传输已停止，丢弃未确认报文');
    }
  }

  /**
   * connect 规则执行完后调用；只恢复断线前暂停的条目。
   * 在 connect 规则中新发送的报文有自己的定时器，不会在这里重复发送。
   */
  onConnectionReady(connectionId: string): void {
    if (this.stopped || (this.options.mode !== 'tcp-client' && this.options.mode !== 'mqtt-client')) return;
    void this.resumePaused(connectionId);
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.pending.values()) this.clearTimer(entry);
    this.pending.clear();
  }

  private lookup(handle: PendingHandle): PendingDelivery | undefined {
    return this.pending.get(keyOf(handle.connectionId, handle.sequence));
  }

  private startTimer(entry: PendingDelivery): void {
    this.clearTimer(entry);
    if (this.stopped || entry.paused) return;

    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.retry(entry, 'retry');
    }, entry.timeoutMs);
  }

  private clearTimer(entry: PendingDelivery): void {
    if (!entry.timer) return;
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private remove(entry: PendingDelivery): void {
    this.clearTimer(entry);
    const key = entryKey(entry);
    if (this.pending.get(key) === entry) this.pending.delete(key);
  }

  private async retry(
    entry: PendingDelivery,
    reason: 'retry' | 'reconnect',
  ): Promise<void> {
    if (
      this.stopped ||
      entry.busy ||
      entry.paused ||
      this.pending.get(entryKey(entry)) !== entry
    ) {
      return;
    }

    if (entry.attempts >= entry.maxRetries) {
      this.remove(entry);
      this.options.notify(
        'error',
        `流水号 ${entry.sequence} 重试 ${entry.maxRetries} 次后仍未收到 ACK`,
        entry.connectionId,
      );
      return;
    }

    entry.attempts += 1;
    entry.busy = true;
    try {
      await this.options.send(entry.connectionId, entry.data, {
        sequence: entry.sequence,
        attempt: entry.attempts,
        maxRetries: entry.maxRetries,
        reason,
        topic: entry.topic,
      });
    } catch (error) {
      entry.busy = false;
      if (this.pending.get(entryKey(entry)) !== entry) return;

      if (this.options.mode === 'tcp-client' || this.options.mode === 'mqtt-client') {
        entry.paused = true;
        this.options.notify(
          'warning',
          `重发流水号 ${entry.sequence} 失败，等待重连：${errorMessage(error)}`,
          entry.connectionId,
        );
      } else {
        this.remove(entry);
        this.options.notify(
          'error',
          `重发流水号 ${entry.sequence} 失败：${errorMessage(error)}`,
          entry.connectionId,
        );
      }
      return;
    }
    entry.busy = false;

    if (this.stopped || this.pending.get(entryKey(entry)) !== entry) return;

    if (entry.paused) {
      // 发送期间连接断开并已完成重连准备时，在这里补做迁移。
      const resumeConnectionId = entry.resumeConnectionId;
      entry.resumeConnectionId = undefined;
      if (resumeConnectionId) {
        await this.resumeEntry(entry, resumeConnectionId);
      }
      return;
    }

    this.startTimer(entry);
  }

  private pauseEntry(entry: PendingDelivery): void {
    entry.paused = true;
    this.clearTimer(entry);
  }

  private pauseConnection(connectionId: string): void {
    for (const entry of this.pending.values()) {
      if (entry.connectionId === connectionId) this.pauseEntry(entry);
    }
  }

  private pauseAll(): void {
    for (const entry of this.pending.values()) {
      if (!entry.paused) this.pauseEntry(entry);
    }
  }

  private clearAll(message: string): void {
    const count = this.pending.size;
    for (const entry of this.pending.values()) this.clearTimer(entry);
    this.pending.clear();
    if (count > 0) this.options.notify('warning', `${message}（${count} 条）`);
  }

  private async resumePaused(connectionId: string): Promise<void> {
    if (this.resuming) {
      // 恢复过程中如果再次重连，保留最后一次连接，当前循环结束后重试。
      this.queuedReadyConnectionId = connectionId;
      return;
    }
    this.resuming = true;
    try {
      const entries = [...this.pending.values()].filter((entry) => entry.paused);
      for (const entry of entries) {
        if (this.stopped) return;
        if (this.pending.get(entryKey(entry)) !== entry) continue;
        if (entry.busy) {
          entry.resumeConnectionId = connectionId;
          continue;
        }
        await this.resumeEntry(entry, connectionId);
      }
    } finally {
      this.resuming = false;
      const queued = this.queuedReadyConnectionId;
      this.queuedReadyConnectionId = undefined;
      if (queued && !this.stopped) this.onConnectionReady(queued);
    }
  }

  private async resumeEntry(
    entry: PendingDelivery,
    connectionId: string,
  ): Promise<void> {
    if (this.stopped) return;
    if (this.pending.get(entryKey(entry)) !== entry) return;

    if (entry.attempts >= entry.maxRetries) {
      this.remove(entry);
      this.options.notify(
        'error',
        `流水号 ${entry.sequence} 重连后重试次数已耗尽`,
        connectionId,
      );
      return;
    }

    const oldKey = entryKey(entry);
    const newKey = keyOf(connectionId, entry.sequence);
    const collision = this.pending.get(newKey);
    if (collision && collision !== entry) {
      this.remove(entry);
      this.options.notify(
        'warning',
        `新连接已存在流水号 ${entry.sequence}，丢弃旧待确认报文`,
        connectionId,
      );
      return;
    }

    this.pending.delete(oldKey);
    entry.connectionId = connectionId;
    entry.paused = false;
    entry.resumeConnectionId = undefined;
    this.pending.set(newKey, entry);

    entry.attempts += 1;
    entry.busy = true;
    try {
      await this.options.send(connectionId, entry.data, {
        sequence: entry.sequence,
        attempt: entry.attempts,
        maxRetries: entry.maxRetries,
        reason: 'reconnect',
        topic: entry.topic,
      });
    } catch (error) {
      entry.busy = false;
      if (this.pending.get(entryKey(entry)) !== entry) return;
      entry.paused = true;
      this.options.notify(
        'warning',
        `重连恢复流水号 ${entry.sequence} 失败，等待下次重连：${errorMessage(error)}`,
        connectionId,
      );
      return;
    }
    entry.busy = false;

    if (this.stopped || entry.paused)
      return;
    if (this.pending.get(entryKey(entry)) !== entry) return;
    this.startTimer(entry);
  }
}
