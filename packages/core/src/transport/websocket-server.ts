import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { WebSocketServerTransport } from '../schema/device';
import type { ConnectionInfo, TransportStatus } from '../types';
import type { TransportAdapter, TransportEvents, TransportSendOptions } from './types';

function hostPort(host: string, port: number): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`;
}

function headersRecord(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    output[key.toLowerCase()] = Array.isArray(value) ? value.map(String) : String(value);
  }
  return output;
}

interface WebSocketConnection {
  info: ConnectionInfo;
  socket: WebSocket;
  isBinary: boolean;
}

export class WebSocketServerTransportAdapter implements TransportAdapter {
  readonly kind = 'websocket-server' as const;
  private server?: Server;
  private wsServer?: WebSocketServer;
  private events?: TransportEvents;
  private currentStatus: TransportStatus = { kind: this.kind, state: 'idle' };
  private boundEndpoint?: string;
  private readonly peers = new Map<string, WebSocketConnection>();
  private lastId?: string;

  constructor(private readonly config: WebSocketServerTransport) {}

  async start(events: TransportEvents): Promise<void> {
    if (this.server) return;
    this.events = events;
    this.currentStatus = { kind: this.kind, state: 'connecting' };
    events.onStatus(this.currentStatus);
    const server = createServer((_request, response) => {
      response.writeHead(426, { connection: 'Upgrade', upgrade: 'websocket' });
      response.end('WebSocket upgrade required');
    });
    const wsServer = new WebSocketServer({
      server,
      path: this.config.path,
      maxPayload: this.config.maxMessageBytes,
      perMessageDeflate: false,
    });
    this.server = server;
    this.wsServer = wsServer;
    server.on('error', (error) => {
      this.currentStatus = { kind: this.kind, state: 'error', error: error.message };
      this.events?.onStatus(this.currentStatus);
      this.events?.onError(error);
    });
    wsServer.on('connection', (socket, request) => {
      this.handleConnection(socket, request.url ?? this.config.path, headersRecord(request.headers), request.socket.remoteAddress, request.socket.remotePort);
    });
    wsServer.on('error', (error) => this.events?.onError(error));
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('无法读取 WebSocket Server 监听端点'));
          return;
        }
        this.boundEndpoint = `ws://${hostPort(address.address, address.port)}${this.config.path}`;
        this.currentStatus = { kind: this.kind, state: 'listening' };
        events.onStatus(this.currentStatus);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.config.port, this.config.host);
    });
  }

  async stop(): Promise<void> {
    const wsServer = this.wsServer;
    const server = this.server;
    this.wsServer = undefined;
    this.server = undefined;
    for (const peer of this.peers.values()) peer.socket.terminate();
    if (wsServer) {
      await new Promise<void>((resolve) => {
        try {
          wsServer.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
    for (const id of [...this.peers.keys()]) {
      if (!this.peers.delete(id)) continue;
      this.events?.onDisconnect(id);
    }
    this.lastId = undefined;
    this.boundEndpoint = undefined;
    this.currentStatus = { kind: this.kind, state: 'idle' };
    this.events?.onStatus(this.currentStatus);
    this.events = undefined;
  }

  async send(connectionId: string, data: Buffer, options: TransportSendOptions = {}): Promise<void> {
    const peer = this.peers.get(connectionId);
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket 客户端已断开');
    const isBinary = options.websocket?.isBinary ?? peer.isBinary;
    await new Promise<void>((resolve, reject) => {
      peer.socket.send(data, { binary: isBinary }, (error) => error ? reject(error) : resolve());
    });
    peer.info.txBytes += data.length;
  }

  async disconnect(connectionId: string): Promise<void> {
    const peer = this.peers.get(connectionId);
    if (!peer) return;
    peer.socket.close(1000, 'DeviceForge disconnect');
  }

  connections(): ConnectionInfo[] {
    return [...this.peers.values()].map(({ info }) => ({ ...info }));
  }

  endpoints(): string[] {
    return this.boundEndpoint ? [this.boundEndpoint] : [];
  }

  lastConnectionId(): string | undefined {
    return this.lastId;
  }

  status(): TransportStatus {
    return this.currentStatus;
  }

  private handleConnection(
    socket: WebSocket,
    path: string,
    headers: Record<string, string | string[]>,
    remoteAddress?: string,
    remotePort?: number,
  ): void {
    const id = `ws:${randomUUID()}`;
    const info: ConnectionInfo = {
      id,
      remoteAddress,
      remotePort,
      connectedAt: Date.now(),
      rxBytes: 0,
      txBytes: 0,
    };
    const peer: WebSocketConnection = { info, socket, isBinary: false };
    this.peers.set(id, peer);
    this.lastId = id;
    this.events?.onConnect(info);
    socket.on('message', (data, isBinary) => {
      const buffer = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data.toString());
      peer.info.rxBytes += buffer.length;
      peer.isBinary = isBinary;
      this.events?.onData(id, buffer, {
        websocket: { path, isBinary, headers },
      });
    });
    socket.on('error', (error) => this.events?.onError(error, id));
    socket.on('close', () => {
      if (!this.peers.delete(id)) return;
      if (this.lastId === id) this.lastId = [...this.peers.keys()].at(-1);
      this.events?.onDisconnect(id);
    });
  }
}
