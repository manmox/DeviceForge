import type {
  ConnectionInfo,
  DeviceStatus,
  OutgoingMessage,
  TrafficEvent,
} from '@deviceforge/core';
import type {
  DeviceConfigurationApplication,
  DevicePreset,
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

export interface McpCapabilities {
  projectFiles: ProjectFileCapabilities;
  devices: DeviceCapabilities;
  runtime: RuntimeCapabilities;
  traffic: TrafficCapabilities;
}
