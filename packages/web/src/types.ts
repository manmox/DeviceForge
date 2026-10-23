import type {
  ConnectionInfo,
  DeviceConfig,
  DeviceStatus,
  FaultAction,
  FaultInjectionConfig,
  FaultRule,
  GlobalDictionaryDefinition,
  RecordedTrafficEvent,
  RecordingSession,
  TextDictionaryEntry,
  TrafficEvent,
  TransportStatus,
} from '@deviceforge/core';

export type {
  ConnectionInfo,
  DeviceConfig,
  DeviceStatus,
  FaultAction,
  FaultInjectionConfig,
  FaultRule,
  GlobalDictionaryDefinition,
  RecordedTrafficEvent,
  RecordingSession,
  TextDictionaryEntry,
  TrafficEvent,
  TransportStatus,
};

export interface DictionarySummary {
  id: GlobalDictionaryDefinition['id'];
  name: GlobalDictionaryDefinition['name'];
  description?: GlobalDictionaryDefinition['description'];
  entries: Record<string, TextDictionaryEntry>;
  usedBy: { id: string; name: string }[];
}

export type DictionaryRegistry = ReadonlyMap<
  string,
  GlobalDictionaryDefinition
>;

export type DictionaryInput = GlobalDictionaryDefinition;

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
