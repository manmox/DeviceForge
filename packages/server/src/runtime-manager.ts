import {
  DeviceRuntime,
  type ConnectionInfo,
  type DeviceConfig,
  type DeviceStatus,
  type DictionaryProvider,
  type FaultInjectionConfig,
  type TrafficEvent,
} from '@deviceforge/core';
import type { DeviceStore } from './store/device-store';

export interface DeviceSummary {
  config: DeviceConfig;
  status: DeviceStatus;
}

export interface RuntimeErrorEvent {
  deviceId: string;
  message: string;
  connectionId?: string;
}

export interface DeviceStateEvent {
  deviceId: string;
  state: Record<string, unknown>;
}

type Unsubscribe = () => void;

function logError(message: string, error: unknown): void {
  console.error(message, error instanceof Error ? error.message : error);
}

export class RuntimeManager {
  private readonly runtimes = new Map<string, DeviceRuntime>();
  private readonly unsubscribers = new Map<string, Unsubscribe[]>();
  private readonly trafficListeners = new Set<(event: TrafficEvent) => void>();
  private readonly statusListeners = new Set<(status: DeviceStatus) => void>();
  private readonly connectionsListeners = new Set<
    (deviceId: string, connections: ConnectionInfo[]) => void
  >();
  private readonly errorListeners = new Set<(event: RuntimeErrorEvent) => void>();
  private readonly stateListeners = new Set<(event: DeviceStateEvent) => void>();
  private readonly devicesListeners = new Set<() => void>();

  constructor(
    private readonly store: DeviceStore,
    private readonly dictionaries?: DictionaryProvider,
  ) {
    for (const config of store.list()) this.ensureRuntime(config);
  }

  find(id: string): DeviceRuntime | undefined {
    return this.runtimes.get(id);
  }

  list(): DeviceSummary[] {
    return this.store.list().map((config) => {
      const runtime = this.ensureRuntime(config);
      return { config, status: runtime.getStatus() };
    });
  }

  get(id: string): DeviceSummary | undefined {
    const config = this.store.get(id);
    if (!config) return undefined;
    const runtime = this.ensureRuntime(config);
    return { config, status: runtime.getStatus() };
  }

  hasStoredId(id: string): boolean {
    return this.store.hasStoredId(id);
  }

  hasInvalidRecord(id: string): boolean {
    return this.store.hasInvalidRecord(id);
  }

  create(config: DeviceConfig): DeviceSummary {
    this.store.create(config);
    const runtime = this.ensureRuntime(config);
    this.emitDevicesChanged();
    return { config, status: runtime.getStatus() };
  }

  update(id: string, config: DeviceConfig): DeviceSummary {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`设备 ${id} 不存在`);
    if (runtime.isActive) throw new Error('请先停止设备再修改配置');
    this.store.update(id, config);
    runtime.updateConfig(config);
    this.emitDevicesChanged();
    return { config, status: runtime.getStatus() };
  }

  updateFaultInjection(
    id: string,
    faultInjection: FaultInjectionConfig,
  ): DeviceSummary {
    const current = this.store.get(id);
    if (!current) throw new Error(`设备 ${id} 不存在`);
    const config = this.store.update(id, { ...current, faultInjection });
    const runtime = this.ensureRuntime(config);
    runtime.updateFaultInjection(config.faultInjection);
    this.emitDevicesChanged();
    return { config, status: runtime.getStatus() };
  }

  async setFaultInjectionEnabled(id: string, enabled: boolean): Promise<DeviceStatus> {
    const runtime = this.requireRuntime(id);
    if (!runtime.isActive) throw new Error('设备运行中才能切换故障注入');
    await runtime.setFaultInjectionEnabled(enabled);
    return runtime.getStatus();
  }

  async remove(id: string): Promise<boolean> {
    const runtime = this.runtimes.get(id);
    if (runtime) {
      if (runtime.isActive) await runtime.stop();
      this.detach(runtime.id);
      this.runtimes.delete(id);
    }
    const deleted = this.store.delete(id);
    if (deleted) this.emitDevicesChanged();
    return deleted;
  }

  async start(id: string): Promise<DeviceStatus> {
    const runtime = this.requireRuntime(id);
    await runtime.start();
    return runtime.getStatus();
  }

  async stop(id: string): Promise<DeviceStatus> {
    const runtime = this.requireRuntime(id);
    await runtime.stop();
    return runtime.getStatus();
  }

  async restart(id: string): Promise<DeviceStatus> {
    const runtime = this.requireRuntime(id);
    await runtime.restart();
    return runtime.getStatus();
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.runtimes.values()].map(async (runtime) => {
        if (!runtime.isActive) return;
        await runtime.stop().catch((error) => {
          logError(`[runtime] 停止 ${runtime.id} 失败`, error);
        });
      }),
    );
  }

  async autoStart(): Promise<void> {
    for (const config of this.store.list()) {
      if (!config.autoStart) continue;
      try {
        await this.start(config.id);
        console.info(`[runtime] 已自动启动设备 ${config.id}`);
      } catch (error) {
        logError(`[runtime] 自动启动设备 ${config.id} 失败`, error);
      }
    }
  }

  onTraffic(listener: (event: TrafficEvent) => void): Unsubscribe {
    this.trafficListeners.add(listener);
    return () => {
      this.trafficListeners.delete(listener);
    };
  }

  onStatus(listener: (status: DeviceStatus) => void): Unsubscribe {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onConnections(
    listener: (deviceId: string, connections: ConnectionInfo[]) => void,
  ): Unsubscribe {
    this.connectionsListeners.add(listener);
    return () => {
      this.connectionsListeners.delete(listener);
    };
  }

  onError(listener: (event: RuntimeErrorEvent) => void): Unsubscribe {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  onState(listener: (event: DeviceStateEvent) => void): Unsubscribe {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onDevicesChanged(listener: () => void): Unsubscribe {
    this.devicesListeners.add(listener);
    return () => {
      this.devicesListeners.delete(listener);
    };
  }

  private ensureRuntime(config: DeviceConfig): DeviceRuntime {
    const existing = this.runtimes.get(config.id);
    if (existing) return existing;

    const runtime = new DeviceRuntime(config, {
      trafficCapacity: 5000,
      dictionaries: this.dictionaries,
    });
    const unsubscribers = [
      runtime.on('traffic', (event) => this.emitTraffic(event)),
      runtime.on('status', (status) => this.emitStatus(status)),
      runtime.on('connections', (connections) =>
        this.emitConnections(runtime.id, connections),
      ),
      runtime.on('state', (event) => this.emitState(event)),
      runtime.on('error', (event) => this.emitError(event)),
    ];

    this.unsubscribers.set(config.id, unsubscribers);
    this.runtimes.set(config.id, runtime);
    return runtime;
  }

  private detach(id: string): void {
    const unsubscribers = this.unsubscribers.get(id);
    if (unsubscribers) {
      for (const unsubscribe of unsubscribers) unsubscribe();
    }
    this.unsubscribers.delete(id);
  }

  private requireRuntime(id: string): DeviceRuntime {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`设备 ${id} 不存在`);
    return runtime;
  }

  private emitTraffic(event: TrafficEvent): void {
    for (const listener of this.trafficListeners) listener(event);
  }

  private emitStatus(status: DeviceStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }

  private emitConnections(deviceId: string, connections: ConnectionInfo[]): void {
    for (const listener of this.connectionsListeners) listener(deviceId, connections);
  }

  private emitError(event: RuntimeErrorEvent): void {
    for (const listener of this.errorListeners) listener(event);
  }

  private emitState(event: DeviceStateEvent): void {
    for (const listener of this.stateListeners) listener(event);
  }

  private emitDevicesChanged(): void {
    for (const listener of this.devicesListeners) listener();
  }
}
