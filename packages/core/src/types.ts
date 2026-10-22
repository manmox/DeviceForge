import { z } from 'zod';
import type { TransportConfig } from './schema/device';

export const ConnectionInfoSchema = z.object({
  id: z.string(),
  remoteAddress: z.string().optional(),
  remotePort: z.number().int().optional(),
  connectedAt: z.number(),
  rxBytes: z.number().int(),
  txBytes: z.number().int(),
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
  transport: TransportStatus;
  endpoints: string[];
  connections: ConnectionInfo[];
  startedAt?: number;
  counters: Counters;
}
