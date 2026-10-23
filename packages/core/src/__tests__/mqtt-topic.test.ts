import { describe, expect, it } from 'vitest';
import {
  isValidMqttTopicFilter,
  isValidMqttTopicName,
  mqttTopicMatchesFilter,
} from '../common/mqtt-topic';

describe('MQTT 主题过滤器', () => {
  it('校验主题名与通配符位置', () => {
    expect(isValidMqttTopicName('devices/a/state')).toBe(true);
    expect(isValidMqttTopicName('devices/+/state')).toBe(false);
    expect(isValidMqttTopicName('devices/#')).toBe(false);
    expect(isValidMqttTopicName('')).toBe(false);

    for (const filter of ['#', 'devices/#', 'devices/+/state']) {
      expect(isValidMqttTopicFilter(filter)).toBe(true);
    }
    for (const filter of ['', 'devices/#/state', 'devices/a+', 'devices/+tail']) {
      expect(isValidMqttTopicFilter(filter)).toBe(false);
    }
  });

  it('按单层 + 与末尾多层 # 匹配，并遵循系统主题规则', () => {
    expect(mqttTopicMatchesFilter('devices/a/state', 'devices/+/state')).toBe(true);
    expect(mqttTopicMatchesFilter('devices/a/b/state', 'devices/+/state')).toBe(false);
    expect(mqttTopicMatchesFilter('devices/a/state', 'devices/#')).toBe(true);
    expect(mqttTopicMatchesFilter('devices', 'devices/#')).toBe(true);
    expect(mqttTopicMatchesFilter('$SYS/broker/uptime', '#')).toBe(false);
    expect(mqttTopicMatchesFilter('$SYS/broker/uptime', '$SYS/#')).toBe(true);
  });
});
