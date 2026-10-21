import { create } from 'zustand';
import { api } from './api/client';
import type {
  ConnectionInfo,
  DeviceConfig,
  DeviceDetail,
  DeviceStatus,
  DeviceSummary,
  Preset,
  TrafficEvent,
  WsMessage,
} from './types';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface AppState {
  devices: DeviceSummary[];
  selectedId: string | null;
  device: DeviceDetail | null;
  detailLoading: boolean;
  presets: Preset[];
  traffic: TrafficEvent[];
  connections: ConnectionInfo[];
  wsConnected: boolean;
  initializing: boolean;
  toast: Toast | null;

  init: () => Promise<void>;
  selectDevice: (id: string | null) => Promise<void>;
  refreshDevices: () => Promise<void>;
  createDevice: (config: DeviceConfig) => Promise<void>;
  updateDevice: (id: string, config: DeviceConfig) => Promise<void>;
  deleteDevice: (id: string) => Promise<void>;
  startDevice: (id: string) => Promise<void>;
  stopDevice: (id: string) => Promise<void>;
  restartDevice: (id: string) => Promise<void>;
  send: (
    id: string,
    payload: { hex?: string; fields?: Record<string, unknown> },
  ) => Promise<boolean>;
  clearTraffic: (id: string) => Promise<void>;
  disconnect: (deviceId: string, connectionId: string) => Promise<void>;
  saveState: (deviceId: string, state: Record<string, unknown>) => Promise<boolean>;
  handleWsMessage: (message: WsMessage) => void;
  setWsConnected: (connected: boolean) => void;
  showToast: (message: string, kind?: ToastKind) => void;
  clearToast: (id?: number) => void;
}

let toastSequence = 0;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function upsertStatus(devices: DeviceSummary[], status: DeviceStatus): DeviceSummary[] {
  return devices.map((device) =>
    device.config.id === status.deviceId ? { ...device, status } : device,
  );
}

function withStatus(
  device: DeviceDetail | null,
  status: DeviceStatus,
): DeviceDetail | null {
  if (!device || device.config.id !== status.deviceId) return device;
  return {
    ...device,
    status,
  };
}

function mergeTraffic(current: TrafficEvent[], incoming: TrafficEvent[]): TrafficEvent[] {
  const seen = new Set(current.map((event) => event.id));
  const fresh = incoming.filter((event) => !seen.has(event.id));
  if (fresh.length === 0) return current;
  const merged = [...current, ...fresh];
  return merged.length > 2000 ? merged.slice(-2000) : merged;
}

export const useAppStore = create<AppState>((set, get) => ({
  devices: [],
  selectedId: null,
  device: null,
  detailLoading: false,
  presets: [],
  traffic: [],
  connections: [],
  wsConnected: false,
  initializing: true,
  toast: null,

  init: async () => {
    set({ initializing: true });
    try {
      const [devices, presets] = await Promise.all([api.listDevices(), api.listPresets()]);
      set({ devices, presets, initializing: false });
      const current = get().selectedId;
      const initialId = current ?? devices[0]?.config.id ?? null;
      if (initialId) await get().selectDevice(initialId);
    } catch (error) {
      set({ initializing: false });
      get().showToast(`初始化失败：${errorText(error)}`, 'error');
    }
  },

  selectDevice: async (id) => {
    if (!id) {
      set({
        selectedId: null,
        device: null,
        traffic: [],
        connections: [],
        detailLoading: false,
      });
      return;
    }

    const current = get().device;
    const sameDevice = current?.config.id === id;
    set({
      selectedId: id,
      device: sameDevice ? current : null,
      traffic: sameDevice ? get().traffic : [],
      connections: sameDevice ? get().connections : [],
      detailLoading: true,
    });

    try {
      const detail = await api.getDevice(id);
      if (get().selectedId !== id) return;

      const previous = get().traffic;
      const known = new Set(detail.traffic.map((event) => event.id));
      const merged = [
        ...detail.traffic,
        ...previous.filter((event) => event.deviceId === id && !known.has(event.id)),
      ].sort((left, right) => left.ts - right.ts);

      set({
        device: detail,
        traffic: merged.length > 2000 ? merged.slice(-2000) : merged,
        connections: detail.status.connections,
        detailLoading: false,
      });
    } catch (error) {
      if (get().selectedId !== id) return;
      set({ detailLoading: false });
      get().showToast(`加载设备失败：${errorText(error)}`, 'error');
    }
  },

  refreshDevices: async () => {
    try {
      const devices = await api.listDevices();
      const selectedId = get().selectedId;

      if (selectedId && !devices.some((device) => device.config.id === selectedId)) {
        set({
          devices,
          selectedId: null,
          device: null,
          traffic: [],
          connections: [],
        });
        return;
      }

      const current = get().device;
      const summary = current
        ? devices.find((device) => device.config.id === current.config.id)
        : undefined;

      set({
        devices,
        device: current && summary
          ? {
              ...current,
              config: summary.config,
              status: summary.status,
            }
          : current,
        connections: summary ? summary.status.connections : get().connections,
      });
    } catch (error) {
      get().showToast(`刷新设备列表失败：${errorText(error)}`, 'error');
    }
  },

  createDevice: async (config) => {
    const summary = await api.createDevice(config);
    await get().refreshDevices();
    await get().selectDevice(summary.config.id);
    get().showToast(`设备「${summary.config.name}」已创建`, 'success');
  },

  updateDevice: async (id, config) => {
    await api.updateDevice(id, config);
    await get().refreshDevices();
    await get().selectDevice(id);
    get().showToast('设备配置已保存', 'success');
  },

  deleteDevice: async (id) => {
    try {
      await api.deleteDevice(id);
      const remaining = get().devices.filter((device) => device.config.id !== id);
      if (get().selectedId === id) {
        const nextId = remaining[0]?.config.id ?? null;
        await get().selectDevice(nextId);
      }
      await get().refreshDevices();
      get().showToast('设备已删除', 'success');
    } catch (error) {
      get().showToast(`删除失败：${errorText(error)}`, 'error');
    }
  },

  startDevice: async (id) => {
    try {
      const { status } = await api.startDevice(id);
      set((state) => ({
        devices: upsertStatus(state.devices, status),
        device: withStatus(state.device, status),
        connections: state.device?.config.id === id ? status.connections : state.connections,
      }));
      get().showToast('设备已启动', 'success');
    } catch (error) {
      get().showToast(`启动失败：${errorText(error)}`, 'error');
      await get().refreshDevices();
    }
  },

  stopDevice: async (id) => {
    try {
      const { status } = await api.stopDevice(id);
      set((state) => ({
        devices: upsertStatus(state.devices, status),
        device: withStatus(state.device, status),
        connections: state.device?.config.id === id ? status.connections : state.connections,
      }));
      get().showToast('设备已停止', 'info');
    } catch (error) {
      get().showToast(`停止失败：${errorText(error)}`, 'error');
      await get().refreshDevices();
    }
  },

  restartDevice: async (id) => {
    try {
      const { status } = await api.restartDevice(id);
      set((state) => ({
        devices: upsertStatus(state.devices, status),
        device: withStatus(state.device, status),
        connections: state.device?.config.id === id ? status.connections : state.connections,
      }));
      get().showToast('设备已重启', 'success');
    } catch (error) {
      get().showToast(`重启失败：${errorText(error)}`, 'error');
      await get().refreshDevices();
    }
  },

  send: async (id, payload) => {
    try {
      await api.send(id, {
        target: 'last',
        message: payload.hex !== undefined ? { hex: payload.hex } : { fields: payload.fields ?? {} },
      });
      return true;
    } catch (error) {
      get().showToast(`发送失败：${errorText(error)}`, 'error');
      return false;
    }
  },

  clearTraffic: async (id) => {
    try {
      await api.clearTraffic(id);
      set({ traffic: [] });
    } catch (error) {
      get().showToast(`清空失败：${errorText(error)}`, 'error');
    }
  },

  disconnect: async (deviceId, connectionId) => {
    try {
      await api.disconnectConnection(deviceId, connectionId);
      get().showToast('已断开连接', 'info');
    } catch (error) {
      get().showToast(`断开失败：${errorText(error)}`, 'error');
    }
  },

  saveState: async (deviceId, state) => {
    try {
      const next = await api.setState(deviceId, state);
      set((current) =>
        current.device && current.device.config.id === deviceId
          ? { device: { ...current.device, state: next } }
          : current,
      );
      get().showToast('设备状态已更新', 'success');
      return true;
    } catch (error) {
      get().showToast(`更新状态失败：${errorText(error)}`, 'error');
      return false;
    }
  },

  handleWsMessage: (message) => {
    switch (message.type) {
      case 'snapshot': {
        const payload = message.payload as { devices?: DeviceSummary[] };
        if (!Array.isArray(payload.devices)) break;
        const devices = payload.devices;
        set((state) => {
          const selected = devices.find((device) => device.config.id === state.selectedId);
          return {
            devices,
            device:
              state.device && selected && state.device.config.id === selected.config.id
                ? {
                    ...state.device,
                    config: selected.config,
                    status: selected.status,
                  }
                : state.device,
            connections: selected ? selected.status.connections : state.connections,
          };
        });
        break;
      }

      case 'status': {
        const status = message.payload as DeviceStatus;
        if (!status || typeof status.deviceId !== 'string') break;
        set((state) => ({
          devices: upsertStatus(state.devices, status),
          device: withStatus(state.device, status),
          connections:
            state.device?.config.id === status.deviceId
              ? status.connections
              : state.connections,
        }));
        break;
      }

      case 'traffic': {
        const events = message.payload as TrafficEvent[];
        if (!Array.isArray(events)) break;
        const selectedId = get().selectedId;
        if (!selectedId) break;
        const incoming = events.filter((event) => event.deviceId === selectedId);
        if (incoming.length === 0) break;
        set((state) => ({ traffic: mergeTraffic(state.traffic, incoming) }));
        break;
      }

      case 'connections': {
        const payload = message.payload as {
          deviceId?: string;
          connections?: ConnectionInfo[];
        };
        if (!payload || payload.deviceId !== get().selectedId || !Array.isArray(payload.connections)) {
          break;
        }
        set((state) => ({
          connections: payload.connections!,
          device: state.device
            ? {
                ...state.device,
                status: { ...state.device.status, connections: payload.connections! },
              }
            : state.device,
        }));
        break;
      }

      case 'state': {
        const payload = message.payload as {
          deviceId?: string;
          state?: Record<string, unknown>;
        };
        if (!payload || payload.deviceId !== get().selectedId || !payload.state) break;
        set((state) =>
          state.device ? { device: { ...state.device, state: payload.state! } } : state,
        );
        break;
      }

      case 'error': {
        const payload = message.payload as { message?: string };
        if (payload?.message) {
          get().showToast(`设备错误：${payload.message}`, 'error');
        }
        break;
      }

      case 'devicesChanged': {
        void get().refreshDevices();
        break;
      }

      default:
        break;
    }
  },

  setWsConnected: (connected) => set({ wsConnected: connected }),

  showToast: (message, kind = 'info') => {
    const id = ++toastSequence;
    set({ toast: { id, kind, message } });
    window.setTimeout(
      () => {
        if (get().toast?.id === id) set({ toast: null });
      },
      kind === 'error' ? 6000 : 3500,
    );
  },

  clearToast: (id) => {
    if (id === undefined || get().toast?.id === id) set({ toast: null });
  },
}));
