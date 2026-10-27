import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { existsSync } from 'node:fs';
import { SerialPort } from 'serialport';
import WebSocket from 'ws';
import { describe, expect, it } from 'vitest';
import { DeviceRuntime } from '../runtime/device-runtime';
import { DeviceConfigSchema } from '../schema/device';
import type { TrafficEvent } from '../types';

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function endpointPort(endpoint: string): number {
  return Number(endpoint.slice(endpoint.lastIndexOf(':') + 1));
}

function deviceConfig(input: Record<string, unknown>) {
  return DeviceConfigSchema.parse({
    id: 'm2-test',
    name: 'M2 测试设备',
    framing: { type: 'raw' },
    codec: { type: 'raw', display: 'hex' },
    ...input,
  });
}

function udpMessage(socket: Socket, timeoutMs = 2_000): Promise<{ data: Buffer; remote: RemoteInfo }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('等待 UDP 数据报超时'));
    }, timeoutMs);
    const onMessage = (data: Buffer, remote: RemoteInfo) => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve({ data: Buffer.from(data), remote });
    };
    socket.on('message', onMessage);
  });
}

function sendUdp(socket: Socket, data: Buffer, port: number, host = '127.0.0.1'): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(data, port, host, (error) => error ? reject(error) : resolve());
  });
}

function nextWebSocketMessage(socket: WebSocket): Promise<{ data: Buffer; binary: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('等待 WebSocket 消息超时'));
    }, 2_000);
    const onMessage = (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve({ data: Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as ArrayBuffer), binary: isBinary });
    };
    socket.on('message', onMessage);
  });
}

async function closeWebSocket(socket: WebSocket | undefined): Promise<void> {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  socket.terminate();
  await once(socket, 'close').catch(() => undefined);
}

async function openSerialPort(path: string): Promise<SerialPort> {
  const port = new SerialPort({ path, baudRate: 9600, autoOpen: false });
  await new Promise<void>((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));
  return port;
}

const socatAvailable = (() => {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return false;
  try {
    execFileSync('socat', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('M2 transports', () => {
  it('UDP Server keeps sender endpoints separate and replies to each source', async () => {
    const runtime = new DeviceRuntime(deviceConfig({
      transport: { type: 'udp-server', host: '127.0.0.1', port: 0 },
      rules: [{ on: 'frame', send: { hex: '4F4B' } }],
    }));
    const first = createSocket('udp4');
    const second = createSocket('udp4');
    const seen: TrafficEvent[] = [];
    runtime.on('traffic', (event) => seen.push(event));
    try {
      await runtime.start();
      const port = endpointPort(runtime.getStatus().endpoints[0]!);
      const firstReply = udpMessage(first);
      await sendUdp(first, Buffer.from('first'), port);
      expect((await firstReply).data.toString()).toBe('OK');

      const secondReply = udpMessage(second);
      await sendUdp(second, Buffer.from('second'), port);
      expect((await secondReply).data.toString()).toBe('OK');

      const incoming = seen.filter((event) => event.direction === 'in');
      expect(incoming).toHaveLength(2);
      expect(incoming[0]?.connectionId).not.toBe(incoming[1]?.connectionId);
      expect(runtime.getConnections()).toHaveLength(2);
    } finally {
      await runtime.stop();
      first.close();
      second.close();
    }
  });

  it('UDP 入站故障注入按数据报处理，并写入流量系统事件', async () => {
    const runtime = new DeviceRuntime(deviceConfig({
      transport: { type: 'udp-server', host: '127.0.0.1', port: 0 },
      rules: [{ on: 'frame', send: { hex: '4F4B' } }],
      faultInjection: {
        rules: [{
          id: 'drop-udp-in',
          name: '丢弃 UDP 入站',
          direction: 'in',
          trigger: { type: 'probability', percent: 100 },
          action: { type: 'drop' },
        }],
      },
    }));
    const source = createSocket('udp4');
    try {
      await runtime.start();
      await runtime.setFaultInjectionEnabled(true);
      const port = endpointPort(runtime.getStatus().endpoints[0]!);
      await sendUdp(source, Buffer.from('drop me'), port);
      await waitFor(
        () => runtime.getTraffic().some((event) => event.direction === 'system' && event.note?.includes('故障注入')),
        '等待 UDP 故障注入系统事件',
      );

      expect(runtime.getStatus().counters.rxFrames).toBe(0);
      expect(runtime.getTraffic().filter((event) => event.direction === 'out')).toHaveLength(0);
      expect(runtime.getTraffic().find(
        (event) => event.direction === 'system' && event.note?.includes('故障注入'),
      )).toMatchObject({
        direction: 'system',
        note: expect.stringContaining('第 1 条消息'),
      });
    } finally {
      await runtime.stop();
      source.close();
    }
  });

  it('UDP Client sends to its configured target and answers a returned datagram', async () => {
    const server = createSocket('udp4');
    server.bind(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    const runtime = new DeviceRuntime(deviceConfig({
      transport: { type: 'udp-client', host: '127.0.0.1', port: address.port },
      rules: [{ on: 'frame', send: { hex: '43' } }],
    }));
    try {
      await runtime.start();
      const firstMessage = udpMessage(server);
      await runtime.send({ hex: '41' });
      const request = await firstMessage;
      expect(request.data.toString()).toBe('A');

      const response = udpMessage(server);
      await sendUdp(server, Buffer.from('B'), request.remote.port, request.remote.address);
      expect((await response).data.toString()).toBe('C');
    } finally {
      await runtime.stop();
      server.close();
    }
  });

  it('HTTP Server matches request metadata, returns configured status and headers, and redacts secrets in traffic', async () => {
    const runtime = new DeviceRuntime(deviceConfig({
      transport: { type: 'http-server', host: '127.0.0.1', port: 0 },
      rules: [{
        on: 'frame',
        match: {
          'http.method': 'POST',
          'http.path': '/health',
          'http.query.mode': 'full',
          'http.headers.content-type': 'text/plain',
        },
        set: { lastBody: '$http.body' },
        send: { hex: '4F4B' },
        httpResponse: { statusCode: 202, headers: { 'x-deviceforge': 'm2' } },
      }],
    }));
    try {
      await runtime.start();
      const endpoint = runtime.getStatus().endpoints[0]!;
      const response = await fetch(`${endpoint}/health?mode=full&token=private-value`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', authorization: 'Bearer private-value' },
        body: 'request body',
      });
      expect(response.status).toBe(202);
      expect(response.headers.get('x-deviceforge')).toBe('m2');
      expect(await response.text()).toBe('OK');
      expect(runtime.getState().lastBody).toBe('request body');

      const requestEvent = runtime.getTraffic().find((event) => event.direction === 'in');
      expect(requestEvent?.http?.query.token).toBe('[redacted]');
      expect(requestEvent?.http?.url).not.toContain('private-value');
      expect(requestEvent?.http?.headers.authorization).toBe('[redacted]');

      const missing = await fetch(`${endpoint}/missing`);
      expect(missing.status).toBe(404);
    } finally {
      await runtime.stop();
    }
  });

  it('WebSocket Server handles multiple clients and preserves text/binary message type in replies', async () => {
    const runtime = new DeviceRuntime(deviceConfig({
      transport: { type: 'websocket-server', host: '127.0.0.1', port: 0, path: '/ws' },
      rules: [{ on: 'frame', set: { lastBinary: '$websocket.isBinary' }, send: { hex: '4F4B' } }],
    }));
    let first: WebSocket | undefined;
    let second: WebSocket | undefined;
    try {
      await runtime.start();
      const endpoint = new URL(runtime.getStatus().endpoints[0]!);
      first = new WebSocket(endpoint);
      second = new WebSocket(endpoint);
      await Promise.all([once(first, 'open'), once(second, 'open')]);
      await waitFor(() => runtime.getConnections().length === 2, '等待两个 WebSocket 客户端连接');

      const textReply = nextWebSocketMessage(first);
      first.send('text request');
      const text = await textReply;
      expect(text.data.toString()).toBe('OK');
      expect(text.binary).toBe(false);

      const binaryReply = nextWebSocketMessage(second);
      second.send(Buffer.from([0x01, 0x02]), { binary: true });
      const binary = await binaryReply;
      expect(binary.data.toString()).toBe('OK');
      expect(binary.binary).toBe(true);

      const inbound = runtime.getTraffic().filter((event) => event.direction === 'in');
      expect(inbound).toHaveLength(2);
      expect(inbound.map((event) => event.websocket?.isBinary)).toEqual([false, true]);
      expect(runtime.getState().lastBinary).toBe(true);
    } finally {
      await Promise.all([closeWebSocket(first), closeWebSocket(second)]);
      await runtime.stop();
    }
  });

  it.skipIf(!socatAvailable)('virtual serial creates a PTY pair, applies stream framing, and removes it on stop', async () => {
    const runtime = new DeviceRuntime(deviceConfig({
      transport: { type: 'virtual-serial', baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
      framing: { type: 'delimiter', delimiterFormat: 'text', delimiter: '\n', includeDelimiter: false },
      rules: [{ on: 'frame', send: { hex: '4F4B0A' } }],
    }));
    let external: SerialPort | undefined;
    let paths: string[] = [];
    try {
      await runtime.start();
      paths = runtime.getStatus().endpoints;
      expect(paths).toHaveLength(2);
      external = await openSerialPort(paths[1]!);
      const received = new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('等待虚拟串口响应超时')), 2_000);
        external!.once('data', (data: Buffer) => {
          clearTimeout(timer);
          resolve(Buffer.from(data));
        });
      });
      await new Promise<void>((resolve, reject) => {
        external!.write(Buffer.from('PING\n'), (error) => error ? reject(error) : resolve());
      });
      expect((await received).toString()).toBe('OK\n');
      await external.close();
      external = undefined;
      await runtime.stop();
      expect(runtime.getStatus().endpoints).toEqual([]);
      for (const endpoint of paths) expect(existsSync(endpoint)).toBe(false);
    } finally {
      if (external?.isOpen) await new Promise<void>((resolve) => external!.close(() => resolve()));
      await runtime.stop();
      for (const path of paths) expect(path).toContain('deviceforge-serial-');
    }
  });
});
