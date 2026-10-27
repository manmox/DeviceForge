import { isIP } from 'node:net';
import { createSocket, type RemoteInfo, type Socket, type SocketType } from 'node:dgram';
import type { UdpClientTransport, UdpServerTransport } from '../schema/device';
import type { ConnectionInfo, TransportStatus } from '../types';
import type { TransportAdapter, TransportEvents } from './types';

function socketType(host: string): SocketType {
  return isIP(host) === 6 ? 'udp6' : 'udp4';
}

function endpoint(host: string, port: number): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`;
}

function peerId(info: Pick<RemoteInfo, 'address' | 'port'>): string {
  return endpoint(info.address, info.port);
}

function connection(id: string, address: string, port: number): ConnectionInfo {
  return {
    id,
    remoteAddress: address,
    remotePort: port,
    connectedAt: Date.now(),
    rxBytes: 0,
    txBytes: 0,
  };
}

export class UdpServerTransportAdapter implements TransportAdapter {
  readonly kind = 'udp-server' as const;
  private socket?: Socket;
  private events?: TransportEvents;
  private readonly peers = new Map<string, ConnectionInfo>();
  private lastId?: string;
  private currentStatus: TransportStatus = { kind: this.kind, state: 'idle' };
  private boundEndpoint?: string;

  constructor(private readonly config: UdpServerTransport) {}

  async start(events: TransportEvents): Promise<void> {
    if (this.socket) return;
    this.events = events;
    this.currentStatus = { kind: this.kind, state: 'connecting' };
    events.onStatus(this.currentStatus);
    const socket = createSocket(socketType(this.config.host));
    this.socket = socket;
    socket.on('message', (data, remote) => this.handleMessage(data, remote));
    socket.on('error', (error) => {
      this.currentStatus = { kind: this.kind, state: 'error', error: error.message };
      this.events?.onStatus(this.currentStatus);
      this.events?.onError(error);
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        socket.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        socket.off('error', onError);
        const address = socket.address();
        this.boundEndpoint = endpoint(address.address, address.port);
        this.currentStatus = { kind: this.kind, state: 'listening' };
        events.onStatus(this.currentStatus);
        resolve();
      };
      socket.once('error', onError);
      socket.once('listening', onListening);
      socket.bind(this.config.port, this.config.host);
    });
  }

  async stop(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      await new Promise<void>((resolve) => {
        try {
          socket.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
    for (const id of this.peers.keys()) this.events?.onDisconnect(id);
    this.peers.clear();
    this.lastId = undefined;
    this.boundEndpoint = undefined;
    this.currentStatus = { kind: this.kind, state: 'idle' };
    this.events?.onStatus(this.currentStatus);
    this.events = undefined;
  }

  async send(connectionId: string, data: Buffer): Promise<void> {
    const peer = this.peers.get(connectionId);
    const socket = this.socket;
    if (!peer || !socket) throw new Error('UDP 来源端点已失效');
    await new Promise<void>((resolve, reject) => {
      socket.send(data, peer.remotePort!, peer.remoteAddress!, (error) => {
        if (error) reject(error);
        else {
          peer.txBytes += data.length;
          resolve();
        }
      });
    });
  }

  async disconnect(connectionId: string): Promise<void> {
    if (!this.peers.delete(connectionId)) return;
    if (this.lastId === connectionId) this.lastId = [...this.peers.keys()].at(-1);
    this.events?.onDisconnect(connectionId);
  }

  connections(): ConnectionInfo[] {
    return [...this.peers.values()].map((item) => ({ ...item }));
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

  private handleMessage(data: Buffer, remote: RemoteInfo): void {
    const id = peerId(remote);
    let peer = this.peers.get(id);
    if (!peer) {
      peer = connection(id, remote.address, remote.port);
      this.peers.set(id, peer);
      this.events?.onConnect(peer);
    }
    peer.rxBytes += data.length;
    this.lastId = id;
    this.events?.onData(id, Buffer.from(data));
  }
}

export class UdpClientTransportAdapter implements TransportAdapter {
  readonly kind = 'udp-client' as const;
  private socket?: Socket;
  private events?: TransportEvents;
  private currentStatus: TransportStatus = { kind: this.kind, state: 'idle' };
  private peer?: ConnectionInfo;
  private boundEndpoint?: string;

  constructor(private readonly config: UdpClientTransport) {}

  async start(events: TransportEvents): Promise<void> {
    if (this.socket) return;
    this.events = events;
    this.currentStatus = { kind: this.kind, state: 'connecting' };
    events.onStatus(this.currentStatus);
    const socket = createSocket(socketType(this.config.host));
    this.socket = socket;
    const id = endpoint(this.config.host, this.config.port);
    socket.on('message', (data) => {
      if (!this.peer) return;
      this.peer.rxBytes += data.length;
      events.onData(id, Buffer.from(data));
    });
    socket.on('error', (error) => {
      this.currentStatus = { kind: this.kind, state: 'error', error: error.message };
      events.onStatus(this.currentStatus);
      events.onError(error, id);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        socket.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        socket.off('error', onError);
        const address = socket.address();
        this.boundEndpoint = endpoint(address.address, address.port);
        socket.connect(this.config.port, this.config.host, () => {
          const remote = socket.remoteAddress();
          this.peer = connection(
            id,
            remote?.address ?? this.config.host,
            remote?.port ?? this.config.port,
          );
          this.currentStatus = { kind: this.kind, state: 'connected' };
          events.onStatus(this.currentStatus);
          events.onConnect(this.peer);
          resolve();
        });
      };
      socket.once('error', onError);
      socket.once('listening', onListening);
      if (this.config.localHost) socket.bind(this.config.localPort, this.config.localHost);
      else socket.bind(this.config.localPort);
    });
  }

  async stop(): Promise<void> {
    await this.closeSocket();
    this.currentStatus = { kind: this.kind, state: 'idle' };
    this.events?.onStatus(this.currentStatus);
    this.events = undefined;
    this.peer = undefined;
    this.boundEndpoint = undefined;
  }

  async send(connectionId: string, data: Buffer): Promise<void> {
    const socket = this.socket;
    if (!socket || !this.peer || connectionId !== this.peer.id) {
      throw new Error('UDP 目标端点不可用');
    }
    await new Promise<void>((resolve, reject) => {
      socket.send(data, (error) => {
        if (error) reject(error);
        else {
          this.peer!.txBytes += data.length;
          resolve();
        }
      });
    });
  }

  async disconnect(connectionId: string): Promise<void> {
    if (!this.peer || connectionId !== this.peer.id) return;
    await this.closeSocket();
    this.peer = undefined;
    this.currentStatus = { kind: this.kind, state: 'disconnected' };
    this.events?.onStatus(this.currentStatus);
    this.events?.onDisconnect(connectionId);
  }

  connections(): ConnectionInfo[] {
    return this.peer ? [{ ...this.peer }] : [];
  }

  endpoints(): string[] {
    return this.boundEndpoint ? [this.boundEndpoint] : [];
  }

  lastConnectionId(): string | undefined {
    return this.peer?.id;
  }

  status(): TransportStatus {
    return this.currentStatus;
  }

  private async closeSocket(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    await new Promise<void>((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}
