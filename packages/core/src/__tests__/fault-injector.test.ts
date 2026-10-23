import { afterEach, describe, expect, it, vi } from 'vitest';
import { FaultInjector } from '../runtime/fault-injector';
import { FaultInjectionConfigSchema } from '../schema/device';

afterEach(() => vi.useRealTimers());

function injector(
  config: { segmentSizeBytes?: number; rules?: unknown[] },
  random = () => 0.5,
) {
  const events: unknown[] = [];
  const disconnects: string[] = [];
  const instance = new FaultInjector(
    FaultInjectionConfigSchema.parse({ segmentSizeBytes: 256, rules: [], ...config }),
    {
      onFault: (event) => events.push(event),
      disconnect: async (connectionId) => { disconnects.push(connectionId); },
      random,
    },
  );
  return { instance, events, disconnects };
}

describe('FaultInjector', () => {
  it('按固定字节长度切段，并在空闲 5 毫秒后处理尾段', async () => {
    vi.useFakeTimers();
    const { instance } = injector({
      segmentSizeBytes: 4,
      rules: [{
        id: 'drop-second',
        name: '丢弃第二段',
        direction: 'in',
        trigger: { type: 'sequence', mode: 'indices', indices: [2] },
        action: { type: 'drop' },
      }],
    });
    const delivered: string[] = [];
    await instance.setEnabled(true);
    const pending = instance.pushTcp('conn-a', 'in', Buffer.from('abcdefghij'), async (data) => {
      delivered.push(data.toString());
    });
    await vi.advanceTimersByTimeAsync(5);
    await pending;
    expect(delivered.join('')).toBe('abcdij');
  });

  it('延迟当前段时保持后续 TCP 字节顺序', async () => {
    vi.useFakeTimers();
    const { instance } = injector({
      segmentSizeBytes: 2,
      rules: [{
        id: 'delay-first',
        name: '延迟首段',
        direction: 'both',
        trigger: { type: 'sequence', mode: 'indices', indices: [1] },
        action: { type: 'delay', delayMs: 10 },
      }],
    });
    const delivered: string[] = [];
    await instance.setEnabled(true);
    const pending = instance.pushTcp('conn-a', 'out', Buffer.from('abcd'), async (data) => {
      delivered.push(data.toString());
    });
    await vi.advanceTimersByTimeAsync(9);
    expect(delivered).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(delivered.join('')).toBe('abcd');
  });

  it('关闭注入时，已排队的延迟数据仍先于后续直通数据', async () => {
    vi.useFakeTimers();
    const { instance } = injector({
      segmentSizeBytes: 1,
      rules: [{
        id: 'delay-first',
        name: '延迟首段',
        direction: 'out',
        trigger: { type: 'sequence', mode: 'indices', indices: [1] },
        action: { type: 'delay', delayMs: 20 },
      }],
    });
    const delivered: string[] = [];
    await instance.setEnabled(true);
    const first = instance.pushTcp('conn-a', 'out', Buffer.from('a'), async (data) => {
      delivered.push(data.toString());
    });
    await vi.advanceTimersByTimeAsync(0);

    const disabling = instance.setEnabled(false);
    const second = instance.pushTcp('conn-a', 'out', Buffer.from('b'), async (data) => {
      delivered.push(data.toString());
    });
    await vi.advanceTimersByTimeAsync(20);
    await Promise.all([first, disabling, second]);

    expect(delivered).toEqual(['a', 'b']);
  });

  it('仅对每连接、每方向的指定序号执行首条匹配规则', async () => {
    const { instance, events } = injector({
      segmentSizeBytes: 1,
      rules: [
        {
          id: 'drop-second',
          name: '入站第二段',
          direction: 'in',
          trigger: { type: 'sequence', mode: 'every', interval: 2 },
          action: { type: 'drop' },
        },
        {
          id: 'also-drop',
          name: '后续规则',
          direction: 'both',
          trigger: { type: 'probability', percent: 50 },
          action: { type: 'drop' },
        },
      ],
    });
    const seen: string[] = [];
    await instance.setEnabled(true);
    await instance.pushTcp('conn-a', 'in', Buffer.from('a'), async (data) => { seen.push(data.toString()); });
    await instance.pushTcp('conn-a', 'in', Buffer.from('b'), async (data) => { seen.push(data.toString()); });
    await instance.pushTcp('conn-b', 'in', Buffer.from('c'), async (data) => { seen.push(data.toString()); });
    await instance.pushTcp('conn-a', 'out', Buffer.from('d'), async (data) => { seen.push(data.toString()); });
    expect(seen).toEqual(['a', 'c', 'd']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ index: 2, rule: { id: 'drop-second' } });
  });

  it('对 MQTT 载荷执行概率触发和单 bit 损坏', async () => {
    const { instance, events } = injector({
      rules: [{
        id: 'corrupt',
        name: '翻转一位',
        direction: 'both',
        trigger: { type: 'probability', percent: 100 },
        action: { type: 'corrupt' },
      }],
    }, () => 0);
    await instance.setEnabled(true);
    instance.openConnection('mqtt-conn');
    const result = await instance.processMqtt('mqtt-conn', 'in', Buffer.from([0]));
    expect(result.data).toEqual(Buffer.from([1]));
    expect(result.applied).toMatchObject({ index: 1, action: 'corrupt', inputBytes: 1, outputBytes: 1 });
    expect(events).toHaveLength(0);
  });

  it('MQTT 连接断开后丢弃旧连接尚未完成的注入消息', async () => {
    vi.useFakeTimers();
    const { instance } = injector({
      rules: [{
        id: 'delay-first',
        name: '延迟消息',
        direction: 'in',
        trigger: { type: 'sequence', mode: 'indices', indices: [1] },
        action: { type: 'delay', delayMs: 20 },
      }],
    });
    await instance.setEnabled(true);
    instance.openConnection('mqtt-conn');
    const oldMessage = instance.processMqtt('mqtt-conn', 'in', Buffer.from('old'));
    await vi.advanceTimersByTimeAsync(0);

    instance.closeConnection('mqtt-conn');
    instance.openConnection('mqtt-conn');
    const newMessage = instance.processMqtt('mqtt-conn', 'in', Buffer.from('new'));
    await vi.advanceTimersByTimeAsync(20);

    expect(await oldMessage).toEqual({});
    expect((await newMessage).data).toEqual(Buffer.from('new'));
  });

  it('关闭注入后，MQTT 直通消息排在已延迟消息之后', async () => {
    vi.useFakeTimers();
    const { instance } = injector({
      rules: [{
        id: 'delay-first',
        name: '延迟消息',
        direction: 'in',
        trigger: { type: 'sequence', mode: 'indices', indices: [1] },
        action: { type: 'delay', delayMs: 20 },
      }],
    });
    const delivered: string[] = [];
    await instance.setEnabled(true);
    instance.openConnection('mqtt-conn');
    const first = instance.processMqtt('mqtt-conn', 'in', Buffer.from('a'));
    await vi.advanceTimersByTimeAsync(0);
    await instance.setEnabled(false);
    const second = instance.processMqtt('mqtt-conn', 'in', Buffer.from('b'));
    void first.then((result) => { if (result.data) delivered.push(result.data.toString()); });
    void second.then((result) => { if (result.data) delivered.push(result.data.toString()); });

    expect(delivered).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    await Promise.all([first, second]);

    expect(delivered).toEqual(['a', 'b']);
  });

  it('断连故障关闭连接并丢弃命中的 TCP 段', async () => {
    const { instance, disconnects, events } = injector({
      segmentSizeBytes: 2,
      rules: [{
        id: 'disconnect',
        name: '断开连接',
        direction: 'in',
        trigger: { type: 'sequence', mode: 'indices', indices: [1] },
        action: { type: 'disconnect' },
      }],
    });
    const delivered: Buffer[] = [];
    await instance.setEnabled(true);
    await instance.pushTcp('conn-a', 'in', Buffer.from('ab'), async (data) => { delivered.push(data); });
    expect(disconnects).toEqual(['conn-a']);
    expect(delivered).toEqual([]);
    expect(events).toHaveLength(1);
  });
});
