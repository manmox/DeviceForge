import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, type MqttClient } from 'mqtt';
import { isValidMqttTopicName } from '../common/mqtt-topic';
import type { MqttClientTransport } from '../schema/device';
import type { ConnectionInfo, MqttMessageMetadata, TransportStatus } from '../types';
import type { TransportAdapter, TransportEvents, TransportSendOptions } from './types';

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function endpoint(url: string): string {
  const parsed = new URL(url);
  const protocol = parsed.protocol === 'mqtts:' ? 'mqtts' : 'mqtt';
  return `${protocol}://${parsed.host}`;
}

export class MqttClientTransportAdapter implements TransportAdapter {
  readonly kind = 'mqtt-client';

  private events?: TransportEvents;
  private client?: MqttClient;
  private active?: ConnectionInfo;
  private endpointList: string[] = [];
  private currentStatus: TransportStatus = { kind: 'mqtt-client', state: 'idle' };
  private running = false;
  private paused = false;
  private attempt = 0;
  private errorReported = false;

  constructor(
    private readonly config: MqttClientTransport,
    private readonly deviceId: string,
  ) {}

  async start(events: TransportEvents): Promise<void> {
    if (this.running) throw new Error('MQTT Client 已经启动');

    this.events = events;
    this.running = true;
    this.paused = false;
    this.attempt = 0;
    this.errorReported = false;
    this.endpointList = [endpoint(this.config.url)];
    this.setStatus({ state: 'connecting', error: undefined });

    let ca: Buffer | undefined;
    if (this.config.caFile) ca = readFileSync(this.config.caFile);

    const client = connect(this.config.url, {
      clientId: this.config.clientId?.trim() || this.deviceId,
      protocolVersion: 4,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 1_000,
      reconnectOnConnackError: true,
      resubscribe: false,
      username: this.config.username,
      password: this.config.password,
      ca,
    });
    this.client = client;

    client.on('connect', () => {
      if (!this.isCurrent(client)) return;
      const wasDisconnected = this.active === undefined;
      this.attempt = 0;
      this.errorReported = false;
      const connection = this.ensureConnection();
      this.setStatus({ state: 'connected', error: undefined, attempt: undefined });
      void this.subscribe(client, connection.id).finally(() => {
        if (
          wasDisconnected &&
          this.isCurrent(client) &&
          this.active?.id === connection.id
        ) {
          this.events?.onConnect({ ...connection });
        }
      });
    });

    client.on('reconnect', () => {
      if (!this.isCurrent(client)) return;
      this.attempt += 1;
      this.setStatus({ state: 'reconnecting', attempt: this.attempt });
    });

    client.on('message', (topic, payload, packet) => {
      if (!this.isCurrent(client)) return;
      const connection = this.ensureConnection();
      const metadata: MqttMessageMetadata = {
        topic,
        qos: packet.qos === 1 ? 1 : 0,
        retain: packet.retain,
      };
      connection.rxBytes += payload.length;
      this.events?.onData(connection.id, payload, { mqtt: metadata });
    });

    client.on('close', () => {
      if (!this.isCurrent(client)) return;
      this.closeActiveConnection();
      if (this.running && !this.paused) {
        this.setStatus({ state: 'reconnecting', attempt: this.attempt });
      }
    });

    client.on('error', (value) => {
      if (!this.isCurrent(client)) return;
      const error = asError(value);
      if (!this.errorReported) {
        this.errorReported = true;
        this.events?.onError(error, this.active?.id);
      }
      this.setStatus({ state: 'reconnecting', error: error.message, attempt: this.attempt });
    });
  }

  async stop(): Promise<void> {
    const events = this.events;
    const client = this.client;
    this.running = false;
    this.paused = false;
    this.client = undefined;
    this.events = undefined;
    this.closeActiveConnection(false);
    this.endpointList = [];
    this.attempt = 0;
    this.currentStatus = { kind: 'mqtt-client', state: 'idle' };
    events?.onStatus(this.status());

    if (client) {
      await new Promise<void>((resolve) => client.end(true, () => resolve()));
    }
  }

  async send(
    connectionId: string,
    data: Buffer,
    options: TransportSendOptions = {},
  ): Promise<void> {
    const client = this.client;
    const connection = this.active;
    if (!client?.connected || !connection || connection.id !== connectionId) {
      throw new Error('MQTT Broker 尚未连接');
    }

    const topic = options.topic ?? this.config.publishTopic;
    if (!isValidMqttTopicName(topic)) throw new Error(`MQTT 发布主题无效：${topic}`);
    const qos = options.qos ?? this.config.publishQos;
    await new Promise<void>((resolve, reject) => {
      client.publish(topic, data, { qos, retain: false }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    connection.txBytes += data.length;
  }

  async disconnect(connectionId: string): Promise<void> {
    if (!this.active || this.active.id !== connectionId || !this.client) return;
    this.paused = true;
    await new Promise<void>((resolve) => this.client!.end(true, () => resolve()));
    this.closeActiveConnection();
    this.setStatus({ state: 'disconnected', attempt: undefined });
  }

  connections(): ConnectionInfo[] {
    return this.active ? [{ ...this.active }] : [];
  }

  endpoints(): string[] {
    return [...this.endpointList];
  }

  lastConnectionId(): string | undefined {
    return this.active?.id;
  }

  status(): TransportStatus {
    return { ...this.currentStatus };
  }

  private async subscribe(client: MqttClient, connectionId: string): Promise<void> {
    if (this.config.subscriptions.length === 0) return;
    const subscriptions = Object.fromEntries(
      this.config.subscriptions.map(({ topic, qos }) => [topic, { qos }]),
    );
    await new Promise<void>((resolve, reject) => {
      client.subscribe(subscriptions, (error, granted) => {
        if (error) {
          reject(error);
          return;
        }
        const denied = granted?.find((item) => item.qos === 128);
        if (denied) {
          reject(new Error(`订阅被 Broker 拒绝：${denied.topic}`));
          return;
        }
        resolve();
      });
    }).catch((error) => {
      if (!this.isCurrent(client)) return;
      this.events?.onError(asError(error), connectionId);
    });
  }

  private ensureConnection(): ConnectionInfo {
    if (this.active) return this.active;
    const parsed = new URL(this.config.url);
    this.active = {
      id: randomUUID(),
      remoteAddress: parsed.hostname,
      remotePort: Number(parsed.port || (parsed.protocol === 'mqtts:' ? 8883 : 1883)),
      connectedAt: Date.now(),
      rxBytes: 0,
      txBytes: 0,
      clientId: this.config.clientId?.trim() || this.deviceId,
    };
    return this.active;
  }

  private closeActiveConnection(emit = true): void {
    const connection = this.active;
    this.active = undefined;
    if (connection && emit) this.events?.onDisconnect(connection.id);
  }

  private isCurrent(client: MqttClient): boolean {
    return this.running && this.client === client;
  }

  private setStatus(patch: Partial<TransportStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...patch, kind: 'mqtt-client' };
    this.events?.onStatus(this.status());
  }
}
