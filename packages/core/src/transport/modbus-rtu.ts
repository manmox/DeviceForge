import type { ModbusRtuTransport, SerialTransport, VirtualSerialTransport } from '../schema/device';
import type { ConnectionInfo, TransportStatus } from '../types';
import type { TransportAdapter, TransportEvents } from './types';
import { SerialTransportAdapter } from './serial';

function expectedRequestLength(buffer: Buffer): number | undefined {
  if (buffer.length < 2) return undefined;
  switch (buffer[1]) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return 8;
    case 15:
    case 16:
      return buffer.length >= 7 ? 9 + buffer[6]! : undefined;
    default:
      return undefined;
  }
}

export class ModbusRtuTransportAdapter implements TransportAdapter {
  readonly kind = 'modbus-rtu' as const;
  private readonly serial: SerialTransportAdapter;
  private events?: TransportEvents;
  private readonly buffers = new Map<string, Buffer>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lineConfig: SerialTransport | VirtualSerialTransport;

  constructor(config: ModbusRtuTransport) {
    this.lineConfig = config.serial;
    this.serial = new SerialTransportAdapter(config.serial);
  }

  async start(events: TransportEvents): Promise<void> {
    this.events = events;
    await this.serial.start({
      onConnect: (connection) => events.onConnect(connection),
      onDisconnect: (connectionId) => {
        this.clearConnection(connectionId);
        events.onDisconnect(connectionId);
      },
      onError: (error, connectionId) => events.onError(error, connectionId),
      onStatus: (status) => events.onStatus({ ...status, kind: this.kind }),
      onData: (connectionId, chunk) => this.receive(connectionId, chunk),
    });
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.buffers.clear();
    await this.serial.stop();
    this.events = undefined;
  }

  send(connectionId: string, data: Buffer): Promise<void> {
    return this.serial.send(connectionId, data);
  }

  disconnect(connectionId: string): Promise<void> {
    this.clearConnection(connectionId);
    return this.serial.disconnect(connectionId);
  }

  connections(): ConnectionInfo[] {
    return this.serial.connections();
  }

  endpoints(): string[] {
    return this.serial.endpoints();
  }

  lastConnectionId(): string | undefined {
    return this.serial.lastConnectionId();
  }

  status(): TransportStatus {
    return { ...this.serial.status(), kind: this.kind };
  }

  private receive(connectionId: string, chunk: Buffer): void {
    const timer = this.timers.get(connectionId);
    if (timer) clearTimeout(timer);
    let buffer = Buffer.concat([this.buffers.get(connectionId) ?? Buffer.alloc(0), chunk]);

    while (true) {
      const expected = expectedRequestLength(buffer);
      if (expected === undefined || buffer.length < expected) break;
      const frame = Buffer.from(buffer.subarray(0, expected));
      buffer = buffer.subarray(expected);
      this.events?.onData(connectionId, frame);
    }

    if (buffer.length > 256) {
      this.events?.onError(new Error('Modbus RTU 缓冲区超过最大 ADU 长度'), connectionId);
      this.buffers.delete(connectionId);
      return;
    }
    if (buffer.length === 0) {
      this.buffers.delete(connectionId);
      this.timers.delete(connectionId);
      return;
    }

    this.buffers.set(connectionId, Buffer.from(buffer));
    this.timers.set(connectionId, setTimeout(() => {
      this.timers.delete(connectionId);
      const pending = this.buffers.get(connectionId);
      if (!pending?.length) return;
      this.buffers.delete(connectionId);
      this.events?.onData(connectionId, Buffer.from(pending));
    }, this.interFrameDelayMs()));
  }

  private interFrameDelayMs(): number {
    const serial = this.lineConfig;
    if (serial.baudRate > 19_200) return 2;
    const parityBit = serial.parity === 'none' ? 0 : 1;
    const characterBits = 1 + serial.dataBits + parityBit + serial.stopBits;
    return Math.max(2, Math.ceil((3.5 * characterBits * 1_000) / serial.baudRate));
  }

  private clearConnection(connectionId: string): void {
    const timer = this.timers.get(connectionId);
    if (timer) clearTimeout(timer);
    this.timers.delete(connectionId);
    this.buffers.delete(connectionId);
  }
}
