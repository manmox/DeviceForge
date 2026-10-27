import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceRuntime } from '../runtime/device-runtime';
import { DeviceConfigSchema } from '../schema/device';
import type { ConnectionInfo, MqttMessageMetadata, TransportStatus } from '../types';
import type {
  TransportAdapter,
  TransportEvents,
  TransportSendOptions,
} from '../transport/types';
import { createTransport } from '../transport';

vi.mock('../transport', () => ({ createTransport: vi.fn() }));

class FakeTransport implements TransportAdapter {
  readonly kind: TransportAdapter['kind'];
  readonly sent: Buffer[] = [];
  private events?: TransportEvents;
  private connected = false;
  private readonly connection: ConnectionInfo = {
    id: 'conn-1',
    remoteAddress: '127.0.0.1',
    remotePort: 19001,
    connectedAt: Date.now(),
    rxBytes: 0,
    txBytes: 0,
    clientId: 'client-1',
  };

  constructor(kind: TransportAdapter['kind']) {
    this.kind = kind;
  }

  async start(events: TransportEvents): Promise<void> {
    this.events = events;
    this.connected = true;
    events.onConnect(this.connection);
  }

  async stop(): Promise<void> {
    this.connected = false;
  }

  async send(_connectionId: string, data: Buffer, _options?: TransportSendOptions): Promise<void> {
    this.sent.push(Buffer.from(data));
  }

  async disconnect(connectionId: string): Promise<void> {
    this.connected = false;
    this.events?.onDisconnect(connectionId);
  }

  receive(data: Buffer, metadata?: MqttMessageMetadata): void {
    this.events?.onData(this.connection.id, data, metadata ? { mqtt: metadata } : undefined);
  }

  connections(): ConnectionInfo[] {
    return this.connected ? [this.connection] : [];
  }

  endpoints(): string[] {
    return [];
  }

  lastConnectionId(): string | undefined {
    return this.connected ? this.connection.id : undefined;
  }

  status(): TransportStatus {
    return {
      kind: this.kind,
      state: this.connected ? 'connected' : 'idle',
    };
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DeviceRuntime 故障注入', () => {
  it('热启用后在 TCP 出站字节流丢弃片段并更新实际发送计数', async () => {
    const transport = new FakeTransport('tcp-server');
    vi.mocked(createTransport).mockReturnValue(transport);
    const runtime = new DeviceRuntime(DeviceConfigSchema.parse({
      id: 'fault-tcp',
      name: '故障 TCP',
      transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
      faultInjection: {
        segmentSizeBytes: 1,
        rules: [{
          id: 'drop-first',
          name: '丢弃首字节',
          direction: 'out',
          trigger: { type: 'sequence', mode: 'indices', indices: [1] },
          action: { type: 'drop' },
        }],
      },
    }));
    await runtime.start();
    await runtime.setFaultInjectionEnabled(true);

    await runtime.send({ hex: 'AABB' }, { target: 'last' });
    expect(Buffer.concat(transport.sent).toString('hex')).toBe('bb');
    expect(runtime.getStatus().counters.txBytes).toBe(1);
    expect(runtime.getTraffic().some((event) => event.note?.includes('丢弃'))).toBe(true);

    await runtime.stop();
    expect(runtime.getStatus().faultInjectionEnabled).toBe(false);
  });

  it('MQTT 出站丢包仍进入现有应用层 ACK 重试', async () => {
    const transport = new FakeTransport('mqtt-client');
    vi.mocked(createTransport).mockReturnValue(transport);
    const runtime = new DeviceRuntime(DeviceConfigSchema.parse({
      id: 'fault-mqtt',
      name: '故障 MQTT',
      transport: {
        type: 'mqtt-client',
        url: 'mqtt://127.0.0.1:1883',
        subscriptions: [],
      },
      codec: {
        type: 'text',
        messages: [
          { name: 'report', slots: [{ kind: 'field', name: 'seq', type: 'int' }] },
          {
            name: 'ack',
            slots: [
              { kind: 'field', name: 'seq', type: 'int' },
              { kind: 'field', name: 'status', type: 'string' },
            ],
          },
        ],
        session: {
          ackMessage: 'ack',
          trackMessages: ['report'],
          sequenceField: 'seq',
          statusField: 'status',
          timeoutMs: 100,
          maxRetries: 1,
        },
      },
      faultInjection: {
        rules: [{
          id: 'drop-all',
          name: '持续丢包',
          direction: 'out',
          trigger: { type: 'probability', percent: 100 },
          action: { type: 'drop' },
        }],
      },
    }));
    await runtime.start();
    await runtime.setFaultInjectionEnabled(true);

    await runtime.send({ fields: { kind: 'report', seq: 7 } }, { target: 'last' });
    expect(transport.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(210);

    expect(transport.sent).toHaveLength(0);
    expect(runtime.getTraffic().some((event) => event.note?.includes('重试 1 次'))).toBe(true);
    expect(runtime.getStatus().counters.txFrames).toBe(2);
    await runtime.stop();
  });

  it('被丢弃的 MQTT 入站消息在故障系统事件中保留主题和 QoS', async () => {
    const transport = new FakeTransport('mqtt-client');
    vi.mocked(createTransport).mockReturnValue(transport);
    const runtime = new DeviceRuntime(DeviceConfigSchema.parse({
      id: 'fault-mqtt-in',
      name: '故障 MQTT 入站',
      transport: {
        type: 'mqtt-client',
        url: 'mqtt://127.0.0.1:1883',
        subscriptions: [],
      },
      faultInjection: {
        rules: [{
          id: 'drop-all',
          name: '丢弃入站',
          direction: 'in',
          trigger: { type: 'probability', percent: 100 },
          action: { type: 'drop' },
        }],
      },
    }));
    await runtime.start();
    await runtime.setFaultInjectionEnabled(true);
    transport.receive(Buffer.from('4142', 'hex'), {
      topic: 'sensors/room-a/state',
      qos: 1,
      retain: true,
      clientId: 'publisher-a',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(runtime.getTraffic().at(-1)).toMatchObject({
      direction: 'system',
      mqtt: {
        topic: 'sensors/room-a/state',
        qos: 1,
        retain: true,
        clientId: 'publisher-a',
      },
      note: expect.stringContaining('丢弃'),
    });
    await runtime.stop();
  });
});
