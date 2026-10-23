import { randomUUID } from 'node:crypto';
import { createCodec, tryDecode, type Codec } from '../codec';
import type { DictionaryProvider } from '../dictionary/provider';
import { createFramer, type FrameDecoder } from '../framing';
import { matchesFields } from '../rules/matcher';
import { evaluate, evaluateFields, type TemplateContext } from '../rules/template';
import { mqttTopicMatchesFilter } from '../common/mqtt-topic';
import type { DeviceConfig, OutgoingMessage, Rule } from '../schema/device';
import { createTransport } from '../transport';
import type { TransportAdapter } from '../transport/types';
import type {
  ConnectionInfo,
  Counters,
  DeviceStatus,
  MqttMessageMetadata,
  TransportStatus,
  TrafficEvent,
} from '../types';
import { EventBus } from './event-bus';
import {
  ProtocolSession,
  type PendingHandle,
  type ProtocolSendContext,
} from './protocol-session';
import { TrafficBuffer } from './traffic-buffer';
import { FaultInjector, type AppliedFault } from './fault-injector';

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
  publishTopic?: string;
  mqtt?: MqttMessageMetadata;
  silentIfNoConnection?: boolean;
}

export interface DeviceRuntimeOptions {
  trafficCapacity?: number;
  /** 运行时实时读取全局数据字典；字典编辑后无需重启设备。 */
  dictionaries?: DictionaryProvider;
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

function idleTransportStatus(config: DeviceConfig): TransportStatus {
  return { kind: config.transport.type, state: 'idle' };
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
  private readonly dictionaryProvider?: DictionaryProvider;
  private readonly faultInjector: FaultInjector;
  private rules: Rule[];
  private state: Record<string, unknown>;
  private templateCounters: Record<string, number> = { tx: 0, rx: 0 };
  private transport?: TransportAdapter;
  private protocolSession: ProtocolSession;
  private status: DeviceStatus;
  private stopping = false;
  private statsTimer?: NodeJS.Timeout;

  constructor(
    config: DeviceConfig,
    options: DeviceRuntimeOptions = {},
  ) {
    this._config = config;
    this.dictionaryProvider = options.dictionaries;
    this.codec = createCodec(config.codec, {
      deviceInfo: config.deviceInfo,
      dictionaries: this.dictionaryProvider,
    });
    this.rules = config.rules;
    this.state = structuredClone(config.state);
    this.traffic = new TrafficBuffer(options.trafficCapacity ?? 5000);
    this.faultInjector = new FaultInjector(config.faultInjection, {
      onFault: (event) => this.recordAppliedFault(event),
      disconnect: async (connectionId) => {
        await this.transport?.disconnect(connectionId);
      },
    });
    this.status = {
      deviceId: config.id,
      state: 'stopped',
      faultInjectionEnabled: false,
      transport: idleTransportStatus(config),
      endpoints: [],
      connections: [],
      counters: { ...this.counters },
    };
    this.protocolSession = this.createProtocolSession();
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

  get faultInjectionEnabled(): boolean {
    return this.faultInjector.isEnabled;
  }

  async setFaultInjectionEnabled(enabled: boolean): Promise<void> {
    await this.faultInjector.setEnabled(enabled);
    this.setStatus({ faultInjectionEnabled: enabled });
  }

  updateFaultInjection(config: DeviceConfig['faultInjection']): void {
    this._config = { ...this._config, faultInjection: config };
    this.faultInjector.setConfig(config);
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

    // stop() 会终止旧 session；每次 start/restart 都从空的待确认队列开始。
    this.protocolSession.stop();
    this.protocolSession = this.createProtocolSession();

    this.setStatus({
      state: 'starting',
      error: undefined,
      transport: idleTransportStatus(this._config),
    });
    try {
      const transport = createTransport(this._config.transport, this._config.id);
      this.transport = transport;
      const isCurrent = () => this.transport === transport;
      await transport.start({
        onData: (connectionId, data, metadata) => {
          if (isCurrent()) this.handleData(connectionId, data, metadata);
        },
        onConnect: (connection) => {
          if (isCurrent()) this.handleConnect(connection);
        },
        onDisconnect: (connectionId) => {
          if (isCurrent()) this.handleDisconnect(connectionId);
        },
        onError: (error, connectionId) => {
          if (isCurrent()) this.reportError(error.message, connectionId);
        },
        onStatus: (status) => {
          if (!isCurrent()) return;
          this.protocolSession.onTransportStatus(status);
          this.setStatus({ transport: status });
        },
      });

      this.setStatus({
        state: 'running',
        transport: transport.status(),
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
      this.protocolSession.stop();
      const transport = this.transport;
      this.transport = undefined;
      if (transport) await transport.stop().catch(() => undefined);
      const message = errorMessage(error);
      this.setStatus({
        state: 'error',
        error: message,
        transport: {
          kind: this._config.transport.type,
          state: 'error',
          error: message,
        },
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
    this.protocolSession.stop();
    this.faultInjector.closeAll();
    await this.setFaultInjectionEnabled(false);
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
        faultInjectionEnabled: false,
        transport: idleTransportStatus(this._config),
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
    this.faultInjector.closeAll();
    this.faultInjector.setConfig(config.faultInjection);
    void this.faultInjector.setEnabled(false);
    this.codec = createCodec(config.codec, {
      deviceInfo: config.deviceInfo,
      dictionaries: this.dictionaryProvider,
    });
    this.protocolSession.stop();
    this.protocolSession = this.createProtocolSession();
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
      faultInjectionEnabled: false,
      transport: idleTransportStatus(config),
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
    const isMqttBroker = transport.kind === 'mqtt-broker';
    let targetIds: string[];

    if (isMqttBroker) {
      targetIds = [options.connectionId ?? ''];
    } else if (options.connectionId) {
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
      throw new Error('当前没有可用连接');
    }

    // 协议流水号和设备时间必须在进入目标连接循环前固定一次，否则多连接
    // 会各自生成不同的 sequence/timestamp。
    const prepared =
      this.codec.prepareOutbound?.(
        message,
        this.templateContext(undefined, options.req, options.mqtt),
      ) ?? { message };

    for (const connectionId of targetIds) {
      const connection = byId.get(connectionId);
      if (!connection && !isMqttBroker) continue;

      const templateContext = this.templateContext(connectionId, options.req, options.mqtt);
      const resolvedFields = prepared.message.fields
        ? evaluateFields(prepared.message.fields, templateContext)
        : undefined;
      const outbound: OutgoingMessage =
        prepared.message.hex !== undefined
          ? { hex: prepared.message.hex }
          : { fields: resolvedFields ?? {} };

      const data = this.codec.encode(outbound, {
        state: this.state,
        counters: this.templateCounters,
        conn: connection,
        req: options.req,
        device: this._config.deviceInfo,
        now: Date.now(),
      });

      // 先用最终字节确认报文确实带有预期流水号，再登记 pending；模板把
      // 可选流水号求值为空时不会产生永远等不到 ACK 的条目。
      const decoded = tryDecode(this.codec, data);
      const trackable =
        prepared.track !== undefined &&
        decoded?.valid === true &&
        String(decoded.fields[prepared.track.field] ?? '') ===
          prepared.track.key;
      const pending: PendingHandle | undefined = trackable
        ? connectionId
          ? this.protocolSession.register(connectionId, prepared.track!, data, options.publishTopic)
          : undefined
        : undefined;

      try {
        await this.sendThroughFaultInjector(
          transport,
          connectionId,
          data,
          options.publishTopic,
        );
        if (pending) this.protocolSession.arm(pending);
      } catch (error) {
        if (pending) this.protocolSession.cancel(pending);
        throw error;
      }

      this.counters.txFrames += 1;
      this.templateCounters.tx = (this.templateCounters.tx ?? 0) + 1;

      this.pushTraffic({
        id: randomUUID(),
        deviceId: this.id,
        connectionId: connectionId || undefined,
        ts: Date.now(),
        direction: 'out',
        data: data.toString('hex'),
        size: data.length,
        decoded: decoded?.fields,
        rule: options.rule,
        error: decoded && !decoded.valid ? decoded.error : undefined,
        note:
          this.faultInjector.isEnabled && this._config.faultInjection.rules.length > 0
            ? '故障注入结果详见系统事件'
            : undefined,
        mqtt: this.outgoingMqttMetadata(options.publishTopic),
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
      faultInjectionEnabled: this.faultInjector.isEnabled,
      transport: this.transport?.status() ?? this.status.transport,
      endpoints: this.transport?.endpoints() ?? [],
      connections: this.transport?.connections() ?? [],
      counters: { ...this.counters },
    };
  }

  getConnections(): ConnectionInfo[] {
    return this.transport?.connections() ?? [];
  }

  private handleData(
    connectionId: string,
    data: Buffer,
    metadata?: MqttMessageMetadata,
  ): void {
    this.counters.rxBytes += data.length;

    if (
      this._config.transport.type === 'mqtt-client' ||
      this._config.transport.type === 'mqtt-broker'
    ) {
      void this.faultInjector
        .processMqtt(connectionId, 'in', data)
        .then(async (result) => {
          if (result.applied) this.recordAppliedFault(result.applied, metadata);
          if (result.applied?.action === 'disconnect') {
            await this.transport?.disconnect(connectionId);
            return;
          }
          if (!result.data) return;
          this.counters.rxFrames += 1;
          this.templateCounters.rx = (this.templateCounters.rx ?? 0) + 1;
          this.enqueueFrame(connectionId, result.data, metadata);
        })
        .catch((error) => this.reportError(errorMessage(error), connectionId));
      return;
    }

    if (
      this.faultInjector.isEnabled &&
      this._config.faultInjection.rules.length > 0
    ) {
      void this.faultInjector
        .pushTcp(connectionId, 'in', data, async (segment) => {
          this.handleTcpData(connectionId, segment);
        })
        .catch((error) => this.reportError(errorMessage(error), connectionId));
      return;
    }

    this.handleTcpData(connectionId, data);
  }

  private handleTcpData(connectionId: string, data: Buffer): void {
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
  private enqueueFrame(
    connectionId: string,
    frame: Buffer,
    metadata?: MqttMessageMetadata,
  ): void {
    const previous = this.frameQueues.get(connectionId) ?? Promise.resolve();
    const next = previous
      .then(() => this.handleFrame(connectionId, frame, metadata))
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

  private async handleFrame(
    connectionId: string,
    frame: Buffer,
    metadata?: MqttMessageMetadata,
  ): Promise<void> {
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
        mqtt: metadata,
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
      mqtt: metadata,
    });

    if (!decoded.valid) {
      this.bus.emit('error', {
        deviceId: this.id,
        message: decoded.error ?? '报文校验失败',
        connectionId,
      });
      return;
    }

    // 先处理 ACK，再执行规则，避免同一帧触发规则时 pending 尚未清除。
    const observation = this.codec.observeInbound?.(decoded.fields);
    if (observation?.ackKey !== undefined) {
      this.protocolSession.acknowledge(
        connectionId,
        observation.ackKey,
        observation.ackOk !== false,
      );
    }

    await this.runTrigger('frame', connectionId, decoded.fields, metadata);
  }

  private handleConnect(connection: ConnectionInfo): void {
    this.faultInjector.openConnection(connection.id);
    if (
      this._config.transport.type !== 'mqtt-client' &&
      this._config.transport.type !== 'mqtt-broker'
    ) {
      this.framers.set(connection.id, createFramer(this._config.framing));
    }
    this.pushTraffic(this.systemEvent(`连接已建立 ${remoteLabel(connection)}`, connection.id));
    this.emitConnections();
    void this.runTrigger('connect', connection.id)
      .catch((error) => {
        this.reportError(
          `连接规则执行失败：${errorMessage(error)}`,
          connection.id,
        );
      })
      .finally(() => {
        // 断线恢复必须等注册/握手规则执行完，否则可能先重发上报、后发注册。
        if (this.stopping) return;
        const stillConnected = this.transport
          ?.connections()
          .some((item) => item.id === connection.id);
        if (
          stillConnected &&
          (this._config.transport.type === 'tcp-client' ||
            this._config.transport.type === 'mqtt-client')
        ) {
          this.protocolSession.onConnectionReady(connection.id);
        }
      });
  }

  private handleDisconnect(connectionId: string): void {
    this.framers.delete(connectionId);
    this.faultInjector.closeConnection(connectionId);
    if (this.stopping) return;
    this.protocolSession.onConnectionClosed(connectionId);
    this.pushTraffic(this.systemEvent('连接已断开', connectionId));
    this.emitConnections();
  }

  private createProtocolSession(): ProtocolSession {
    return new ProtocolSession({
      mode: this._config.transport.type,
      send: (connectionId, data, ctx) =>
        this.resendProtocolFrame(connectionId, data, ctx),
      notify: (level, message, connectionId) => {
        if (level === 'error') {
          this.reportError(message, connectionId);
        } else {
          this.pushTraffic(this.systemEvent(message, connectionId));
        }
      },
    });
  }

  /** ACK 会话的重发路径：只重写原始字节，不重新执行模板和编码。 */
  private async resendProtocolFrame(
    connectionId: string,
    data: Buffer,
    ctx: ProtocolSendContext,
  ): Promise<void> {
    const transport = this.transport;
    if (!transport) throw new Error('设备未启动');
    if (!transport.connections().some((item) => item.id === connectionId)) {
      throw new Error('连接已断开');
    }

    await this.sendThroughFaultInjector(transport, connectionId, data, ctx.topic);
    this.counters.txFrames += 1;
    this.templateCounters.tx = (this.templateCounters.tx ?? 0) + 1;

    const decoded = tryDecode(this.codec, data);
    const label = ctx.reason === 'reconnect' ? '重连恢复' : '重发';
    this.pushTraffic({
      id: randomUUID(),
      deviceId: this.id,
      connectionId,
      ts: Date.now(),
      direction: 'out',
      data: data.toString('hex'),
      size: data.length,
      decoded: decoded?.fields,
      note: `${label} seq=${ctx.sequence}（${ctx.attempt}/${ctx.maxRetries}）`,
      error: decoded && !decoded.valid ? decoded.error : undefined,
      mqtt: this.outgoingMqttMetadata(ctx.topic),
    });
  }

  private async runTrigger(
    trigger: RuleTrigger,
    connectionId?: string,
    req?: Record<string, unknown>,
    mqtt?: MqttMessageMetadata,
  ): Promise<void> {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (ruleTrigger(rule) !== trigger) continue;
      if (trigger === 'frame' && !matchesFields(req ?? {}, rule.match)) continue;
      if (
        rule.topicFilter !== undefined &&
        (!mqtt || !mqttTopicMatchesFilter(mqtt.topic, rule.topicFilter))
      ) continue;
      await this.applyRule(rule, connectionId, req, mqtt);
    }
  }

  private async applyRule(
    rule: Rule,
    connectionId?: string,
    req?: Record<string, unknown>,
    mqtt?: MqttMessageMetadata,
  ): Promise<void> {
    const trigger = ruleTrigger(rule);
    const context = this.templateContext(connectionId, req, mqtt);

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

    let publishTopic: string | undefined;
    if (rule.publishTopic !== undefined) {
      try {
        const resolved = evaluate(rule.publishTopic, context);
        if (typeof resolved !== 'string' || resolved.trim() === '') {
          throw new Error('规则发布主题求值后不能为空');
        }
        publishTopic = resolved;
      } catch (error) {
        this.reportError(
          `规则 ${ruleLabel(rule)} 发布主题无效：${errorMessage(error)}`,
          connectionId,
        );
        return;
      }
    }

    for (const message of messages) {
      try {
        await this.send(message, {
          connectionId,
          target: trigger === 'interval' ? rule.target : undefined,
          req,
          rule: ruleLabel(rule),
          publishTopic,
          mqtt,
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
    mqtt?: MqttMessageMetadata,
  ): TemplateContext {
    const connection = connectionId
      ? this.transport?.connections().find((item) => item.id === connectionId)
      : undefined;

    return {
      req,
      state: this.state,
      counters: this.templateCounters,
      conn: connection,
      mqtt,
      device: this._config.deviceInfo,
      now: Date.now(),
    };
  }

  private outgoingMqttMetadata(topic?: string): MqttMessageMetadata | undefined {
    const transport = this._config.transport;
    if (transport.type !== 'mqtt-client' && transport.type !== 'mqtt-broker') {
      return undefined;
    }
    return {
      topic: topic ?? transport.publishTopic,
      qos: transport.publishQos,
      retain: false,
    };
  }

  private async sendThroughFaultInjector(
    transport: TransportAdapter,
    connectionId: string,
    data: Buffer,
    topic?: string,
  ): Promise<void> {
    if (transport.kind === 'mqtt-client' || transport.kind === 'mqtt-broker') {
      const result = await this.faultInjector.processMqtt(connectionId, 'out', data);
      if (result.applied) {
        this.recordAppliedFault(result.applied, this.outgoingMqttMetadata(topic));
      }
      if (result.applied?.action === 'disconnect') {
        await transport.disconnect(connectionId);
        return;
      }
      if (!result.data) return;
      await transport.send(connectionId, result.data, { topic });
      this.counters.txBytes += result.data.length;
      return;
    }

    await this.faultInjector.pushTcp(connectionId, 'out', data, async (segment) => {
      await transport.send(connectionId, segment, { topic });
      this.counters.txBytes += segment.length;
    });
  }

  private recordAppliedFault(
    event: AppliedFault,
    mqtt?: MqttMessageMetadata,
  ): void {
    const direction = event.direction === 'in' ? '入站' : '出站';
    const item = mqtt ? `第 ${event.index} 条 MQTT 消息` : `第 ${event.index} 段`;
    const labels: Record<AppliedFault['action'], string> = {
      delay: '延迟',
      drop: '丢弃',
      disconnect: '断开连接',
      corrupt: '翻转 1 bit',
    };
    const traffic = this.systemEvent(
      `故障注入 ${event.rule.name}：${direction}${item}，${labels[event.action]}，${event.inputBytes} B → ${event.outputBytes} B`,
      event.connectionId,
    );
    if (mqtt) traffic.mqtt = mqtt;
    this.pushTraffic(traffic);
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
