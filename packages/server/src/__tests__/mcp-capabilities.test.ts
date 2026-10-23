import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceConfigApplicationService } from '../application/device-config-service';
import { PresetApplicationService } from '../application/preset-service';
import { ProjectFileApplicationService } from '../application/project-file-service';
import { createMcpCapabilities, type RuntimeDevicePort, type RuntimeManagerPort } from '../mcp/create-capabilities';
import { DeviceStore } from '../store/device-store';
import { DictionaryStore } from '../store/dictionary-store';
import { RuntimeManager } from '../runtime-manager';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('MCP 能力适配器', () => {
  it('按方向和起始时间筛选 TCP 与 MQTT 收发记录', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'deviceforge-mcp-capabilities-'));
    directories.push(directory);
    const dictionaries = new DictionaryStore(path.join(directory, 'dictionaries.json'));
    const store = new DeviceStore(path.join(directory, 'devices.json'), dictionaries);
    const manager = new RuntimeManager(store, dictionaries.provider());
    const tcpInbound = { id: '1', deviceId: 'sim-a', ts: 100, direction: 'in' as const, data: 'AA', size: 1 };
    const mqttInbound = {
      id: '2', deviceId: 'sim-a', ts: 200, direction: 'in' as const, data: 'BB', size: 1,
      mqtt: { topic: 'sensors/a', qos: 1 as const, retain: false },
    };
    const outbound = { id: '3', deviceId: 'sim-a', ts: 300, direction: 'out' as const, data: 'CC', size: 1 };
    const runtime = {
      getState: () => ({}),
      getConnections: () => [],
      getTraffic: () => [tcpInbound, mqttInbound, outbound],
      send: async () => undefined,
      disconnectConnection: async () => undefined,
    } satisfies RuntimeDevicePort;
    const runtimeManager = {
      list: () => [],
      get: () => undefined,
      find: (id) => id === 'sim-a' ? runtime : undefined,
      start: async () => ({} as never),
      stop: async () => ({} as never),
      restart: async () => ({} as never),
    } satisfies RuntimeManagerPort;
    const capabilities = createMcpCapabilities({
      projectFiles: new ProjectFileApplicationService(directory),
      deviceConfigs: new DeviceConfigApplicationService(manager, dictionaries),
      presets: new PresetApplicationService(path.join(directory, 'presets'), dictionaries),
      runtimeManager,
    });

    expect(capabilities.traffic.query('sim-a', { limit: 10, direction: 'in', since: 150 }))
      .toEqual([mqttInbound]);
    expect(capabilities.traffic.query('sim-a', { limit: 1, direction: 'in' }))
      .toEqual([mqttInbound]);
    expect(capabilities.traffic.query('missing', { limit: 10 })).toBeUndefined();
  });
});
