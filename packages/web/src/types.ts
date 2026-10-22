import type {
  ConnectionInfo,
  DeviceConfig,
  DeviceStatus,
  TrafficEvent,
  TransportStatus,
} from '@deviceforge/core';

export type {
  ConnectionInfo,
  DeviceConfig,
  DeviceStatus,
  TrafficEvent,
  TransportStatus,
};

export interface DeviceSummary {
  config: DeviceConfig;
  status: DeviceStatus;
}

export interface DeviceDetail extends DeviceSummary {
  state: Record<string, unknown>;
  traffic: TrafficEvent[];
}

export interface Preset {
  file: string;
  id: string;
  name: string;
  description: string;
  yaml: string;
  config: DeviceConfig;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface WsMessage {
  type: string;
  payload: unknown;
}
