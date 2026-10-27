import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceConfigApplicationService } from '../application/device-config-service';
import { PresetApplicationService } from '../application/preset-service';
import { registerConfigRoutes } from '../routes/config';
import { registerDeviceRoutes } from '../routes/devices';
import { RuntimeManager } from '../runtime-manager';
import { DeviceStore } from '../store/device-store';
import { DictionaryStore } from '../store/dictionary-store';
import { RecordingStore } from '../store/recording-store';

const directories: string[] = [];

const socatAvailable = (() => {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return false;
  try {
    execFileSync('socat', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'deviceforge-device-routes-'));
  directories.push(directory);
  const dictionaries = new DictionaryStore(path.join(directory, 'dictionaries.json'));
  const recordings = new RecordingStore(path.join(directory, 'recordings'));
  const manager = new RuntimeManager(
    new DeviceStore(path.join(directory, 'devices.json'), dictionaries),
    dictionaries.provider(),
  );
  const configs = new DeviceConfigApplicationService(manager, dictionaries);
  const app = Fastify();
  return { app, configs, dictionaries, manager, recordings, presets: new PresetApplicationService(
    path.join(directory, 'presets'), dictionaries,
  ) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('REST 设备配置路由', () => {
  it('与 MCP 共用设备配置服务的校验、字典迁移和重复 ID 规则', async () => {
    const { app, configs, dictionaries, manager, presets, recordings } = setup();
    await registerConfigRoutes(app, configs, presets);
    await registerDeviceRoutes(app, manager, configs, recordings);
    await app.ready();

    const config = {
      id: 'sim-a',
      name: '模拟设备 A',
      transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
      codec: {
        type: 'text',
        messages: [
          {
            name: 'report',
            slots: [
              { kind: 'field', name: 'count', type: 'int' },
              {
                kind: 'repeat',
                name: 'groups',
                countField: 'count',
                dictionary: 'sampleCodes',
                keyField: 'id',
                valueField: 'values',
                fields: [
                  { kind: 'field', name: 'id', type: 'string' },
                  { kind: 'field', name: 'values', type: 'stringList' },
                ],
              },
            ],
          },
        ],
        dictionaries: { sampleCodes: { '101': { name: '示例值' } } },
      },
    };

    const created = await app.inject({ method: 'POST', url: '/api/devices', payload: config });
    expect(created.statusCode).toBe(201);
    expect(dictionaries.has('sampleCodes')).toBe(true);
    expect(manager.get('sim-a')?.config.codec).toMatchObject({
      type: 'text',
      messages: [{ slots: [{}, { dictionary: 'sampleCodes' }] }],
    });

    const duplicate = await app.inject({ method: 'POST', url: '/api/devices', payload: config });
    expect(duplicate.statusCode).toBe(409);

    const invalidYaml = await app.inject({
      method: 'POST',
      url: '/api/config/validate',
      payload: { yaml: 'id: [' },
    });
    expect(invalidYaml.statusCode).toBe(422);

    await app.close();
  });

  it('保存并读取 M2 传输配置，并经现有路由启动和停止网络服务', async () => {
    const { app, configs, manager, presets, recordings } = setup();
    await registerConfigRoutes(app, configs, presets);
    await registerDeviceRoutes(app, manager, configs, recordings);
    await app.ready();

    const transports = [
      { type: 'udp-server', host: '127.0.0.1', port: 0 },
      { type: 'udp-client', host: '127.0.0.1', port: 9, localPort: 0 },
      { type: 'http-server', host: '127.0.0.1', port: 0 },
      { type: 'websocket-server', host: '127.0.0.1', port: 0, path: '/ws' },
    ];

    try {
      for (const [index, transport] of transports.entries()) {
        const id = `m2-api-${index}`;
        const created = await app.inject({
          method: 'POST',
          url: '/api/devices',
          payload: { id, name: id, transport },
        });
        expect(created.statusCode).toBe(201);
        expect(manager.get(id)?.config.transport.type).toBe(transport.type);

        const read = await app.inject({ method: 'GET', url: `/api/devices/${id}` });
        expect(read.statusCode).toBe(200);
        expect(read.json().config.transport.type).toBe(transport.type);

        const started = await app.inject({ method: 'POST', url: `/api/devices/${id}/start` });
        expect(started.statusCode).toBe(200);
        expect(manager.get(id)?.status.state).toBe('running');

        const stopped = await app.inject({ method: 'POST', url: `/api/devices/${id}/stop` });
        expect(stopped.statusCode).toBe(200);
        expect(manager.get(id)?.status.state).toBe('stopped');
      }
    } finally {
      await app.close();
      await manager.stopAll();
    }
  });

  it('保存并读取物理串口配置，不主动打开用户串口', async () => {
    const { app, configs, manager, presets, recordings } = setup();
    await registerConfigRoutes(app, configs, presets);
    await registerDeviceRoutes(app, manager, configs, recordings);
    await app.ready();

    const config = {
      id: 'm2-serial-api',
      name: 'M2 physical serial config',
      transport: {
        type: 'serial',
        portPath: '/dev/deviceforge-not-opened-by-test',
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      },
    };

    try {
      const created = await app.inject({ method: 'POST', url: '/api/devices', payload: config });
      expect(created.statusCode).toBe(201);
      const read = await app.inject({ method: 'GET', url: `/api/devices/${config.id}` });
      expect(read.statusCode).toBe(200);
      expect(read.json().config.transport).toMatchObject(config.transport);
    } finally {
      await app.close();
      await manager.stopAll();
    }
  });

  it.skipIf(!socatAvailable)('通过现有设备 API 启动和停止虚拟串口', async () => {
    const { app, configs, manager, presets, recordings } = setup();
    await registerConfigRoutes(app, configs, presets);
    await registerDeviceRoutes(app, manager, configs, recordings);
    await app.ready();

    const config = {
      id: 'm2-virtual-serial-api',
      name: 'M2 virtual serial API',
      transport: {
        type: 'virtual-serial',
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      },
    };

    try {
      const created = await app.inject({ method: 'POST', url: '/api/devices', payload: config });
      expect(created.statusCode).toBe(201);
      const read = await app.inject({ method: 'GET', url: `/api/devices/${config.id}` });
      expect(read.statusCode).toBe(200);
      expect(read.json().config.transport.type).toBe('virtual-serial');

      const started = await app.inject({ method: 'POST', url: `/api/devices/${config.id}/start` });
      expect(started.statusCode).toBe(200);
      expect(manager.get(config.id)?.status.endpoints).toHaveLength(2);

      const stopped = await app.inject({ method: 'POST', url: `/api/devices/${config.id}/stop` });
      expect(stopped.statusCode).toBe(200);
      expect(manager.get(config.id)?.status.endpoints).toEqual([]);
    } finally {
      await app.close();
      await manager.stopAll();
    }
  });
});
