import { randomUUID, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Aedes, type Client, type AedesPublishPacket } from 'aedes';
import { createServer, type Server } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import type { MqttBrokerTransport, MqttQos } from '../schema/device';
import { isValidMqttTopicName } from '../common/mqtt-topic';
import type { ConnectionInfo, MqttMessageMetadata, TransportStatus } from '../types';
import type { TransportAdapter, TransportEvents, TransportSendOptions } from './types';

interface ActiveClient {
  info: ConnectionInfo;
  client: Client;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function formatEndpoint(host: string, port: number): string {
  const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${formattedHost}:${port}`;
}

function secureEqual(actual: Buffer | undefined, expected: string): boolean {
  if (!actual) return false;
  const expectedBytes = Buffer.from(expected);
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

export class MqttBrokerTransportAdapter implements TransportAdapter {
  readonly kind = 'mqtt-broker';

  private server?: Server;
  private broker?: Aedes;
  private events?: TransportEvents;
  private readonly active = new Map<string, ActiveClient>();
  private readonly clientConnections = new Map<string, string>();
  private endpointList: string[] = [];
  private lastId?: string;
  private currentStatus: TransportStatus = { kind: 'mqtt-broker', state: 'idle' };

  constructor(private readonly config: MqttBrokerTransport) {}

  async start(events: TransportEvents): Promise<void> {
    if (this.server || this.broker) throw new Error('MQTT Broker 已经启动');
    this.events = events;

    const broker = await Aedes.createBroker();
    this.broker = broker;
    if (this.config.username && this.config.password) {
      broker.authenticate = (_client, username, password, callback) => {
        const valid =
          username === this.config.username &&
          secureEqual(password, this.config.password!);
        callback(null, valid);
      };
    }
    broker.authorizePublish = (_client, packet, callback) => {
      if (packet.qos > 1) {
        callback(new Error('MQTT Broker 仅支持 QoS 0 和 QoS 1'));
        return;
      }
      callback();
    };

    broker.on('clientReady', (client) => this.handleClientReady(client));
    broker.on('clientDisconnect', (client) => this.handleClientDisconnect(client));
    broker.on('publish', (packet, client) => this.handlePublish(packet, client));
    broker.on('clientError', (client, error) => {
      this.events?.onError(error, this.clientConnections.get(client.id));
    });
    broker.on('connectionError', (_client, error) => this.events?.onError(error));
    (broker as EventEmitter).on('error', (error: Error) => this.events?.onError(error));

    const tlsOptions = this.config.certFile && this.config.keyFile
      ? {
          cert: readFileSync(this.config.certFile),
          key: readFileSync(this.config.keyFile),
        }
      : undefined;
    const server = tlsOptions
      ? createTlsServer(tlsOptions, broker.handle)
      : createServer(broker.handle);
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host: this.config.host, port: this.config.port });
    }).catch(async (error) => {
      this.server = undefined;
      this.broker = undefined;
      await new Promise<void>((resolve) => broker.close(() => resolve()));
      throw error;
    });

    const address = server.address();
    const host = address && typeof address === 'object' ? address.address : this.config.host;
    const port = address && typeof address === 'object' ? address.port : this.config.port;
    this.endpointList = [`${tlsOptions ? 'mqtts' : 'mqtt'}://${formatEndpoint(host, port)}`];
    this.setStatus({ state: 'listening', error: undefined });
  }

  async stop(): Promise<void> {
    const server = this.server;
    const broker = this.broker;
    const events = this.events;
    this.server = undefined;
    this.broker = undefined;
    this.events = undefined;
    this.active.clear();
    this.clientConnections.clear();
    this.lastId = undefined;
    this.endpointList = [];
    this.currentStatus = { kind: 'mqtt-broker', state: 'idle' };
    events?.onStatus(this.status());

    if (broker) {
      await new Promise<void>((resolve) => broker.close(() => resolve()));
    }
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  async send(
    _connectionId: string,
    data: Buffer,
    options: TransportSendOptions = {},
  ): Promise<void> {
    const broker = this.broker;
    if (!broker || this.currentStatus.state !== 'listening') {
      throw new Error('MQTT Broker 尚未启动');
    }

    const topic = options.topic ?? this.config.publishTopic;
    if (!isValidMqttTopicName(topic)) throw new Error(`MQTT 发布主题无效：${topic}`);
    const qos: MqttQos = options.qos ?? this.config.publishQos;
    await new Promise<void>((resolve, reject) => {
      broker.publish(
        { cmd: 'publish', topic, payload: data, qos, retain: false, dup: false },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  async disconnect(connectionId: string): Promise<void> {
    this.active.get(connectionId)?.client.close();
  }

  connections(): ConnectionInfo[] {
    return [...this.active.values()].map(({ info }) => ({ ...info }));
  }

  endpoints(): string[] {
    return [...this.endpointList];
  }

  lastConnectionId(): string | undefined {
    return this.lastId;
  }

  status(): TransportStatus {
    return { ...this.currentStatus };
  }

  private handleClientReady(client: Client): void {
    const id = randomUUID();
    const connection: ConnectionInfo = {
      id,
      remoteAddress: 'remoteAddress' in client.conn ? client.conn.remoteAddress : undefined,
      remotePort: 'remotePort' in client.conn ? client.conn.remotePort : undefined,
      connectedAt: Date.now(),
      rxBytes: 0,
      txBytes: 0,
      clientId: client.id,
    };
    this.active.set(id, { info: connection, client });
    this.clientConnections.set(client.id, id);
    this.lastId = id;
    this.events?.onConnect({ ...connection });
  }

  private handleClientDisconnect(client: Client): void {
    const id = this.clientConnections.get(client.id);
    if (!id) return;
    this.clientConnections.delete(client.id);
    this.active.delete(id);
    if (this.lastId === id) {
      this.lastId = [...this.active.keys()].at(-1);
    }
    this.events?.onDisconnect(id);
  }

  private handlePublish(packet: AedesPublishPacket, client: Client | null): void {
    if (!client) return;
    const connectionId = this.clientConnections.get(client.id);
    const connection = connectionId ? this.active.get(connectionId)?.info : undefined;
    if (!connectionId || !connection) return;
    const payload = Buffer.isBuffer(packet.payload)
      ? packet.payload
      : Buffer.from(packet.payload);
    connection.rxBytes += payload.length;
    const metadata: MqttMessageMetadata = {
      topic: packet.topic,
      qos: packet.qos === 1 ? 1 : 0,
      retain: packet.retain,
      clientId: client.id,
    };
    this.events?.onData(connectionId, payload, { mqtt: metadata });
  }

  private setStatus(patch: Partial<TransportStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...patch, kind: 'mqtt-broker' };
    this.events?.onStatus(this.status());
  }
}
