import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { DeviceConfigApplicationService } from '../application/device-config-service';
import { PresetApplicationService } from '../application/preset-service';
import { registerConfigRoutes } from '../routes/config';
import { RuntimeManager } from '../runtime-manager';
import { DeviceStore } from '../store/device-store';
import { DictionaryStore } from '../store/dictionary-store';

const directories: string[] = [];

function legacyTextDevice() {
  return {
    id: 'legacy-device',
    name: '旧配置设备',
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
      dictionaries: {
        sampleCodes: { '101': { name: '示例值' } },
      },
    },
  };
}

afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('配置校验 API', () => {
  it('对旧内联字典返回 422，且不落盘迁移', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'deviceforge-config-routes-'));
    directories.push(dir);
    const dictionaries = new DictionaryStore(path.join(dir, 'dictionaries.json'));
    const manager = new RuntimeManager(
      new DeviceStore(path.join(dir, 'devices.json'), dictionaries),
      dictionaries.provider(),
    );
    const configs = new DeviceConfigApplicationService(manager, dictionaries);
    const presets = new PresetApplicationService(path.join(dir, 'presets'), dictionaries);
    const app = Fastify();
    await registerConfigRoutes(app, configs, presets);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/config/validate',
      payload: { config: legacyTextDevice() },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().issues).toEqual([
      expect.objectContaining({ path: 'codec.dictionaries' }),
    ]);
    expect(dictionaries.list()).toEqual([]);

    await app.close();
  });

  it('对缺失的全局字典返回 422', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'deviceforge-config-routes-'));
    directories.push(dir);
    const dictionaries = new DictionaryStore(path.join(dir, 'dictionaries.json'));
    const manager = new RuntimeManager(
      new DeviceStore(path.join(dir, 'devices.json'), dictionaries),
      dictionaries.provider(),
    );
    const configs = new DeviceConfigApplicationService(manager, dictionaries);
    const presets = new PresetApplicationService(path.join(dir, 'presets'), dictionaries);
    const config = legacyTextDevice();
    delete (config.codec as { dictionaries?: unknown }).dictionaries;
    const app = Fastify();
    await registerConfigRoutes(app, configs, presets);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/config/validate',
      payload: { config },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().issues).toEqual([
      expect.objectContaining({
        path: 'codec.messages.0.slots.1.dictionary',
        message: '字典 sampleCodes 不存在',
      }),
    ]);

    await app.close();
  });
});
