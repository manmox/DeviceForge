import type { TransportConfig } from '../schema/device';
import type { MqttQos } from '../schema/device';
import type {
  ConnectionInfo,
  HttpRequestMetadata,
  TransportMessageMetadata,
  TransportStatus,
} from '../types';

export interface TransportSendOptions {
  topic?: string;
  qos?: MqttQos;
  http?: {
    requestId: string;
    statusCode?: number;
    headers?: Record<string, string>;
    request?: HttpRequestMetadata;
  };
  websocket?: { isBinary?: boolean; metadata?: import('../types').WebSocketMessageMetadata };
}

export interface TransportEvents {
  onData(
    connectionId: string,
    data: Buffer,
    metadata?: TransportMessageMetadata,
  ): void;
  onConnect(connection: ConnectionInfo): void;
  onDisconnect(connectionId: string): void;
  onError(error: Error, connectionId?: string): void;
  onStatus(status: TransportStatus): void;
}

export interface TransportAdapter {
  readonly kind: TransportConfig['type'];
  start(events: TransportEvents): Promise<void>;
  stop(): Promise<void>;
  send(
    connectionId: string,
    data: Buffer,
    options?: TransportSendOptions,
  ): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  connections(): ConnectionInfo[];
  endpoints(): string[];
  lastConnectionId(): string | undefined;
  status(): TransportStatus;
  finishRequest?(
    connectionId: string,
    metadata: HttpRequestMetadata,
    statusCode?: number,
  ): Promise<void>;
}
