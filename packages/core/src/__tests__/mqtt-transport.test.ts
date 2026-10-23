import { setTimeout as delay } from 'node:timers/promises';
import { connect, type IClientOptions, type IPublishPacket, type MqttClient } from 'mqtt';
import { describe, expect, it } from 'vitest';
import { DeviceRuntime } from '../runtime/device-runtime';
import {
  MqttBrokerTransportSchema,
  MqttClientTransportSchema,
  DeviceConfigSchema,
} from '../schema/device';
import { MqttBrokerTransportAdapter } from '../transport/mqtt-broker';
import { MqttClientTransportAdapter } from '../transport/mqtt-client';
import type { TransportEvents } from '../transport/types';
import type { ConnectionInfo, MqttMessageMetadata, TransportStatus } from '../types';

interface ReceivedMessage {
  topic: string;
  payload: Buffer;
  qos: 0 | 1;
  retain: boolean;
}

interface TestEvents {
  events: TransportEvents;
  statuses: TransportStatus[];
  connects: ConnectionInfo[];
  disconnects: string[];
  data: { connectionId: string; payload: Buffer; mqtt?: MqttMessageMetadata }[];
  errors: Error[];
}

function createEvents(): TestEvents {
  const result: TestEvents = {
    statuses: [],
    connects: [],
    disconnects: [],
    data: [],
    errors: [],
    events: {
      onData(connectionId, payload, mqtt) {
        result.data.push({ connectionId, payload: Buffer.from(payload), mqtt });
      },
      onConnect(connection) {
        result.connects.push(connection);
      },
      onDisconnect(connectionId) {
        result.disconnects.push(connectionId);
      },
      onError(error) {
        result.errors.push(error);
      },
      onStatus(status) {
        result.statuses.push(status);
      },
    },
  };
  return result;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('等待 MQTT 测试条件超时');
    await delay(10);
  }
}

function portOf(adapter: MqttBrokerTransportAdapter): number {
  const endpoint = adapter.endpoints()[0];
  if (!endpoint) throw new Error('Broker 没有监听地址');
  return Number(new URL(endpoint).port);
}

function openClient(url: string, options: IClientOptions = {}): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = connect(url, {
      protocolVersion: 4,
      reconnectPeriod: 0,
      ...options,
    });
    const timer = setTimeout(() => {
      client.end(true);
      reject(new Error('MQTT Client 连接超时'));
    }, 3_000);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once('error', (error) => {
      clearTimeout(timer);
      client.end(true);
      reject(error);
    });
  });
}

function subscribe(client: MqttClient, topic: string, qos: 0 | 1): Promise<void> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos }, (error, grants) => {
      if (error) reject(error);
      else if (grants?.some((grant) => grant.qos === 128)) {
        reject(new Error(`订阅被拒绝：${topic}`));
      } else resolve();
    });
  });
}

function publish(
  client: MqttClient,
  topic: string,
  payload: Buffer,
  qos: 0 | 1,
  retain = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos, retain }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function nextMessage(client: MqttClient): Promise<ReceivedMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('message', onMessage);
      reject(new Error('等待 MQTT 消息超时'));
    }, 3_000);
    const onMessage = (
      topic: string,
      payload: Buffer,
      packet: IPublishPacket,
    ) => {
      clearTimeout(timer);
      client.off('message', onMessage);
      resolve({
        topic,
        payload: Buffer.from(payload),
        qos: packet.qos === 1 ? 1 : 0,
        retain: packet.retain,
      });
    };
    client.on('message', onMessage);
  });
}

async function closeClient(client: MqttClient | undefined): Promise<void> {
  if (!client) return;
  await new Promise<void>((resolve) => client.end(true, () => resolve()));
}

function brokerConfig(port = 0, auth = false) {
  return MqttBrokerTransportSchema.parse({
    type: 'mqtt-broker',
    host: '127.0.0.1',
    port,
    ...(auth ? { username: 'test-user', password: 'test-password' } : {}),
    publishTopic: 'deviceforge/down',
    publishQos: 0,
  });
}

describe('MQTT transport', () => {
  it('Broker 支持多个客户端、认证和 QoS 0/1 双向收发', async () => {
    const broker = new MqttBrokerTransportAdapter(brokerConfig(0, true));
    const events = createEvents();
    let first: MqttClient | undefined;
    let second: MqttClient | undefined;

    try {
      await broker.start(events.events);
      const url = `mqtt://127.0.0.1:${portOf(broker)}`;
      first = await openClient(url, { clientId: 'first', username: 'test-user', password: 'test-password' });
      second = await openClient(url, { clientId: 'second', username: 'test-user', password: 'test-password' });
      await Promise.all([subscribe(first, 'deviceforge/reply/#', 1), subscribe(second, 'deviceforge/reply/#', 1)]);
      await waitFor(() => events.connects.length === 2);

      for (const qos of [0, 1] as const) {
        const firstMessage = nextMessage(first);
        const secondMessage = nextMessage(second);
        const payload = Buffer.from(`qos-${qos}`);
        await broker.send('', payload, { topic: 'deviceforge/reply/state', qos });
        const [receivedFirst, receivedSecond] = await Promise.all([firstMessage, secondMessage]);
        expect(receivedFirst).toMatchObject({ topic: 'deviceforge/reply/state', qos, retain: false });
        expect(receivedFirst.payload).toEqual(payload);
        expect(receivedSecond).toMatchObject({ topic: 'deviceforge/reply/state', qos, retain: false });
        expect(receivedSecond.payload).toEqual(payload);
      }

      await publish(first, 'deviceforge/up/first', Buffer.from('one'), 0);
      await publish(second, 'deviceforge/up/second', Buffer.from('two'), 1);
      await publish(first, 'deviceforge/up/retained', Buffer.from('saved'), 1, true);
      await waitFor(() => events.data.length === 3);
      expect(events.data.map((item) => item.payload.toString()).sort()).toEqual(['one', 'saved', 'two']);
      expect(events.data
        .filter((item) => item.mqtt?.topic !== 'deviceforge/up/retained')
        .map((item) => item.mqtt)
        .sort((left, right) =>
        (left?.topic ?? '').localeCompare(right?.topic ?? ''),
      )).toEqual([
        { topic: 'deviceforge/up/first', qos: 0, retain: false, clientId: 'first' },
        { topic: 'deviceforge/up/second', qos: 1, retain: false, clientId: 'second' },
      ]);
      const retained = events.data.find((item) => item.mqtt?.topic === 'deviceforge/up/retained');
      expect(retained?.mqtt?.retain).toBe(true);

      first.publish('deviceforge/up/qos2', Buffer.from('unsupported'), { qos: 2 }, () => undefined);
      await waitFor(() => events.errors.some((error) => error.message.includes('QoS 0 和 QoS 1')));
      expect(events.data.some((item) => item.mqtt?.topic === 'deviceforge/up/qos2')).toBe(false);
    } finally {
      await closeClient(first);
      await closeClient(second);
      await broker.stop();
    }
  });

  it('拒绝错误凭据并报告不存在的 TLS 文件', async () => {
    const broker = new MqttBrokerTransportAdapter(brokerConfig(0, true));
    let rejectedClient: MqttClient | undefined;
    try {
      await broker.start(createEvents().events);
      const url = `mqtt://127.0.0.1:${portOf(broker)}`;
      await expect(
        new Promise<void>((resolve, reject) => {
          rejectedClient = connect(url, {
            protocolVersion: 4,
            reconnectPeriod: 0,
            clientId: 'wrong-user',
            username: 'wrong',
            password: 'wrong',
          });
          rejectedClient.once('connect', () => resolve());
          rejectedClient.once('error', reject);
        }),
      ).rejects.toThrow();
    } finally {
      await closeClient(rejectedClient);
      await broker.stop();
    }

    const brokerWithMissingTls = new MqttBrokerTransportAdapter(
      MqttBrokerTransportSchema.parse({
        type: 'mqtt-broker',
        certFile: '/tmp/deviceforge-missing-cert.pem',
        keyFile: '/tmp/deviceforge-missing-key.pem',
      }),
    );
    await expect(brokerWithMissingTls.start(createEvents().events)).rejects.toThrow(/ENOENT/);
    await brokerWithMissingTls.stop();

    const clientWithMissingCa = new MqttClientTransportAdapter(
      MqttClientTransportSchema.parse({
        type: 'mqtt-client',
        url: 'mqtts://localhost:8883',
        caFile: '/tmp/deviceforge-missing-ca.pem',
      }),
      'mqtt-device',
    );
    await expect(clientWithMissingCa.start(createEvents().events)).rejects.toThrow(/ENOENT/);
    await clientWithMissingCa.stop();
  });

  it('MQTT Client 使用设备 ID、订阅单帧并发布消息', async () => {
    const broker = new MqttBrokerTransportAdapter(brokerConfig());
    const brokerEvents = createEvents();
    const clientEvents = createEvents();
    let clientAdapter: MqttClientTransportAdapter | undefined;
    let publisher: MqttClient | undefined;

    try {
      await broker.start(brokerEvents.events);
      const url = `mqtt://127.0.0.1:${portOf(broker)}`;
      const configured = MqttClientTransportSchema.parse({
        type: 'mqtt-client',
        url,
        subscriptions: [{ topic: 'deviceforge/client/in/#', qos: 1 }],
        publishTopic: 'deviceforge/client/out',
        publishQos: 1,
      });
      clientAdapter = new MqttClientTransportAdapter(configured, 'mqtt-device-id');
      await clientAdapter.start(clientEvents.events);
      await waitFor(() => clientEvents.connects.length === 1);
      expect(clientEvents.connects[0]?.clientId).toBe('mqtt-device-id');

      publisher = await openClient(url, { clientId: 'publisher' });
      await publish(publisher, 'deviceforge/client/in/one', Buffer.from([0xaa, 0xbb]), 1);
      await waitFor(() => clientEvents.data.length === 1);
      expect(clientEvents.data[0]).toMatchObject({
        payload: Buffer.from([0xaa, 0xbb]),
        mqtt: { topic: 'deviceforge/client/in/one', qos: 1, retain: false },
      });

      const connectionId = clientAdapter.lastConnectionId();
      expect(connectionId).toBeTruthy();
      await clientAdapter.send(connectionId!, Buffer.from('outgoing'));
      await waitFor(() => brokerEvents.data.length === 2);
      const outgoing = brokerEvents.data.find((item) => item.mqtt?.topic === 'deviceforge/client/out');
      expect(outgoing).toMatchObject({
        payload: Buffer.from('outgoing'),
        mqtt: { topic: 'deviceforge/client/out', qos: 1, clientId: 'mqtt-device-id' },
      });

    } finally {
      await closeClient(publisher);
      await clientAdapter?.stop();
      await broker.stop();
    }
  });

  it('MQTT Client 在 Broker 重启后自动重连', async () => {
    const firstBroker = new MqttBrokerTransportAdapter(brokerConfig());
    await firstBroker.start(createEvents().events);
    const port = portOf(firstBroker);
    const events = createEvents();
    const adapter = new MqttClientTransportAdapter(
      MqttClientTransportSchema.parse({ type: 'mqtt-client', url: `mqtt://127.0.0.1:${port}` }),
      'reconnecting-device',
    );
    let secondBroker: MqttBrokerTransportAdapter | undefined;

    try {
      await adapter.start(events.events);
      await waitFor(() => events.connects.length === 1);
      await firstBroker.stop();
      await waitFor(() => events.statuses.some((status) => status.state === 'reconnecting'));

      secondBroker = new MqttBrokerTransportAdapter(brokerConfig(port));
      await secondBroker.start(createEvents().events);
      await waitFor(() => events.connects.length === 2, 8_000);
      expect(adapter.status().state).toBe('connected');
      expect(events.connects[1]?.id).not.toBe(events.connects[0]?.id);
    } finally {
      await adapter.stop();
      await firstBroker.stop();
      await secondBroker?.stop();
    }
  });

  it('Runtime 绕过 TCP 分帧并按主题规则发布带元数据的响应', async () => {
    const runtime = new DeviceRuntime(DeviceConfigSchema.parse({
      id: 'mqtt-runtime',
      name: 'MQTT 运行时',
      transport: {
        type: 'mqtt-broker',
        host: '127.0.0.1',
        port: 0,
        publishTopic: 'default/down',
        publishQos: 1,
      },
      framing: { type: 'fixed', length: 8 },
      codec: { type: 'raw', display: 'hex' },
      rules: [{
        name: '主题响应',
        on: 'frame',
        topicFilter: 'sensors/+/state',
        set: {
          topic: '$mqtt.topic',
          qos: '$mqtt.qos',
          retain: '$mqtt.retain',
          publisher: '$mqtt.clientId',
        },
        send: { hex: 'BEEF' },
        publishTopic: 'replies/${mqtt.topic}',
      }],
    }));
    let client: MqttClient | undefined;

    try {
      await runtime.start();
      const endpoint = runtime.getStatus().endpoints[0];
      if (!endpoint) throw new Error('MQTT Runtime 没有监听地址');
      const url = `mqtt://${endpoint.slice(endpoint.indexOf('://') + 3)}`;
      client = await openClient(url, { clientId: 'runtime-test-client' });
      await subscribe(client, 'replies/#', 1);
      const response = nextMessage(client);
      await publish(client, 'sensors/zone-a/state', Buffer.from([0xaa]), 1, true);

      const received = await response;
      expect(received).toMatchObject({ topic: 'replies/sensors/zone-a/state', qos: 1, retain: false });
      expect(received.payload).toEqual(Buffer.from([0xbe, 0xef]));
      await waitFor(() => runtime.getState().topic === 'sensors/zone-a/state');
      expect(runtime.getState()).toMatchObject({
        topic: 'sensors/zone-a/state',
        qos: 1,
        retain: true,
        publisher: 'runtime-test-client',
      });
      await runtime.send({ hex: 'ABCD' });
      expect(runtime.getTraffic().find((event) => event.mqtt?.topic === 'default/down')).toMatchObject({
        data: 'abcd',
        mqtt: { topic: 'default/down', qos: 1, retain: false },
      });
      expect(runtime.getStatus().counters.rxFrames).toBe(1);
      const inbound = runtime.getTraffic().find((event) => event.direction === 'in');
      expect(inbound).toMatchObject({
        data: 'aa',
        mqtt: {
          topic: 'sensors/zone-a/state',
          qos: 1,
          retain: true,
          clientId: 'runtime-test-client',
        },
      });
    } finally {
      await closeClient(client);
      await runtime.stop();
    }
  });
});
