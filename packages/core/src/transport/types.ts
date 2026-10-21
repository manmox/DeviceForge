import type { ConnectionInfo } from '../types';

export interface TransportEvents {
  onData(connectionId: string, data: Buffer): void;
  onConnect(connection: ConnectionInfo): void;
  onDisconnect(connectionId: string): void;
  onError(error: Error, connectionId?: string): void;
}

export interface TransportAdapter {
  readonly kind: string;
  start(events: TransportEvents): Promise<void>;
  stop(): Promise<void>;
  send(connectionId: string, data: Buffer): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  connections(): ConnectionInfo[];
  endpoints(): string[];
  lastConnectionId(): string | undefined;
}
