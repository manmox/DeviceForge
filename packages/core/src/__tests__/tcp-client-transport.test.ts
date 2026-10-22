import { setTimeout as delay } from 'node:timers/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { TcpClientTransport } from '../schema/device';
import { TcpClientTransportAdapter, nextReconnectDelay } from '../transport/tcp-client';
import type { TransportEvents } from '../transport/types';
import type { ConnectionInfo, TransportStatus } from '../types';

function clientConfig(
  port: number,
  overrides: Partial<TcpClientTransport> = {},
): TcpClientTransport {
  return {
    type: 'tcp-client',
    host: '127.0.0.1',
    port,
    connectTimeoutMs: 300,
    reconnect: {
      enabled: true,
      minDelayMs: 10,
      maxDelayMs: 40,
    },
    ...overrides,
  };
}

function createEvents() {
  const statuses: TransportStatus[] = [];
  const connects: ConnectionInfo[] = [];
  const disconnects: string[] = [];
  const errors: Error[] = [];
  const data: { connectionId: string; data: Buffer }[] = [];

  const events: TransportEvents = {
    onData(connectionId, chunk) {
      data.push({ connectionId, data: Buffer.from(chunk) });
    },
    onConnect(connection) {
      connects.push(connection);
    },
    onDisconnect(connectionId) {
      disconnects.push(connectionId);
    },
    onError(error) {
      errors.push(error);
    },
    onStatus(status) {
      statuses.push(status);
    },
  };

  return { events, statuses, connects, disconnects, errors, data };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('等待测试条件超时');
    }
    await delay(10);
  }
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address !== 'object') {
    server.close();
    throw new Error('无法分配测试端口');
  }
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface TestServer {
  server: Server;
  port: number;
  sockets: Set<Socket>;
  data: string[];
}

async function startServer(port = 0, echo = false): Promise<TestServer> {
  const sockets = new Set<Socket>();
  const data: string[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('data', (chunk: Buffer) => {
      data.push(chunk.toString('utf8'));
      if (echo) socket.write(chunk);
    });
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('测试服务器没有监听端口');
  }
  return { server, port: address.port, sockets, data };
}

async function closeServer(server: TestServer): Promise<void> {
  for (const socket of server.sockets) socket.destroy();
  await new Promise<void>((resolve) => server.server.close(() => resolve()));
}

describe('TcpClientTransportAdapter', () => {
  it('starts without an upstream, then connects and exchanges data', async () => {
    const port = await reservePort();
    const adapter = new TcpClientTransportAdapter(clientConfig(port));
    const testEvents = createEvents();
    let server: TestServer | undefined;

    try {
      await adapter.start(testEvents.events);

      await waitFor(() =>
        testEvents.statuses.some((status) => status.state === 'reconnecting'),
      );
      expect(testEvents.errors).toHaveLength(1);

      server = await startServer(port, true);

      await waitFor(() => testEvents.connects.length === 1);
      const connection = testEvents.connects[0]!;
      expect(adapter.status().state).toBe('connected');
      expect(adapter.lastConnectionId()).toBe(connection.id);
      expect(adapter.connections()).toHaveLength(1);

      await adapter.send(connection.id, Buffer.from('ping'));
      await waitFor(() => testEvents.data.length === 1);
      expect(testEvents.data[0]?.data.toString('utf8')).toBe('ping');
      expect(server.data).toContain('ping');

      const [info] = adapter.connections();
      expect(info?.txBytes).toBe(4);
      expect(info?.rxBytes).toBe(4);
    } finally {
      await adapter.stop();
      if (server) await closeServer(server);
    }
  });

  it('reconnects after the upstream closes and uses a new connection id', async () => {
    const server = await startServer();
    const adapter = new TcpClientTransportAdapter(clientConfig(server.port));
    const testEvents = createEvents();

    try {
      await adapter.start(testEvents.events);
      await waitFor(() => testEvents.connects.length === 1);
      const first = testEvents.connects[0]!;

      for (const socket of server.sockets) socket.destroy();
      await waitFor(() => testEvents.disconnects.includes(first.id));
      await waitFor(() =>
        testEvents.statuses.some((status) => status.state === 'reconnecting'),
      );

      await waitFor(() => testEvents.connects.length === 2);
      const second = testEvents.connects[1]!;
      expect(second.id).not.toBe(first.id);
      expect(adapter.lastConnectionId()).toBe(second.id);
      expect(adapter.status().state).toBe('connected');
    } finally {
      await adapter.stop();
      await closeServer(server);
    }
  });

  it('stops retrying and stays idle', async () => {
    const port = await reservePort();
    const adapter = new TcpClientTransportAdapter(clientConfig(port));
    const testEvents = createEvents();

    await adapter.start(testEvents.events);
    await waitFor(() =>
      testEvents.statuses.some((status) => status.state === 'reconnecting'),
    );

    await adapter.stop();
    expect(adapter.status().state).toBe('idle');
    const statusCount = testEvents.statuses.length;
    const errorCount = testEvents.errors.length;

    await delay(150);
    expect(testEvents.statuses).toHaveLength(statusCount);
    expect(testEvents.errors).toHaveLength(errorCount);
    expect(testEvents.connects).toHaveLength(0);
  });

  it('reports a terminal transport error when reconnect is disabled', async () => {
    const port = await reservePort();
    const adapter = new TcpClientTransportAdapter(
      clientConfig(port, {
        reconnect: { enabled: false, minDelayMs: 10, maxDelayMs: 40 },
      }),
    );
    const testEvents = createEvents();

    try {
      await adapter.start(testEvents.events);
      await waitFor(() =>
        testEvents.statuses.some((status) => status.state === 'error'),
      );
      expect(testEvents.errors).toHaveLength(1);

      const statusCount = testEvents.statuses.length;
      await delay(120);
      expect(testEvents.statuses).toHaveLength(statusCount);
      expect(testEvents.connects).toHaveLength(0);
    } finally {
      await adapter.stop();
    }
  });

  it('enters a terminal error when an active connection drops with reconnect disabled', async () => {
    const server = await startServer();
    const adapter = new TcpClientTransportAdapter(
      clientConfig(server.port, {
        reconnect: { enabled: false, minDelayMs: 10, maxDelayMs: 40 },
      }),
    );
    const testEvents = createEvents();

    try {
      await adapter.start(testEvents.events);
      await waitFor(() => testEvents.connects.length === 1);

      for (const socket of server.sockets) socket.destroy();
      await waitFor(() =>
        testEvents.statuses.some((status) => status.state === 'error'),
      );
      expect(testEvents.errors).toHaveLength(1);
      expect(adapter.connections()).toHaveLength(0);

      await delay(120);
      expect(testEvents.connects).toHaveLength(1);
    } finally {
      await adapter.stop();
      await closeServer(server);
    }
  });

  it('pauses reconnect after a manual disconnect and resumes after restart', async () => {
    const server = await startServer();
    const adapter = new TcpClientTransportAdapter(clientConfig(server.port));
    const testEvents = createEvents();

    try {
      await adapter.start(testEvents.events);
      await waitFor(() => testEvents.connects.length === 1);
      const first = testEvents.connects[0]!;

      await adapter.disconnect(first.id);
      await waitFor(() =>
        testEvents.statuses.some((status) => status.state === 'disconnected'),
      );
      expect(testEvents.disconnects).toContain(first.id);

      await delay(120);
      expect(testEvents.connects).toHaveLength(1);

      await adapter.stop();
      await adapter.start(testEvents.events);
      await waitFor(() => testEvents.connects.length === 2);
      expect(adapter.status().state).toBe('connected');
    } finally {
      await adapter.stop();
      await closeServer(server);
    }
  });

  it('rejects sends while disconnected and ignores unknown disconnects', async () => {
    const port = await reservePort();
    const adapter = new TcpClientTransportAdapter(clientConfig(port));
    const testEvents = createEvents();

    try {
      await adapter.start(testEvents.events);
      await waitFor(() =>
        testEvents.statuses.some((status) => status.state === 'reconnecting'),
      );

      await expect(
        adapter.send('missing-connection', Buffer.from('ping')),
      ).rejects.toThrow('上游尚未连接');
      await expect(adapter.disconnect('missing-connection')).resolves.toBeUndefined();
      expect(adapter.connections()).toHaveLength(0);
    } finally {
      await adapter.stop();
    }
  });
});

describe('nextReconnectDelay', () => {
  const reconnect = { enabled: true, minDelayMs: 500, maxDelayMs: 10_000 };

  it('grows exponentially and caps at maxDelayMs', () => {
    expect(nextReconnectDelay(1, reconnect, () => 0.5)).toBe(500);
    expect(nextReconnectDelay(2, reconnect, () => 0.5)).toBe(1_000);
    expect(nextReconnectDelay(3, reconnect, () => 0.5)).toBe(2_000);
    expect(nextReconnectDelay(6, reconnect, () => 0.5)).toBe(10_000);
    expect(nextReconnectDelay(20, reconnect, () => 0.5)).toBe(10_000);
  });

  it('applies the fixed jitter around the base delay', () => {
    expect(nextReconnectDelay(1, reconnect, () => 0)).toBe(400);
    expect(nextReconnectDelay(1, reconnect, () => 1)).toBe(600);
    expect(nextReconnectDelay(1, reconnect, () => 0.5)).toBe(500);
  });
});
