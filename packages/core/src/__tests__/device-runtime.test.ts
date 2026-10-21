import { once } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createCodec } from '../codec';
import { createFramer, type FrameDecoder } from '../framing';
import { DeviceRuntime } from '../runtime/device-runtime';
import { DeviceConfigSchema, type DeviceConfig } from '../schema/device';
import type { TrafficEvent } from '../types';

const config: DeviceConfig = DeviceConfigSchema.parse({
  id: 'sensor-1',
  name: '测试传感器',
  transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
  framing: {
    type: 'length-prefix',
    lengthField: { offset: 2, size: 2, endian: 'be', adjust: 0 },
    maxFrameLength: 4096,
  },
  codec: {
    type: 'fields',
    fields: [
      { name: 'magic', type: 'bytes', length: 2, const: 'AA55' },
      { name: 'length', type: 'u16', endian: 'be', calc: 'totalLength' },
      { name: 'cmd', type: 'u8' },
      { name: 'seq', type: 'u16', endian: 'le' },
      { name: 'temp', type: 'i16', endian: 'be', scale: 0.1 },
      { name: 'humidity', type: 'u8' },
    ],
    checksum: { algo: 'crc16-modbus', endian: 'le', verify: true },
  },
  state: { temp: 25.5 },
  rules: [
    {
      name: '上线握手',
      on: 'connect',
      send: { fields: { cmd: 1, seq: 0, temp: 0, humidity: 0 } },
    },
    {
      name: '读取温度',
      on: 'frame',
      match: { cmd: 3 },
      send: {
        fields: { cmd: 131, seq: '$req.seq', temp: '$state.temp', humidity: 60 },
      },
    },
  ],
});

interface TestClient {
  socket: Socket;
  nextFrame(timeoutMs?: number): Promise<Buffer>;
  close(): void;
}

async function connectClient(port: number, framer: FrameDecoder): Promise<TestClient> {
  const socket = createConnection({ host: '127.0.0.1', port });
  const queue: Buffer[] = [];
  const waiters: ((frame: Buffer) => void)[] = [];

  socket.on('data', (chunk: Buffer) => {
    for (const frame of framer.push(chunk)) {
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queue.push(frame);
    }
  });

  await once(socket, 'connect');

  return {
    socket,
    nextFrame(timeoutMs = 2000): Promise<Buffer> {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('等待客户端报文超时')),
          timeoutMs,
        );
        waiters.push((frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
      });
    },
    close() {
      socket.destroy();
    },
  };
}

function portOf(runtime: DeviceRuntime): number {
  const endpoint = runtime.getStatus().endpoints[0];
  if (!endpoint) throw new Error('设备没有监听地址');
  return Number(endpoint.slice(endpoint.lastIndexOf(':') + 1));
}

const codec = createCodec(config.codec);

describe('DeviceRuntime over TCP', () => {
  it('sends a greeting, answers matched frames, and records traffic', async () => {
    const runtime = new DeviceRuntime(config);
    const traffic: TrafficEvent[] = [];
    runtime.on('traffic', (event) => traffic.push(event));

    await runtime.start();
    const client = await connectClient(portOf(runtime), createFramer(config.framing));

    try {
      const greeting = await client.nextFrame();
      const greetingDecoded = codec.decode(greeting);
      expect(greetingDecoded.valid).toBe(true);
      expect(greetingDecoded.fields).toMatchObject({ cmd: 1, seq: 0 });

      const request = codec.encode(
        { fields: { cmd: 3, seq: 7, temp: 0, humidity: 0 } },
        { state: {}, counters: {}, now: Date.now() },
      );
      client.socket.write(request);

      const response = await client.nextFrame();
      const responseDecoded = codec.decode(response);
      expect(responseDecoded.valid).toBe(true);
      expect(responseDecoded.fields).toMatchObject({
        cmd: 131,
        seq: 7,
        temp: 25.5,
        humidity: 60,
      });

      expect(traffic.some((event) => event.direction === 'in' && event.decoded?.cmd === 3)).toBe(
        true,
      );
      expect(
        traffic.some((event) => event.direction === 'out' && event.decoded?.cmd === 131),
      ).toBe(true);
      expect(runtime.getConnections()).toHaveLength(1);
      expect(runtime.getStatus().counters.rxFrames).toBeGreaterThanOrEqual(1);
      expect(runtime.getStatus().counters.txFrames).toBeGreaterThanOrEqual(2);
    } finally {
      client.close();
      await runtime.stop();
    }
  });

  it('sends a manually composed message to the latest connection', async () => {
    const runtime = new DeviceRuntime(config);
    await runtime.start();
    const client = await connectClient(portOf(runtime), createFramer(config.framing));

    try {
      await client.nextFrame();
      await runtime.send(
        { fields: { cmd: 9, seq: 0, temp: 12.3, humidity: 45 } },
        { target: 'last' },
      );

      const response = await client.nextFrame();
      const decoded = codec.decode(response);
      expect(decoded.valid).toBe(true);
      expect(decoded.fields).toMatchObject({ cmd: 9, temp: 12.3, humidity: 45 });
    } finally {
      client.close();
      await runtime.stop();
    }
  });

  it('reports checksum failures and does not dispatch rules', async () => {
    const runtime = new DeviceRuntime(config);
    const errors: string[] = [];
    runtime.on('error', (event) => errors.push(event.message));

    await runtime.start();
    const client = await connectClient(portOf(runtime), createFramer(config.framing));

    try {
      await client.nextFrame();
      const request = codec.encode(
        { fields: { cmd: 3, seq: 7, temp: 0, humidity: 0 } },
        { state: {}, counters: {}, now: Date.now() },
      );
      request[request.length - 1] = request[request.length - 1]! ^ 0xff;
      client.socket.write(request);

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(errors.some((message) => message.includes('校验失败'))).toBe(true);
      expect(runtime.getTraffic().some((event) => event.direction === 'in' && event.error)).toBe(
        true,
      );
    } finally {
      client.close();
      await runtime.stop();
    }
  });
});
