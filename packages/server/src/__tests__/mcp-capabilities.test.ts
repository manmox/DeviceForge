import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceConfigSchema, FaultInjectionConfigSchema } from '@deviceforge/core';
import { DeviceConfigApplicationService } from '../application/device-config-service';
import { PresetApplicationService } from '../application/preset-service';
import { ProjectFileApplicationService } from '../application/project-file-service';
import { createMcpCapabilities, type RuntimeDevicePort, type RuntimeManagerPort } from '../mcp/create-capabilities';
import { DeviceStore } from '../store/device-store';
import { DictionaryStore } from '../store/dictionary-store';
import { RecordingStore } from '../store/recording-store';
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
    const recordings = new RecordingStore(path.join(directory, 'recordings'));
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
      updateFaultInjection: () => { throw new Error('not used'); },
      setFaultInjectionEnabled: async () => ({} as never),
    } satisfies RuntimeManagerPort;
    const capabilities = createMcpCapabilities({
      projectFiles: new ProjectFileApplicationService(directory),
      deviceConfigs: new DeviceConfigApplicationService(manager, dictionaries),
      presets: new PresetApplicationService(path.join(directory, 'presets'), dictionaries),
      recordings,
      runtimeManager,
    });

    expect(capabilities.traffic.query('sim-a', { limit: 10, direction: 'in', since: 150 }))
      .toEqual([mqttInbound]);
    expect(capabilities.traffic.query('sim-a', { limit: 1, direction: 'in' }))
      .toEqual([mqttInbound]);
    expect(capabilities.traffic.query('missing', { limit: 10 })).toBeUndefined();
    expect(capabilities.recordings.list('sim-a')).toEqual([]);
    expect(() => capabilities.recordings.start('sim-a')).toThrow('设备 sim-a 不存在');
  });

  it('将故障规则和录制能力适配到运行时及本机录制存储', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'deviceforge-mcp-recordings-'));
    directories.push(directory);
    const dictionaries = new DictionaryStore(path.join(directory, 'dictionaries.json'));
    const store = new DeviceStore(path.join(directory, 'devices.json'), dictionaries);
    const manager = new RuntimeManager(store, dictionaries.provider());
    const recordings = new RecordingStore(path.join(directory, 'recordings'));
    const config = DeviceConfigSchema.parse({
      id: 'sim-a',
      name: '模拟设备 A',
      transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
    });
    manager.create(config);
    const capabilities = createMcpCapabilities({
      projectFiles: new ProjectFileApplicationService(directory),
      deviceConfigs: new DeviceConfigApplicationService(manager, dictionaries),
      presets: new PresetApplicationService(path.join(directory, 'presets'), dictionaries),
      recordings,
      runtimeManager: manager,
    });

    const rules = FaultInjectionConfigSchema.parse({ segmentSizeBytes: 128, rules: [] });
    expect(capabilities.faultInjection.updateRules('sim-a', rules).faultInjection.segmentSizeBytes)
      .toBe(128);
    expect(capabilities.faultInjection.get('sim-a')?.faultInjection.segmentSizeBytes).toBe(128);
    await expect(capabilities.faultInjection.setEnabled('sim-a', true))
      .rejects.toThrow('设备运行中才能切换故障注入');

    const session = capabilities.recordings.start('sim-a');
    recordings.append({
      id: 'event-1',
      deviceId: 'sim-a',
      ts: 100,
      direction: 'in',
      data: 'AA',
      size: 1,
    });
    const page = await capabilities.recordings.readEvents('sim-a', session.id, 0, 10);
    expect(page).toMatchObject({ total: 1, events: [{ event: { id: 'event-1' } }] });
    expect(() => capabilities.recordings.delete('sim-a', session.id))
      .toThrow('仅允许删除已停止的录制会话');
    expect(capabilities.recordings.stop('sim-a', session.id)?.state).toBe('stopped');
    expect(capabilities.recordings.delete('sim-a', session.id)).toBe(true);
  });

  it('不允许 MCP 删除中断的录制会话', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'deviceforge-mcp-interrupted-'));
    directories.push(directory);
    const dictionaries = new DictionaryStore(path.join(directory, 'dictionaries.json'));
    const store = new DeviceStore(path.join(directory, 'devices.json'), dictionaries);
    const manager = new RuntimeManager(store, dictionaries.provider());
    manager.create(DeviceConfigSchema.parse({
      id: 'sim-a',
      name: '模拟设备 A',
      transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
    }));

    const recordingRoot = path.join(directory, 'recordings');
    const activeStore = new RecordingStore(recordingRoot);
    const session = activeStore.start('sim-a');
    const recoveredStore = new RecordingStore(recordingRoot);
    await recoveredStore.initialize();
    expect(recoveredStore.list('sim-a')[0]?.state).toBe('interrupted');

    const capabilities = createMcpCapabilities({
      projectFiles: new ProjectFileApplicationService(directory),
      deviceConfigs: new DeviceConfigApplicationService(manager, dictionaries),
      presets: new PresetApplicationService(path.join(directory, 'presets'), dictionaries),
      recordings: recoveredStore,
      runtimeManager: manager,
    });
    expect(() => capabilities.recordings.delete('sim-a', session.id))
      .toThrow('仅允许删除已停止的录制会话');
  });
});
