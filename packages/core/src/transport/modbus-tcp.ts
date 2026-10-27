import type { ModbusTcpTransport } from '../schema/device';
import type { ConnectionInfo, TransportStatus } from '../types';
import type { TransportAdapter, TransportEvents } from './types';
import { TcpServerTransportAdapter } from './tcp-server';

export class ModbusTcpTransportAdapter implements TransportAdapter {
  readonly kind = 'modbus-tcp' as const;
  private readonly tcp: TcpServerTransportAdapter;
  private events?: TransportEvents;
  private readonly buffers = new Map<string, Buffer>();

  constructor(config: ModbusTcpTransport) {
    this.tcp = new TcpServerTransportAdapter({
      type: 'tcp-server',
      host: config.host,
      port: config.port,
    });
  }

  async start(events: TransportEvents): Promise<void> {
    this.events = events;
    await this.tcp.start({
      onConnect: (connection) => events.onConnect(connection),
      onDisconnect: (connectionId) => {
        this.buffers.delete(connectionId);
        events.onDisconnect(connectionId);
      },
      onError: (error, connectionId) => events.onError(error, connectionId),
      onStatus: (status) => events.onStatus({ ...status, kind: this.kind }),
      onData: (connectionId, chunk) => this.receive(connectionId, chunk),
    });
  }

  async stop(): Promise<void> {
    this.buffers.clear();
    await this.tcp.stop();
    this.events = undefined;
  }

  send(connectionId: string, data: Buffer): Promise<void> {
    return this.tcp.send(connectionId, data);
  }

  disconnect(connectionId: string): Promise<void> {
    this.buffers.delete(connectionId);
    return this.tcp.disconnect(connectionId);
  }

  connections(): ConnectionInfo[] {
    return this.tcp.connections();
  }

  endpoints(): string[] {
    return this.tcp.endpoints();
  }

  lastConnectionId(): string | undefined {
    return this.tcp.lastConnectionId();
  }

  status(): TransportStatus {
    return { ...this.tcp.status(), kind: this.kind };
  }

  private receive(connectionId: string, chunk: Buffer): void {
    let buffer = Buffer.concat([this.buffers.get(connectionId) ?? Buffer.alloc(0), chunk]);
    while (buffer.length >= 6) {
      const protocolId = buffer.readUInt16BE(2);
      const length = buffer.readUInt16BE(4);
      if (protocolId !== 0 || length < 2 || length > 254) {
        this.events?.onError(new Error('Modbus TCP MBAP 头无效'), connectionId);
        this.buffers.delete(connectionId);
        void this.tcp.disconnect(connectionId);
        return;
      }
      const frameLength = length + 6;
      if (buffer.length < frameLength) break;
      const frame = Buffer.from(buffer.subarray(0, frameLength));
      buffer = buffer.subarray(frameLength);
      this.events?.onData(connectionId, frame);
    }
    if (buffer.length > 260) {
      this.events?.onError(new Error('Modbus TCP 缓冲区超过最大 ADU 长度'), connectionId);
      this.buffers.delete(connectionId);
      void this.tcp.disconnect(connectionId);
      return;
    }
    if (buffer.length > 0) this.buffers.set(connectionId, Buffer.from(buffer));
    else this.buffers.delete(connectionId);
  }
}
