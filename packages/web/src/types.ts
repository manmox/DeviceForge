import type {
  ConnectionInfo,
  DeviceConfig,
  DeviceStatus,
  GlobalDictionaryDefinition,
  TextDictionaryEntry,
  TrafficEvent,
  TransportStatus,
} from '@deviceforge/core';

export type {
  ConnectionInfo,
  DeviceConfig,
  DeviceStatus,
  GlobalDictionaryDefinition,
  TextDictionaryEntry,
  TrafficEvent,
  TransportStatus,
};

export interface DictionarySummary {
  id: string;
  name: string;
  description?: string;
  entries: Record<string, TextDictionaryEntry>;
  builtin: boolean;
  usedBy: { id: string; name: string }[];
}

export type DictionaryRegistry = ReadonlyMap<
  string,
  GlobalDictionaryDefinition
>;

export type DictionaryInput = Omit<
  DictionarySummary,
  'builtin' | 'usedBy'
>;

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
