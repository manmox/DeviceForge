import type { McpCapabilities, DeviceSummary } from './capabilities';
import type {
  DeviceConfigurationApplication,
  PresetApplication,
  ProjectFileApplication,
} from '../application/contracts';
import type {
  ConnectionInfo,
  DeviceStatus,
  OutgoingMessage,
  TrafficEvent,
} from '@deviceforge/core';

export interface RuntimeDevicePort {
  getState(): Record<string, unknown>;
  getConnections(): ConnectionInfo[];
  getTraffic(limit: number): TrafficEvent[];
  send(
    message: OutgoingMessage,
    options: { connectionId?: string; target: 'all' | 'last' },
  ): Promise<void>;
  disconnectConnection(connectionId: string): Promise<void>;
}

export interface RuntimeManagerPort {
  list(): DeviceSummary[];
  get(id: string): DeviceSummary | undefined;
  find(id: string): RuntimeDevicePort | undefined;
  start(id: string): Promise<DeviceStatus>;
  stop(id: string): Promise<DeviceStatus>;
  restart(id: string): Promise<DeviceStatus>;
}

export function createMcpCapabilities(options: {
  projectFiles: ProjectFileApplication;
  deviceConfigs: DeviceConfigurationApplication;
  presets: PresetApplication;
  runtimeManager: RuntimeManagerPort;
}): McpCapabilities {
  const { projectFiles, deviceConfigs, presets, runtimeManager } = options;

  return {
    projectFiles,
    devices: {
      list: () => runtimeManager.list(),
      get: (id) => {
        const summary = runtimeManager.get(id);
        if (!summary) return undefined;
        const runtime = runtimeManager.find(id);
        return {
          summary,
          state: runtime?.getState() ?? summary.config.state,
          connections: runtime?.getConnections() ?? [],
        };
      },
      listPresets: () => presets.list(),
      validateYaml: (yaml) => deviceConfigs.validateYaml(yaml),
      createFromYaml: (yaml) => deviceConfigs.createFromYaml(yaml),
      updateFromYaml: (id, yaml) => deviceConfigs.updateFromYaml(id, yaml),
    },
    runtime: {
      start: (id) => runtimeManager.start(id),
      stop: (id) => runtimeManager.stop(id),
      restart: (id) => runtimeManager.restart(id),
      send: async (id, message, sendOptions) => {
        const runtime = runtimeManager.find(id);
        if (!runtime) throw new Error(`设备 ${id} 不存在`);
        await runtime.send(message, sendOptions);
      },
      disconnect: async (id, connectionId) => {
        const runtime = runtimeManager.find(id);
        if (!runtime) throw new Error(`设备 ${id} 不存在`);
        await runtime.disconnectConnection(connectionId);
      },
    },
    traffic: {
      query: (id, query) => {
        const runtime = runtimeManager.find(id);
        if (!runtime) return undefined;
        const events = runtime.getTraffic(5000).filter((event) => {
          if (query.direction && event.direction !== query.direction) return false;
          if (query.since !== undefined && event.ts < query.since) return false;
          return true;
        });
        return events.slice(-query.limit);
      },
    },
  };
}
