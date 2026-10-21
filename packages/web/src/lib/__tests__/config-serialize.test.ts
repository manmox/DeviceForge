import type { DeviceConfig } from '@deviceforge/core';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  parseJsonObject,
  stringifyDeviceConfig,
  stringifyJsonValue,
  stripUndefined,
} from '../config-serialize';

const config: DeviceConfig = {
  id: 'serialize-test',
  name: '序列化测试',
  description: undefined,
  transport: { type: 'tcp-server', host: '127.0.0.1', port: 19001 },
  framing: {
    type: 'length-prefix',
    lengthField: { offset: 2, size: 2, endian: 'be', adjust: 0 },
    maxFrameLength: 4096,
  },
  codec: {
    type: 'fields',
    fields: [
      { name: 'magic', type: 'bytes', length: 2, const: 'AA55' },
      { name: 'temp', type: 'i16', endian: 'be', scale: 0.1 },
    ],
    checksum: { algo: 'crc16-modbus', verify: true },
  },
  state: { temp: 25.5, online: true, note: null },
  rules: [
    {
      name: '读取温度',
      enabled: true,
      on: 'frame',
      match: { cmd: 3 },
      jitter: 0,
      target: 'all',
      set: { temp: '${randomFloat(20,30)}' },
      send: { fields: { cmd: 131, temp: '$state.temp' } },
      disconnect: false,
    },
  ],
  autoStart: false,
};

describe('stripUndefined', () => {
  it('removes undefined object keys but keeps null and nested values', () => {
    const result = stripUndefined(config);
    expect('description' in result).toBe(false);
    expect(result.state).toEqual({ temp: 25.5, online: true, note: null });
  });

  it('removes undefined from nested objects and arrays', () => {
    const result = stripUndefined({
      a: undefined,
      b: { c: undefined, d: 1 },
      e: [{ f: undefined, g: 2 }],
    });
    expect(result).toEqual({ b: { d: 1 }, e: [{ g: 2 }] });
  });
});

describe('stringifyDeviceConfig', () => {
  it('emits YAML that parses back to the same JSON-compatible config', () => {
    const yaml = stringifyDeviceConfig(config);
    expect(YAML.parse(yaml)).toEqual(stripUndefined(config));
  });
});

describe('stringifyJsonValue', () => {
  it('formats JSON with two spaces and drops undefined', () => {
    expect(stringifyJsonValue({ a: 1, b: undefined, c: null })).toBe(
      '{\n  "a": 1,\n  "c": null\n}',
    );
  });
});

describe('parseJsonObject', () => {
  it('accepts objects only', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJsonObject('[1,2]')).toThrow('JSON 必须是对象');
    expect(() => parseJsonObject('null')).toThrow('JSON 必须是对象');
    expect(() => parseJsonObject('{')).toThrow('JSON 解析失败');
  });
});
