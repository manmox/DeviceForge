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

const directories: string[] = [];

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'deviceforge-device-routes-'));
  directories.push(directory);
  const dictionaries = new DictionaryStore(path.join(directory, 'dictionaries.json'));
  const manager = new RuntimeManager(
    new DeviceStore(path.join(directory, 'devices.json'), dictionaries),
    dictionaries.provider(),
  );
  const configs = new DeviceConfigApplicationService(manager, dictionaries);
  const app = Fastify();
  return { app, configs, dictionaries, manager, presets: new PresetApplicationService(
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
    const { app, configs, dictionaries, manager, presets } = setup();
    await registerConfigRoutes(app, configs, presets);
    await registerDeviceRoutes(app, manager, configs);
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
});
