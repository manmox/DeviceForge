import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceConfigSchema } from '@deviceforge/core';
import Fastify from 'fastify';
import { registerDictionaryRoutes } from '../routes/dictionaries';
import { DeviceStore } from '../store/device-store';
import { DictionaryStore } from '../store/dictionary-store';

const directories: string[] = [];

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'deviceforge-dictionary-routes-'));
  directories.push(dir);
  const dictionaries = new DictionaryStore(path.join(dir, 'dictionaries.json'));
  const devices = new DeviceStore(path.join(dir, 'devices.json'), dictionaries);
  const app = Fastify();
  return { app, dictionaries, devices };
}

function referencingDevice(dictionary: string) {
  return DeviceConfigSchema.parse({
    id: 'device-a',
    name: '设备 A',
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
              dictionary,
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
    },
  });
}

afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('字典 API', () => {
  it('创建、查询和更新自定义字典，并报告引用设备', async () => {
    const { app, dictionaries, devices } = setup();
    await registerDictionaryRoutes(app, dictionaries, devices);
    await app.ready();

    const definition = {
      id: 'sample-codes',
      name: '本机设备示例字典',
      entries: { '000': { name: '电压', unit: 'V' } },
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/dictionaries',
      payload: definition,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().dictionary).not.toHaveProperty('builtin');

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/dictionaries/sample-codes',
      payload: { ...definition, name: '更新后的设备示例字典' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().dictionary.name).toBe('更新后的设备示例字典');

    const mismatch = await app.inject({
      method: 'PUT',
      url: '/api/dictionaries/sample-codes',
      payload: { ...definition, id: 'another-id' },
    });
    expect(mismatch.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/dictionaries/missing',
    });
    expect(missing.statusCode).toBe(404);

    devices.create(referencingDevice('sample-codes'));
    const protectedDelete = await app.inject({
      method: 'DELETE',
      url: '/api/dictionaries/sample-codes',
    });
    expect(protectedDelete.statusCode).toBe(409);
    expect(protectedDelete.json().usedBy).toEqual([
      { id: 'device-a', name: '设备 A' },
    ]);

    await app.close();
  });

  it('允许删除未被引用的用户字典', async () => {
    const { app, dictionaries, devices } = setup();
    dictionaries.create({ id: 'unused', name: '未使用', entries: {} });
    await registerDictionaryRoutes(app, dictionaries, devices);
    await app.ready();

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/dictionaries/unused',
    });
    expect(deleted.statusCode).toBe(204);
    expect(dictionaries.has('unused')).toBe(false);

    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/dictionaries/unused',
    });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });
});
