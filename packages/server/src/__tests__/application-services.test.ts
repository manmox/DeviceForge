import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { DeviceConfigApplicationService } from '../application/device-config-service';
import { PresetApplicationService } from '../application/preset-service';
import { DeviceStore } from '../store/device-store';
import { DictionaryStore } from '../store/dictionary-store';
import { RuntimeManager } from '../runtime-manager';

const directories: string[] = [];

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'deviceforge-application-'));
  directories.push(directory);
  const dictionaries = new DictionaryStore(path.join(directory, 'dictionaries.json'));
  const store = new DeviceStore(path.join(directory, 'devices.json'), dictionaries);
  const manager = new RuntimeManager(store, dictionaries.provider());
  const service = new DeviceConfigApplicationService(manager, dictionaries);
  return { directory, dictionaries, manager, service };
}

function deviceConfig(id = 'sim-a', extras: Record<string, unknown> = {}) {
  return {
    id,
    name: '模拟设备 A',
    transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
    ...extras,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('DeviceConfigApplicationService', () => {
  it('解析 YAML、迁移内联字典并持久化配置', () => {
    const { directory, dictionaries, manager, service } = setup();
    const config = deviceConfig('sim-a', {
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
          sampleCodes: { '101': { name: '示例值', unit: 'V' } },
        },
      },
    });

    const result = service.createFromYaml(YAML.stringify(config));

    expect(result.ok).toBe(true);
    expect(dictionaries.has('sampleCodes')).toBe(true);
    expect(manager.get('sim-a')?.config.codec).toMatchObject({
      type: 'text',
      messages: [{ slots: [{}, { dictionary: 'sampleCodes' }] }],
    });
    const saved = JSON.parse(readFileSync(path.join(directory, 'devices.json'), 'utf8'));
    expect(saved.devices[0].id).toBe('sim-a');
  });

  it('拒绝无效 YAML 和重复设备 ID', () => {
    const { service } = setup();
    const malformed = service.createFromYaml('id: [');
    expect(malformed).toMatchObject({ ok: false, statusCode: 422 });

    expect(service.create(deviceConfig()).ok).toBe(true);
    expect(service.create(deviceConfig())).toMatchObject({ ok: false, statusCode: 409 });
  });

  it('拒绝更新运行中的设备', () => {
    const { dictionaries, manager } = setup();
    const service = new DeviceConfigApplicationService({
      get: (id) => manager.get(id),
      hasStoredId: (id) => manager.hasStoredId(id),
      hasInvalidRecord: (id) => manager.hasInvalidRecord(id),
      find: () => ({ isActive: true }),
      create: (config) => manager.create(config),
      update: (id, config) => manager.update(id, config),
    }, dictionaries);
    expect(service.create(deviceConfig()).ok).toBe(true);
    const result = service.update('sim-a', deviceConfig('sim-a', { description: 'changed' }));
    expect(result).toMatchObject({ ok: false, statusCode: 409 });
  });
});

describe('PresetApplicationService', () => {
  it('校验预设并保持内置预设优先顺序', () => {
    const { directory, dictionaries } = setup();
    const presetsDir = path.join(directory, 'presets');
    mkdirSync(presetsDir);
    for (const id of ['custom', 'tcp-echo', 'line-protocol', 'vendor-sensor']) {
      writeFileSync(path.join(presetsDir, `${id}.yaml`), YAML.stringify({
        id,
        name: id,
        transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
      }));
    }

    const presets = new PresetApplicationService(presetsDir, dictionaries);

    expect(presets.list().map((preset) => preset.id)).toEqual([
      'vendor-sensor', 'line-protocol', 'tcp-echo', 'custom',
    ]);
  });
});
