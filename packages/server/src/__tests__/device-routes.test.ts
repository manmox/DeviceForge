import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceConfigSchema } from '@deviceforge/core';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { DeviceConfigApplicationService } from '../application/device-config-service';
import { registerDeviceRoutes } from '../routes/devices';
import { RuntimeManager } from '../runtime-manager';
import { DeviceStore } from '../store/device-store';
import { DictionaryStore } from '../store/dictionary-store';
import { RecordingStore } from '../store/recording-store';

const directories: string[] = [];

function deviceDocument(
  id: string,
  options: { dictionary?: string; inline?: boolean; name?: string } = {},
) {
  return {
    id,
    name: options.name ?? `设备 ${id}`,
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
              ...(options.dictionary ? { dictionary: options.dictionary } : {}),
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
      ...(options.inline
        ? { dictionaries: { sampleCodes: { '101': { name: '示例值' } } } }
        : {}),
    },
  };
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'deviceforge-device-routes-'));
  directories.push(dir);
  const dictionaries = new DictionaryStore(path.join(dir, 'dictionaries.json'));
  const devices = new DeviceStore(path.join(dir, 'devices.json'), dictionaries);
  const recordings = new RecordingStore(path.join(dir, 'recordings'));
  const manager = new RuntimeManager(devices, dictionaries.provider());
  const app = Fastify();
  return { app, dictionaries, devices, manager, recordings, dir };
}

async function register(
  app: FastifyInstance,
  manager: RuntimeManager,
  dictionaries: DictionaryStore,
  recordings: RecordingStore,
) {
  const configs = new DeviceConfigApplicationService(manager, dictionaries);
  await registerDeviceRoutes(app, manager, configs, recordings);
  await app.ready();
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('设备 API 与字典迁移', () => {
  it('POST 和 PUT 先迁移内联字典，再保存设备引用', async () => {
    const { app, dictionaries, devices, manager, recordings } = setup();
    await register(app, manager, dictionaries, recordings);

    const created = await app.inject({
      method: 'POST',
      url: '/api/devices',
      payload: deviceDocument('device-a', { dictionary: 'sampleCodes', inline: true }),
    });
    expect(created.statusCode).toBe(201);
    expect(dictionaries.get('sampleCodes')?.entries['101']?.name).toBe('示例值');
    const createdConfig = devices.get('device-a');
    expect(createdConfig?.codec.type).toBe('text');
    if (createdConfig?.codec.type === 'text') {
      expect(createdConfig.codec.messages[0]?.slots[1]).toMatchObject({
        kind: 'repeat',
        dictionary: 'sampleCodes',
      });
      expect(createdConfig.codec).not.toHaveProperty('dictionaries');
    }

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/devices/device-a',
      payload: deviceDocument('device-a', {
        dictionary: 'sampleCodes',
        inline: true,
        name: '更新后的设备',
      }),
    });
    expect(updated.statusCode).toBe(200);
    expect(manager.get('device-a')?.config.name).toBe('更新后的设备');
    expect(dictionaries.list()).toHaveLength(1);

    await app.close();
  });

  it('缺失全局字典时拒绝创建设备', async () => {
    const { app, dictionaries, manager, recordings } = setup();
    await register(app, manager, dictionaries, recordings);

    const response = await app.inject({
      method: 'POST',
      url: '/api/devices',
      payload: deviceDocument('device-a', { dictionary: 'missing' }),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().issues).toEqual([
      expect.objectContaining({
        path: 'codec.messages.0.slots.1.dictionary',
        message: '字典 missing 不存在',
      }),
    ]);
    expect(manager.get('device-a')).toBeUndefined();

    await app.close();
  });

  it('POST 的字典持久化失败时回滚设备', async () => {
    const { app, dictionaries, devices, manager, recordings } = setup();
    vi.spyOn(dictionaries, 'importDefinitions').mockImplementation(() => {
      throw new Error('模拟字典写入失败');
    });
    await register(app, manager, dictionaries, recordings);

    const response = await app.inject({
      method: 'POST',
      url: '/api/devices',
      payload: deviceDocument('device-a', { dictionary: 'sampleCodes', inline: true }),
    });
    expect(response.statusCode).toBe(500);
    expect(manager.get('device-a')).toBeUndefined();
    expect(devices.get('device-a')).toBeUndefined();

    await app.close();
  });

  it('PUT 的字典持久化失败时恢复原设备配置', async () => {
    const { app, dictionaries, manager, recordings } = setup();
    manager.create(DeviceConfigSchema.parse(deviceDocument('device-a')));
    vi.spyOn(dictionaries, 'importDefinitions').mockImplementation(() => {
      throw new Error('模拟字典写入失败');
    });
    await register(app, manager, dictionaries, recordings);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/devices/device-a',
      payload: deviceDocument('device-a', {
        dictionary: 'sampleCodes',
        inline: true,
        name: '新名称',
      }),
    });
    expect(response.statusCode).toBe(500);
    expect(manager.get('device-a')?.config.name).toBe('设备 device-a');
    expect(dictionaries.has('sampleCodes')).toBe(false);

    await app.close();
  });
});

describe('故障注入与录制 API', () => {
  it('保存规则并在运行时启停时返回状态', async () => {
    const { app, dictionaries, manager, recordings } = setup();
    manager.create(DeviceConfigSchema.parse({
      id: 'fault-device',
      name: '故障测试设备',
      transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
    }));
    const current = manager.get('fault-device')!;
    vi.spyOn(manager, 'setFaultInjectionEnabled').mockResolvedValue({
      ...current.status,
      faultInjectionEnabled: true,
    });
    await register(app, manager, dictionaries, recordings);

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/devices/fault-device/fault-injection/rules',
      payload: {
        segmentSizeBytes: 128,
        rules: [{
          id: 'drop-2',
          name: '丢弃第二段',
          enabled: true,
          direction: 'in',
          trigger: { type: 'sequence', mode: 'indices', indices: [2] },
          action: { type: 'drop' },
        }],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(manager.get('fault-device')?.config.faultInjection).toMatchObject({
      segmentSizeBytes: 128,
      rules: [{ id: 'drop-2', action: { type: 'drop' } }],
    });

    const enabled = await app.inject({
      method: 'PATCH',
      url: '/api/devices/fault-device/fault-injection',
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toEqual({ enabled: true });
    await app.close();
  });

  it('提供录制开始、读取、停止和删除接口', async () => {
    const { app, dictionaries, manager, recordings } = setup();
    manager.create(DeviceConfigSchema.parse({
      id: 'record-device',
      name: '录制测试设备',
      transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
    }));
    await register(app, manager, dictionaries, recordings);

    const started = await app.inject({
      method: 'POST',
      url: '/api/devices/record-device/recordings',
    });
    expect(started.statusCode).toBe(201);
    const { recording } = started.json<{ recording: { id: string } }>();
    recordings.append({
      id: 'recorded-event',
      deviceId: 'record-device',
      ts: Date.now(),
      direction: 'system',
      data: '',
      size: 0,
      note: '测试事件',
    });

    const events = await app.inject({
      method: 'GET',
      url: `/api/devices/record-device/recordings/${recording.id}/events?offset=0&limit=10`,
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().events[0].event.note).toBe('测试事件');

    const stopped = await app.inject({
      method: 'POST',
      url: `/api/devices/record-device/recordings/${recording.id}/stop`,
    });
    expect(stopped.json().recording.state).toBe('stopped');

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/devices/record-device/recordings/${recording.id}`,
    });
    expect(deleted.statusCode).toBe(204);
    await app.close();
  });

  it('停止录制的会话文件写入失败时返回错误并结束活动会话', async () => {
    const { app, dictionaries, manager, recordings, dir } = setup();
    manager.create(DeviceConfigSchema.parse({
      id: 'record-error-device',
      name: '录制错误测试设备',
      transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
    }));
    await register(app, manager, dictionaries, recordings);

    const started = await app.inject({
      method: 'POST',
      url: '/api/devices/record-error-device/recordings',
    });
    const { recording } = started.json<{ recording: { id: string } }>();
    rmSync(path.join(dir, 'recordings', 'record-error-device', recording.id), {
      recursive: true,
      force: true,
    });

    const stopped = await app.inject({
      method: 'POST',
      url: `/api/devices/record-error-device/recordings/${recording.id}/stop`,
    });
    expect(stopped.statusCode).toBe(500);
    expect(stopped.json().error).toContain('停止录制失败');
    expect(recordings.list('record-error-device')).toMatchObject([
      { id: recording.id, state: 'error' },
    ]);
    await app.close();
  });
});
