import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { TcpServerTransport } from '../schema/device';
import type { ConnectionInfo } from '../types';
import type { TransportAdapter, TransportEvents } from './types';

interface ActiveConnection {
  info: ConnectionInfo;
  socket: Socket;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class TcpServerTransportAdapter implements TransportAdapter {
  readonly kind = 'tcp-server';

  private server?: Server;
  private events?: TransportEvents;
  private readonly active = new Map<string, ActiveConnection>();
  private endpointList: string[] = [];
  private lastId?: string;

  constructor(private readonly config: TcpServerTransport) {}

  async start(events: TransportEvents): Promise<void> {
    if (this.server) throw new Error('TCP server 已经启动');

    this.events = events;
    const server = createServer((socket) => this.handleSocket(socket));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        this.server = undefined;
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host: this.config.host, port: this.config.port });
    });

    const address = server.address();
    if (address && typeof address === 'object') {
      this.endpointList = [`${address.address}:${address.port}`];
    } else {
      this.endpointList = [`${this.config.host}:${this.config.port}`];
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.events = undefined;

    for (const connection of this.active.values()) {
      connection.socket.destroy();
    }
    this.active.clear();
    this.lastId = undefined;
    this.endpointList = [];

    if (!server) return;

    await new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
  }

  async send(connectionId: string, data: Buffer): Promise<void> {
    const connection = this.active.get(connectionId);
    if (!connection) throw new Error(`连接 ${connectionId} 不存在`);
    if (connection.socket.destroyed) throw new Error(`连接 ${connectionId} 已断开`);

    await new Promise<void>((resolve, reject) => {
      connection.socket.write(data, (error?: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });

    connection.info.txBytes += data.length;
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = this.active.get(connectionId);
    if (!connection) return;

    const socket = connection.socket;
    socket.destroy();

    await new Promise<void>((resolve) => {
      if (socket.closed) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 500);
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  connections(): ConnectionInfo[] {
    return [...this.active.values()].map((connection) => ({ ...connection.info }));
  }

  endpoints(): string[] {
    return [...this.endpointList];
  }

  lastConnectionId(): string | undefined {
    return this.lastId;
  }

  private handleSocket(socket: Socket): void {
    const id = randomUUID();
    const info: ConnectionInfo = {
      id,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      connectedAt: Date.now(),
      rxBytes: 0,
      txBytes: 0,
    };

    this.active.set(id, { info, socket });
    this.lastId = id;
    socket.setNoDelay(true);

    socket.on('data', (data: Buffer) => {
      info.rxBytes += data.length;
      try {
        this.events?.onData(id, data);
      } catch (error) {
        this.events?.onError(asError(error), id);
      }
    });

    socket.on('error', (error: Error) => {
      this.events?.onError(error, id);
    });

    socket.on('close', () => {
      const removed = this.active.delete(id);
      if (this.lastId === id) {
        this.lastId = [...this.active.keys()].at(-1);
      }
      if (removed) this.events?.onDisconnect(id);
    });

    try {
      this.events?.onConnect({ ...info });
    } catch (error) {
      this.events?.onError(asError(error), id);
    }
  }
}
