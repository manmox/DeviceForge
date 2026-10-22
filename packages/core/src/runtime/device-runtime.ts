import { randomUUID } from 'node:crypto';
import { createCodec, tryDecode, type Codec } from '../codec';
import { createFramer, type FrameDecoder } from '../framing';
import { matchesFields } from '../rules/matcher';
import { evaluateFields, type TemplateContext } from '../rules/template';
import type { DeviceConfig, OutgoingMessage, Rule } from '../schema/device';
import { createTransport } from '../transport';
import type { TransportAdapter } from '../transport/types';
import type { ConnectionInfo, Counters, DeviceStatus, TrafficEvent } from '../types';
import { EventBus } from './event-bus';
import { TrafficBuffer } from './traffic-buffer';

export interface DeviceEventMap {
  traffic: TrafficEvent;
  status: DeviceStatus;
  connections: ConnectionInfo[];
  state: { deviceId: string; state: Record<string, unknown> };
  error: { deviceId: string; message: string; connectionId?: string };
}

export interface SendOptions {
  connectionId?: string;
  target?: 'all' | 'last';
  req?: Record<string, unknown>;
  rule?: string;
  silentIfNoConnection?: boolean;
}

export interface DeviceRuntimeOptions {
  trafficCapacity?: number;
}

type RuleTrigger = 'start' | 'connect' | 'frame' | 'interval';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ruleTrigger(rule: Rule): RuleTrigger | undefined {
  if (rule.every !== undefined) return 'interval';
  if (rule.on !== undefined) return rule.on;
  if (rule.match !== undefined) return 'frame';
  return undefined;
}

function ruleLabel(rule: Rule): string {
  return rule.name ?? rule.id ?? '未命名规则';
}

function remoteLabel(connection: ConnectionInfo): string {
  return `${connection.remoteAddress ?? 'unknown'}:${connection.remotePort ?? '?'}`;
}

export class DeviceRuntime {
  private _config: DeviceConfig;
  private readonly bus = new EventBus<DeviceEventMap>();
  private readonly traffic: TrafficBuffer;
  private readonly framers = new Map<string, FrameDecoder>();
  private readonly frameQueues = new Map<string, Promise<void>>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly counters: Counters = {
    rxBytes: 0,
    txBytes: 0,
    rxFrames: 0,
    txFrames: 0,
  };

  private codec: Codec;
  private rules: Rule[];
  private state: Record<string, unknown>;
  private templateCounters: Record<string, number> = { tx: 0, rx: 0 };
  private transport?: TransportAdapter;
  private status: DeviceStatus;
  private stopping = false;
  private statsTimer?: NodeJS.Timeout;

  constructor(
    config: DeviceConfig,
    options: DeviceRuntimeOptions = {},
  ) {
    this._config = config;
    this.codec = createCodec(config.codec);
    this.rules = config.rules;
    this.state = structuredClone(config.state);
    this.traffic = new TrafficBuffer(options.trafficCapacity ?? 5000);
    this.status = {
      deviceId: config.id,
      state: 'stopped',
      endpoints: [],
      connections: [],
      counters: { ...this.counters },
    };
  }

  get config(): DeviceConfig {
    return this._config;
  }

  get id(): string {
    return this._config.id;
  }

  get isActive(): boolean {
    return this.status.state === 'running' || this.status.state === 'starting';
  }

  on<K extends keyof DeviceEventMap>(
    type: K,
    listener: (event: DeviceEventMap[K]) => void,
  ): () => void {
    return this.bus.on(type, listener);
  }

  async start(): Promise<void> {
    if (this.isActive) return;
    if (this.transport) {
      await this.transport.stop().catch(() => undefined);
      this.transport = undefined;
    }

    this.setStatus({ state: 'starting', error: undefined });
    try {
      const transport = createTransport(this._config.transport);
      this.transport = transport;
      await transport.start({
        onData: (connectionId, data) => this.handleData(connectionId, data),
        onConnect: (connection) => this.handleConnect(connection),
        onDisconnect: (connectionId) => this.handleDisconnect(connectionId),
        onError: (error, connectionId) => this.reportError(error.message, connectionId),
      });

      this.setStatus({
        state: 'running',
        endpoints: transport.endpoints(),
        connections: transport.connections(),
        startedAt: Date.now(),
        error: undefined,
      });
      this.startStatsTimer();
      this.startTimers();
      await this.runTrigger('start');
    } catch (error) {
      this.clearTimers();
      this.clearStatsTimer();
      this.framers.clear();
      const transport = this.transport;
      this.transport = undefined;
      if (transport) await transport.stop().catch(() => undefined);
      this.setStatus({
        state: 'error',
        error: errorMessage(error),
        endpoints: [],
        connections: [],
        startedAt: undefined,
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.clearTimers();
    this.clearStatsTimer();
    this.framers.clear();
    this.frameQueues.clear();

    const transport = this.transport;
    this.transport = undefined;

    try {
      if (transport) await transport.stop();
    } finally {
      this.stopping = false;
      this.setStatus({
        state: 'stopped',
        endpoints: [],
        connections: [],
        startedAt: undefined,
        error: undefined,
      });
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  updateConfig(config: DeviceConfig): void {
    if (this.isActive) throw new Error('请先停止设备再修改配置');

    this._config = config;
    this.codec = createCodec(config.codec);
    this.rules = [...config.rules];
    this.state = structuredClone(config.state);
    this.framers.clear();
    this.frameQueues.clear();
    this.clearTimers();
    this.clearStatsTimer();
    this.resetCounters();
    this.setStatus({
      deviceId: config.id,
      state: 'stopped',
      endpoints: [],
      connections: [],
      startedAt: undefined,
      error: undefined,
    });
  }

  async send(message: OutgoingMessage, options: SendOptions = {}): Promise<void> {
    const transport = this.transport;
    if (!transport) throw new Error('设备未启动');

    const connections = transport.connections();
    const byId = new Map(connections.map((connection) => [connection.id, connection]));
    let targetIds: string[];

    if (options.connectionId) {
      if (!byId.has(options.connectionId)) throw new Error('指定的连接已断开');
      targetIds = [options.connectionId];
    } else if ((options.target ?? 'all') === 'last') {
      const last = transport.lastConnectionId();
      targetIds = last ? [last] : [];
    } else {
      targetIds = connections.map((connection) => connection.id);
    }

    if (targetIds.length === 0) {
      if (options.silentIfNoConnection) return;
      throw new Error('当前没有已连接的客户端');
    }

    for (const connectionId of targetIds) {
      const connection = byId.get(connectionId);
      if (!connection) continue;

      const templateContext = this.templateContext(connectionId, options.req);
      const resolvedFields = message.fields
        ? evaluateFields(message.fields, templateContext)
        : undefined;
      const outbound: OutgoingMessage =
        message.hex !== undefined ? { hex: message.hex } : { fields: resolvedFields ?? {} };

      const data = this.codec.encode(outbound, {
        state: this.state,
        counters: this.templateCounters,
        conn: connection,
        req: options.req,
        now: Date.now(),
      });

      await transport.send(connectionId, data);

      this.counters.txBytes += data.length;
      this.counters.txFrames += 1;
      this.templateCounters.tx = (this.templateCounters.tx ?? 0) + 1;

      const decoded = tryDecode(this.codec, data);
      this.pushTraffic({
        id: randomUUID(),
        deviceId: this.id,
        connectionId,
        ts: Date.now(),
        direction: 'out',
        data: data.toString('hex'),
        size: data.length,
        decoded: decoded?.fields,
        rule: options.rule,
        error: decoded && !decoded.valid ? decoded.error : undefined,
      });
    }
  }

  async sendHex(hex: string, options: SendOptions = {}): Promise<void> {
    const normalized = hex.replace(/\s+/g, '');
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(normalized)) {
      throw new Error('hex 必须是非空且偶数位的十六进制字符串');
    }
    await this.send(
      { hex: normalized },
      { target: options.connectionId ? undefined : 'last', ...options },
    );
  }

  async disconnectConnection(connectionId: string): Promise<void> {
    if (!this.transport) throw new Error('设备未启动');
    await this.transport.disconnect(connectionId);
  }

  getTraffic(limit?: number): TrafficEvent[] {
    return this.traffic.list(limit);
  }

  clearTraffic(): void {
    this.traffic.clear();
  }

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  setState(next: Record<string, unknown>): Record<string, unknown> {
    this.state = structuredClone(next);
    const state = this.getState();
    this.bus.emit('state', { deviceId: this.id, state });
    return state;
  }

  getStatus(): DeviceStatus {
    return {
      ...this.status,
      endpoints: this.transport?.endpoints() ?? [],
      connections: this.transport?.connections() ?? [],
      counters: { ...this.counters },
    };
  }

  getConnections(): ConnectionInfo[] {
    return this.transport?.connections() ?? [];
  }

  private handleData(connectionId: string, data: Buffer): void {
    this.counters.rxBytes += data.length;

    let framer = this.framers.get(connectionId);
    if (!framer) {
      framer = createFramer(this._config.framing);
      this.framers.set(connectionId, framer);
    }

    let frames: Buffer[];
    try {
      frames = framer.push(data);
    } catch (error) {
      const message = errorMessage(error);
      this.reportError(message, connectionId);
      return;
    }

    for (const frame of frames) {
      this.counters.rxFrames += 1;
      this.templateCounters.rx = (this.templateCounters.rx ?? 0) + 1;
      this.enqueueFrame(connectionId, frame);
    }
  }

  // 每个连接一条 Promise 链，保证异步规则处理仍按报文到达顺序执行；
  // catch 留在链内，单帧失败不会中断后续帧。
  private enqueueFrame(connectionId: string, frame: Buffer): void {
    const previous = this.frameQueues.get(connectionId) ?? Promise.resolve();
    const next = previous
      .then(() => this.handleFrame(connectionId, frame))
      .catch((error) => {
        this.reportError(`处理报文失败：${errorMessage(error)}`, connectionId);
      });
    this.frameQueues.set(connectionId, next);
    void next.finally(() => {
      if (this.frameQueues.get(connectionId) === next) {
        this.frameQueues.delete(connectionId);
      }
    });
  }

  private async handleFrame(connectionId: string, frame: Buffer): Promise<void> {
    let decoded;
    try {
      decoded = this.codec.decode(frame);
    } catch (error) {
      const message = errorMessage(error);
      this.pushTraffic({
        id: randomUUID(),
        deviceId: this.id,
        connectionId,
        ts: Date.now(),
        direction: 'in',
        data: frame.toString('hex'),
        size: frame.length,
        error: message,
      });
      this.bus.emit('error', { deviceId: this.id, message, connectionId });
      return;
    }

    this.pushTraffic({
      id: randomUUID(),
      deviceId: this.id,
      connectionId,
      ts: Date.now(),
      direction: 'in',
      data: frame.toString('hex'),
      size: frame.length,
      decoded: decoded.fields,
      error: decoded.error,
      note: decoded.warnings?.length ? decoded.warnings.join('; ') : undefined,
    });

    if (!decoded.valid) {
      this.bus.emit('error', {
        deviceId: this.id,
        message: decoded.error ?? '报文校验失败',
        connectionId,
      });
      return;
    }

    await this.runTrigger('frame', connectionId, decoded.fields);
  }

  private handleConnect(connection: ConnectionInfo): void {
    this.framers.set(connection.id, createFramer(this._config.framing));
    this.pushTraffic(this.systemEvent(`客户端已连接 ${remoteLabel(connection)}`, connection.id));
    this.emitConnections();
    void this.runTrigger('connect', connection.id).catch((error) => {
      this.reportError(`连接规则执行失败：${errorMessage(error)}`, connection.id);
    });
  }

  private handleDisconnect(connectionId: string): void {
    this.framers.delete(connectionId);
    if (this.stopping) return;
    this.pushTraffic(this.systemEvent('客户端已断开', connectionId));
    this.emitConnections();
  }

  private async runTrigger(
    trigger: RuleTrigger,
    connectionId?: string,
    req?: Record<string, unknown>,
  ): Promise<void> {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (ruleTrigger(rule) !== trigger) continue;
      if (trigger === 'frame' && !matchesFields(req ?? {}, rule.match)) continue;
      await this.applyRule(rule, connectionId, req);
    }
  }

  private async applyRule(
    rule: Rule,
    connectionId?: string,
    req?: Record<string, unknown>,
  ): Promise<void> {
    const trigger = ruleTrigger(rule);
    const context = this.templateContext(connectionId, req);

    if (rule.set) {
      try {
        Object.assign(this.state, evaluateFields(rule.set, context));
        this.bus.emit('state', { deviceId: this.id, state: this.getState() });
      } catch (error) {
        this.reportError(`规则 ${ruleLabel(rule)} 更新状态失败：${errorMessage(error)}`, connectionId);
      }
    }

    const messages = rule.send
      ? Array.isArray(rule.send)
        ? rule.send
        : [rule.send]
      : [];

    for (const message of messages) {
      try {
        await this.send(message, {
          connectionId,
          target: trigger === 'interval' ? rule.target : undefined,
          req,
          rule: ruleLabel(rule),
          silentIfNoConnection: trigger === 'interval' || trigger === 'start',
        });
      } catch (error) {
        this.reportError(`规则 ${ruleLabel(rule)} 发送失败：${errorMessage(error)}`, connectionId);
      }
    }

    if (rule.disconnect && connectionId) {
      try {
        await this.transport?.disconnect(connectionId);
      } catch (error) {
        this.reportError(`规则 ${ruleLabel(rule)} 断开连接失败：${errorMessage(error)}`, connectionId);
      }
    }
  }

  private startTimers(): void {
    for (const rule of this.rules) {
      if (!rule.enabled || rule.every === undefined) continue;

      let busy = false;
      const schedule = (): void => {
        const jitter =
          rule.jitter > 0 ? Math.floor((Math.random() * 2 - 1) * rule.jitter) : 0;
        const delay = Math.max(10, rule.every! + jitter);

        const timer = setTimeout(() => {
          this.timers.delete(timer);
          if (this.status.state !== 'running') return;
          if (busy) {
            schedule();
            return;
          }

          busy = true;
          void this.applyRule(rule)
            .catch((error) => {
              this.reportError(
                `周期规则 ${ruleLabel(rule)} 执行失败：${errorMessage(error)}`,
              );
            })
            .finally(() => {
              busy = false;
              if (this.status.state === 'running') schedule();
            });
        }, delay);

        this.timers.add(timer);
      };

      schedule();
    }
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private startStatsTimer(): void {
    this.clearStatsTimer();
    this.statsTimer = setInterval(() => {
      if (this.status.state === 'running') this.setStatus({});
    }, 1000);
  }

  private clearStatsTimer(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }

  private templateContext(
    connectionId?: string,
    req?: Record<string, unknown>,
  ): TemplateContext {
    const connection = connectionId
      ? this.transport?.connections().find((item) => item.id === connectionId)
      : undefined;

    return {
      req,
      state: this.state,
      counters: this.templateCounters,
      conn: connection,
      now: Date.now(),
    };
  }

  private pushTraffic(event: TrafficEvent): void {
    this.traffic.push(event);
    this.bus.emit('traffic', event);
  }

  private systemEvent(
    note: string,
    connectionId?: string,
    error?: string,
  ): TrafficEvent {
    return {
      id: randomUUID(),
      deviceId: this.id,
      connectionId,
      ts: Date.now(),
      direction: 'system',
      data: '',
      size: 0,
      note,
      error,
    };
  }

  private reportError(message: string, connectionId?: string): void {
    this.bus.emit('error', { deviceId: this.id, message, connectionId });
    this.pushTraffic(this.systemEvent(message, connectionId, message));
  }

  private emitConnections(): void {
    const connections = this.transport?.connections() ?? [];
    this.bus.emit('connections', connections);
    this.setStatus({ connections });
  }

  private setStatus(patch: Partial<DeviceStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      counters: { ...this.counters },
    };
    this.bus.emit('status', this.getStatus());
  }

  private resetCounters(): void {
    this.counters.rxBytes = 0;
    this.counters.txBytes = 0;
    this.counters.rxFrames = 0;
    this.counters.txFrames = 0;
    this.templateCounters = { tx: 0, rx: 0 };
  }
}
