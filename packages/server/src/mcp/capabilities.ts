import type {
  FaultInjectionConfig,
  ConnectionInfo,
  DeviceStatus,
  OutgoingMessage,
  TrafficEvent,
  ModbusOperationResult,
  ModbusReadableTable,
  ModbusWritableTable,
  ModbusWriteValues,
} from '@deviceforge/core';
import type {
  DeviceConfigurationApplication,
  DevicePreset,
  RecordingApplication,
  DeviceSummary,
  ProjectFileApplication,
} from '../application/contracts';

export type { DeviceSummary } from '../application/contracts';

export interface DeviceSnapshot {
  summary: DeviceSummary;
  state: Record<string, unknown>;
  connections: ConnectionInfo[];
}

export type ProjectFileCapabilities = ProjectFileApplication;

export interface DeviceCapabilities extends Pick<
  DeviceConfigurationApplication,
  'validateYaml' | 'createFromYaml' | 'updateFromYaml'
> {
  list(): DeviceSummary[];
  get(id: string): DeviceSnapshot | undefined;
  listPresets(): DevicePreset[];
}

export interface RuntimeCapabilities {
  start(id: string): Promise<DeviceStatus>;
  stop(id: string): Promise<DeviceStatus>;
  restart(id: string): Promise<DeviceStatus>;
  send(
    id: string,
    message: OutgoingMessage,
    options: { connectionId?: string; target: 'all' | 'last' },
  ): Promise<void>;
  disconnect(id: string, connectionId: string): Promise<void>;
}

export interface TrafficCapabilities {
  query(
    id: string,
    options: {
      limit: number;
      direction?: TrafficEvent['direction'];
      since?: number;
    },
  ): TrafficEvent[] | undefined;
}

export interface FaultInjectionSnapshot {
  faultInjection: FaultInjectionConfig;
  enabled: boolean;
}

export interface FaultInjectionCapabilities {
  get(id: string): FaultInjectionSnapshot | undefined;
  updateRules(id: string, config: FaultInjectionConfig): FaultInjectionSnapshot;
  setEnabled(id: string, enabled: boolean): Promise<DeviceStatus>;
}

export type RecordingCapabilities = RecordingApplication;

export interface ModbusCapabilities {
  read(
    id: string,
    table: ModbusReadableTable,
    address: number,
    quantity: number,
  ): Promise<ModbusOperationResult>;
  write(
    id: string,
    table: ModbusWritableTable,
    address: number,
    values: ModbusWriteValues,
    broadcast?: boolean,
  ): Promise<ModbusOperationResult>;
}

export interface McpCapabilities {
  projectFiles: ProjectFileCapabilities;
  devices: DeviceCapabilities;
  runtime: RuntimeCapabilities;
  traffic: TrafficCapabilities;
  faultInjection: FaultInjectionCapabilities;
  recordings: RecordingCapabilities;
  modbus: ModbusCapabilities;
}
