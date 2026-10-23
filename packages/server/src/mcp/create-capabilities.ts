import type { McpCapabilities, DeviceSummary } from './capabilities';
import type {
  DeviceConfigurationApplication,
  PresetApplication,
  ProjectFileApplication,
} from '../application/contracts';
import type {
  ConnectionInfo,
  DeviceStatus,
  FaultInjectionConfig,
  OutgoingMessage,
  TrafficEvent,
} from '@deviceforge/core';
import type { RecordingApplication } from '../application/contracts';

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
  updateFaultInjection(id: string, config: FaultInjectionConfig): DeviceSummary;
  setFaultInjectionEnabled(id: string, enabled: boolean): Promise<DeviceStatus>;
}

export function createMcpCapabilities(options: {
  projectFiles: ProjectFileApplication;
  deviceConfigs: DeviceConfigurationApplication;
  presets: PresetApplication;
  recordings: RecordingApplication;
  runtimeManager: RuntimeManagerPort;
}): McpCapabilities {
  const { projectFiles, deviceConfigs, presets, recordings, runtimeManager } = options;

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
    faultInjection: {
      get: (id) => {
        const summary = runtimeManager.get(id);
        if (!summary) return undefined;
        return {
          faultInjection: summary.config.faultInjection,
          enabled: summary.status.faultInjectionEnabled,
        };
      },
      updateRules: (id, config) => {
        const summary = runtimeManager.updateFaultInjection(id, config);
        return {
          faultInjection: summary.config.faultInjection,
          enabled: summary.status.faultInjectionEnabled,
        };
      },
      setEnabled: (id, enabled) =>
        runtimeManager.setFaultInjectionEnabled(id, enabled),
    },
    recordings: {
      list: (deviceId) => recordings.list(deviceId),
      start: (deviceId) => {
        if (!runtimeManager.get(deviceId)) throw new Error(`设备 ${deviceId} 不存在`);
        return recordings.start(deviceId);
      },
      stop: (deviceId, recordingId) => recordings.stop(deviceId, recordingId),
      readEvents: (deviceId, recordingId, offset, limit) =>
        recordings.readEvents(deviceId, recordingId, offset, limit),
      delete: (deviceId, recordingId) => {
        const session = recordings.list(deviceId).find((item) => item.id === recordingId);
        if (!session) return false;
        if (session.state !== 'stopped') {
          throw new Error('仅允许删除已停止的录制会话');
        }
        return recordings.delete(deviceId, recordingId);
      },
    },
  };
}
