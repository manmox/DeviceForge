import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { HttpServerTransport } from '../schema/device';
import type { ConnectionInfo, HttpRequestMetadata, TransportStatus } from '../types';
import type { TransportAdapter, TransportEvents, TransportSendOptions } from './types';

interface PendingRequest {
  connectionId: string;
  response: ServerResponse;
}

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

function queryRecord(url: URL): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const previous = output[key];
    if (previous === undefined) output[key] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else output[key] = [previous, value];
  }
  return output;
}

export class HttpServerTransportAdapter implements TransportAdapter {
  readonly kind = 'http-server' as const;
  private server?: Server;
  private events?: TransportEvents;
  private currentStatus: TransportStatus = { kind: this.kind, state: 'idle' };
  private boundEndpoint?: string;
  private readonly connectionsMap = new Map<string, { info: ConnectionInfo; socket: Socket }>();
  private readonly socketIds = new WeakMap<Socket, string>();
  private readonly requests = new Map<string, PendingRequest>();
  private lastId?: string;

  constructor(private readonly config: HttpServerTransport) {}

  async start(events: TransportEvents): Promise<void> {
    if (this.server) return;
    this.events = events;
    this.currentStatus = { kind: this.kind, state: 'connecting' };
    events.onStatus(this.currentStatus);
    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server = server;
    server.on('connection', (socket) => this.handleConnect(socket));
    server.on('error', (error) => {
      this.currentStatus = { kind: this.kind, state: 'error', error: error.message };
      this.events?.onStatus(this.currentStatus);
      this.events?.onError(error);
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('无法读取 HTTP Server 监听端点'));
          return;
        }
        this.boundEndpoint = `http://${hostPort(address.address, address.port)}`;
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
    const server = this.server;
    this.server = undefined;
    for (const [requestId, pending] of this.requests) {
      this.requests.delete(requestId);
      if (!pending.response.destroyed && !pending.response.writableEnded) {
        if (!pending.response.headersSent) pending.response.writeHead(503);
        pending.response.end();
      }
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
    for (const id of [...this.connectionsMap.keys()]) {
      if (!this.connectionsMap.delete(id)) continue;
      this.events?.onDisconnect(id);
    }
    this.lastId = undefined;
    this.boundEndpoint = undefined;
    this.currentStatus = { kind: this.kind, state: 'idle' };
    this.events?.onStatus(this.currentStatus);
    this.events = undefined;
  }

  async send(
    connectionId: string,
    data: Buffer,
    options: TransportSendOptions = {},
  ): Promise<void> {
    const pending = options.http ? this.requests.get(options.http.requestId) : undefined;
    if (!pending || pending.connectionId !== connectionId) throw new Error('HTTP 请求已结束或不存在');
    this.requests.delete(options.http!.requestId);
    const response = pending.response;
    if (response.writableEnded || response.destroyed) throw new Error('HTTP 响应连接已关闭');
    for (const [name, value] of Object.entries(options.http?.headers ?? {})) {
      response.setHeader(name, value);
    }
    response.statusCode = options.http?.statusCode ?? 200;
    const connection = this.connectionsMap.get(connectionId)?.info;
    await new Promise<void>((resolve, reject) => {
      response.once('error', reject);
      response.end(data, () => {
        if (connection) connection.txBytes += data.length;
        resolve();
      });
    });
  }

  async finishRequest(connectionId: string, metadata: HttpRequestMetadata, statusCode = 404): Promise<void> {
    const pending = this.requests.get(metadata.requestId);
    if (!pending || pending.connectionId !== connectionId) return;
    this.requests.delete(metadata.requestId);
    if (pending.response.writableEnded || pending.response.destroyed) return;
    if (statusCode === 0) {
      pending.response.destroy();
      return;
    }
    const body = Buffer.from(statusCode === 404 ? 'No matching device rule' : 'Invalid request');
    pending.response.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
    pending.response.end(body, () => {
      const connection = this.connectionsMap.get(connectionId)?.info;
      if (connection) connection.txBytes += body.length;
    });
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = this.connectionsMap.get(connectionId);
    if (!connection) return;
    connection.socket.destroy();
  }

  connections(): ConnectionInfo[] {
    return [...this.connectionsMap.values()].map(({ info }) => ({ ...info }));
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

  private handleConnect(socket: Socket): void {
    const address = socket.remoteAddress ?? 'unknown';
    const id = `http:${address}:${socket.remotePort ?? 0}:${randomUUID()}`;
    const info: ConnectionInfo = {
      id,
      remoteAddress: address,
      remotePort: socket.remotePort,
      connectedAt: Date.now(),
      rxBytes: 0,
      txBytes: 0,
    };
    this.socketIds.set(socket, id);
    this.connectionsMap.set(id, { info, socket });
    this.lastId = id;
    this.events?.onConnect(info);
    socket.on('close', () => {
      if (!this.connectionsMap.delete(id)) return;
      for (const [requestId, pending] of this.requests) {
        if (pending.connectionId === id) this.requests.delete(requestId);
      }
      if (this.lastId === id) this.lastId = [...this.connectionsMap.keys()].at(-1);
      this.events?.onDisconnect(id);
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const connectionId = this.socketIds.get(request.socket);
    if (!connectionId) {
      response.writeHead(503);
      response.end();
      return;
    }
    const connection = this.connectionsMap.get(connectionId);

    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    try {
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        bodyBytes += buffer.length;
        if (connection) connection.info.rxBytes += buffer.length;
        if (bodyBytes > this.config.maxBodyBytes) {
          const body = Buffer.from('Request body too large');
          response.writeHead(413, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
          response.end(body, () => {
            if (connection) connection.info.txBytes += body.length;
          });
          request.resume();
          return;
        }
        chunks.push(buffer);
      }
    } catch (error) {
      this.events?.onError(error instanceof Error ? error : new Error(String(error)), connectionId);
      if (!response.headersSent) response.writeHead(400);
      response.end();
      return;
    }

    const body = Buffer.concat(chunks);
    const requestId = randomUUID();
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const metadata: HttpRequestMetadata = {
      requestId,
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      path: url.pathname,
      query: queryRecord(url),
      headers: headersRecord(request.headers),
      body: body.toString('utf8'),
      bodyBase64: body.toString('base64'),
    };
    this.requests.set(requestId, { connectionId, response });
    this.lastId = connectionId;
    this.events?.onData(connectionId, body, { http: metadata });
  }
}
