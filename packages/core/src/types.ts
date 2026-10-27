import { z } from 'zod';
import { MqttQosSchema } from './schema/device';
import type { TransportConfig } from './schema/device';

export const MqttMessageMetadataSchema = z.object({
  topic: z.string(),
  qos: MqttQosSchema,
  retain: z.boolean(),
  clientId: z.string().optional(),
});

export type MqttMessageMetadata = z.infer<typeof MqttMessageMetadataSchema>;

const HttpValueSchema = z.union([z.string(), z.array(z.string())]);

export const HttpRequestMetadataSchema = z.object({
  requestId: z.string(),
  method: z.string(),
  url: z.string(),
  path: z.string(),
  query: z.record(z.string(), HttpValueSchema),
  headers: z.record(z.string(), HttpValueSchema),
  body: z.string().optional(),
  bodyBase64: z.string().optional(),
});

export type HttpRequestMetadata = z.infer<typeof HttpRequestMetadataSchema>;
export const HttpTrafficMetadataSchema = HttpRequestMetadataSchema.omit({ requestId: true });
export type HttpTrafficMetadata = z.infer<typeof HttpTrafficMetadataSchema>;
export const HttpResponseTrafficMetadataSchema = z.object({
  statusCode: z.number().int(),
  headers: z.record(z.string(), HttpValueSchema),
});
export type HttpResponseTrafficMetadata = z.infer<typeof HttpResponseTrafficMetadataSchema>;

export const WebSocketMessageMetadataSchema = z.object({
  path: z.string(),
  isBinary: z.boolean(),
  headers: z.record(z.string(), HttpValueSchema),
});

export type WebSocketMessageMetadata = z.infer<typeof WebSocketMessageMetadataSchema>;

export const ModbusTrafficMetadataSchema = z.object({
  mode: z.enum(['tcp', 'rtu']),
  unitId: z.number().int().min(0).max(255),
  functionCode: z.number().int().min(0).max(255),
  table: z.enum(['coils', 'discreteInputs', 'holdingRegisters', 'inputRegisters']).optional(),
  address: z.number().int().min(0).max(65_535).optional(),
  quantity: z.number().int().min(0).max(65_535).optional(),
  exceptionCode: z.number().int().min(1).max(255).optional(),
  broadcast: z.boolean().optional(),
});

export type ModbusTrafficMetadata = z.infer<typeof ModbusTrafficMetadataSchema>;

export interface TransportMessageMetadata {
  mqtt?: MqttMessageMetadata;
  http?: HttpRequestMetadata;
  websocket?: WebSocketMessageMetadata;
  modbus?: ModbusTrafficMetadata;
}

export const ConnectionInfoSchema = z.object({
  id: z.string(),
  remoteAddress: z.string().optional(),
  remotePort: z.number().int().optional(),
  connectedAt: z.number(),
  rxBytes: z.number().int(),
  txBytes: z.number().int(),
  clientId: z.string().optional(),
});

export type ConnectionInfo = z.infer<typeof ConnectionInfoSchema>;

export const CountersSchema = z.object({
  rxBytes: z.number().int(),
  txBytes: z.number().int(),
  rxFrames: z.number().int(),
  txFrames: z.number().int(),
});

export type Counters = z.infer<typeof CountersSchema>;

export const TrafficEventSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  connectionId: z.string().optional(),
  ts: z.number(),
  direction: z.enum(['in', 'out', 'system']),
  data: z.string(),
  size: z.number().int(),
  decoded: z.record(z.string(), z.unknown()).optional(),
  rule: z.string().optional(),
  note: z.string().optional(),
  error: z.string().optional(),
  mqtt: MqttMessageMetadataSchema.optional(),
  http: HttpTrafficMetadataSchema.optional(),
  httpResponse: HttpResponseTrafficMetadataSchema.optional(),
  websocket: WebSocketMessageMetadataSchema.optional(),
  modbus: ModbusTrafficMetadataSchema.optional(),
});

export type TrafficEvent = z.infer<typeof TrafficEventSchema>;

export type DeviceRuntimeState = 'stopped' | 'starting' | 'running' | 'error';

export type TransportState =
  | 'idle'
  | 'listening'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface TransportStatus {
  kind: TransportConfig['type'];
  state: TransportState;
  error?: string;
  attempt?: number;
  nextRetryAt?: number;
}

export interface DeviceStatus {
  deviceId: string;
  state: DeviceRuntimeState;
  error?: string;
  faultInjectionEnabled: boolean;
  transport: TransportStatus;
  endpoints: string[];
  connections: ConnectionInfo[];
  startedAt?: number;
  counters: Counters;
}

export type RecordingState = 'recording' | 'stopped' | 'interrupted' | 'error';

export interface RecordingSession {
  id: string;
  deviceId: string;
  startedAt: number;
  endedAt?: number;
  state: RecordingState;
  eventCount: number;
  error?: string;
}

export interface RecordedTrafficEvent {
  offsetMs: number;
  event: TrafficEvent;
}
