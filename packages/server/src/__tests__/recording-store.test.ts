import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrafficEvent } from '@deviceforge/core';
import { RecordingStore } from '../store/recording-store';

const directories: string[] = [];

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'deviceforge-recordings-'));
  directories.push(root);
  return { root, store: new RecordingStore(path.join(root, 'recordings')) };
}

function event(id: string): TrafficEvent {
  return {
    id,
    deviceId: 'sensor-1',
    ts: Date.now(),
    direction: 'in',
    data: '0102',
    size: 2,
    decoded: { value: 2 },
    mqtt: { topic: 'sensor/up', qos: 1, retain: false, clientId: 'client-a' },
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('RecordingStore', () => {
  it('保存事件、按页读取，并在停止后保留会话', async () => {
    const { store } = setup();
    const session = store.start('sensor-1');
    store.append(event('event-1'));
    store.append(event('event-2'));

    const page = await store.readEvents('sensor-1', session.id, 1, 1);
    expect(page).toMatchObject({ total: 2 });
    expect(page?.events[0]?.event).toMatchObject({
      id: 'event-2',
      decoded: { value: 2 },
      mqtt: { topic: 'sensor/up', clientId: 'client-a' },
    });
    expect(page?.events[0]?.offsetMs).toBeGreaterThanOrEqual(0);

    expect(store.stop('sensor-1', session.id)).toMatchObject({
      id: session.id,
      state: 'stopped',
      eventCount: 2,
    });
    expect(store.list('sensor-1')).toHaveLength(1);
  });

  it('启动时将遗留录制标记为中断并保留已写事件', async () => {
    const { root, store } = setup();
    const session = store.start('sensor-1');
    store.append(event('event-1'));

    const recovered = new RecordingStore(path.join(root, 'recordings'));
    await recovered.initialize();
    expect(recovered.list('sensor-1')).toMatchObject([
      { id: session.id, state: 'interrupted', eventCount: 1 },
    ]);
    const page = await recovered.readEvents('sensor-1', session.id, 0, 10);
    expect(page?.events.map((item) => item.event.id)).toEqual(['event-1']);
  });

  it('恢复时忽略异常退出留下的未完整尾行', async () => {
    const { root, store } = setup();
    const session = store.start('sensor-1');
    store.append(event('event-1'));
    appendFileSync(
      path.join(root, 'recordings', 'sensor-1', session.id, 'events.jsonl'),
      '{"offsetMs":',
      'utf8',
    );

    const recovered = new RecordingStore(path.join(root, 'recordings'));
    await recovered.initialize();
    expect(recovered.list('sensor-1')).toMatchObject([
      { id: session.id, state: 'interrupted', eventCount: 1 },
    ]);
    await expect(recovered.readEvents('sensor-1', session.id, 0, 10)).resolves.toMatchObject({
      total: 1,
      events: [{ event: { id: 'event-1' } }],
    });
  });

  it('写入失败后停止该会话并保留错误状态', () => {
    const { root, store } = setup();
    const session = store.start('sensor-1');
    rmSync(path.join(root, 'recordings', 'sensor-1', session.id), {
      recursive: true,
      force: true,
    });
    store.append(event('event-1'));
    expect(store.list('sensor-1')).toMatchObject([
      { id: session.id, state: 'error' },
    ]);
  });

  it('停止时会话文件写入失败也会释放设备并报告错误状态', () => {
    const { root, store } = setup();
    const session = store.start('sensor-1');
    rmSync(path.join(root, 'recordings', 'sensor-1', session.id), {
      recursive: true,
      force: true,
    });

    expect(() => store.stop('sensor-1', session.id)).toThrow();
    expect(store.list('sensor-1')).toMatchObject([
      { id: session.id, state: 'error' },
    ]);
    expect(store.start('sensor-1').state).toBe('recording');
  });
});
