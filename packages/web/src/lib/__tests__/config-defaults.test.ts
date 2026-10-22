import type { CodecConfig, FieldDef, FramingConfig } from '@deviceforge/core';
import { describe, expect, it } from 'vitest';
import {
  changeCodecType,
  changeFieldType,
  changeFramingType,
  createBlankConfig,
  defaultChecksum,
  defaultCodec,
  defaultField,
  defaultFraming,
  defaultOutgoingMessage,
  defaultRule,
  uniqueDeviceId,
} from '../config-defaults';

describe('createBlankConfig', () => {
  it('creates the expected blank TCP device', () => {
    const config = createBlankConfig();
    expect(config.id).toBe('my-device');
    expect(config.transport).toEqual({
      type: 'tcp-server',
      host: '127.0.0.1',
      port: 19010,
    });
    expect(config.framing).toEqual({ type: 'raw' });
    expect(config.codec).toEqual({ type: 'raw', display: 'hex' });
    expect(config.state).toEqual({});
    expect(config.rules).toEqual([]);
    expect(config.autoStart).toBe(false);
    expect(config.deviceInfo).toBeUndefined();
  });
});

describe('framing defaults', () => {
  it('builds each variant with valid defaults', () => {
    expect(defaultFraming('raw')).toEqual({ type: 'raw' });
    expect(defaultFraming('delimiter')).toEqual({
      type: 'delimiter',
      delimiterFormat: 'text',
      delimiter: '\r\n',
      includeDelimiter: false,
    });
    expect(defaultFraming('length-prefix')).toMatchObject({
      type: 'length-prefix',
      lengthField: { offset: 0, size: 2, endian: 'be', adjust: 0 },
      maxFrameLength: 65535,
    });
    expect(defaultFraming('fixed')).toEqual({ type: 'fixed', length: 16 });
  });

  it('keeps the current variant and replaces others', () => {
    const current: FramingConfig = {
      type: 'length-prefix',
      lengthField: { offset: 2, size: 2, endian: 'be', adjust: 0 },
      maxFrameLength: 1234,
    };
    expect(changeFramingType(current, 'length-prefix')).toBe(current);
    expect(changeFramingType(current, 'raw')).toEqual({ type: 'raw' });
    expect(changeFramingType(current, 'fixed')).toEqual({ type: 'fixed', length: 16 });
    expect(changeFramingType({ type: 'raw' }, 'delimiter')).toEqual(
      defaultFraming('delimiter'),
    );
  });
});

describe('codec defaults', () => {
  it('builds raw and fields codecs', () => {
    expect(defaultCodec('raw')).toEqual({ type: 'raw', display: 'hex' });
    const fields = defaultCodec('fields');
    expect(fields).toMatchObject({
      type: 'fields',
      fields: [{ name: 'payload', type: 'bytes', length: 'remaining' }],
    });
  });

  it('keeps the current codec variant', () => {
    const current: CodecConfig = { type: 'raw', display: 'ascii' };
    expect(changeCodecType(current, 'raw')).toBe(current);
    expect(changeCodecType(current, 'fields')).toMatchObject({ type: 'fields' });
  });
});

describe('field defaults and conversion', () => {
  it('adds a length for variable-size fields', () => {
    expect(defaultField('u16', 'value')).toEqual({ name: 'value', type: 'u16' });
    expect(defaultField('bytes', 'payload')).toEqual({
      name: 'payload',
      type: 'bytes',
      length: 1,
    });
  });

  it('drops incompatible options when changing type', () => {
    const numeric: FieldDef = {
      name: 'temp',
      type: 'u16',
      endian: 'le',
      const: 1,
      scale: 0.1,
      unit: 'C',
      description: '温度',
    };
    expect(changeFieldType(numeric, 'bytes')).toEqual({
      name: 'temp',
      type: 'bytes',
      length: 1,
      description: '温度',
    });

    const text: FieldDef = {
      name: 'label',
      type: 'string',
      length: 4,
      encoding: 'ascii',
      const: 'AB',
    };
    expect(changeFieldType(text, 'u32')).toEqual({ name: 'label', type: 'u32' });

    const calc: FieldDef = { name: 'length', type: 'u16', calc: 'totalLength' };
    expect(changeFieldType(calc, 'bytes')).toEqual({
      name: 'length',
      type: 'bytes',
      length: 1,
    });
  });

  it('preserves endian only for multi-byte numeric fields', () => {
    const field: FieldDef = { name: 'flags', type: 'u8', endian: 'le' };
    expect(changeFieldType(field, 'u16')).toEqual({
      name: 'flags',
      type: 'u16',
      endian: 'le',
    });
    expect(changeFieldType(field, 'string')).toEqual({
      name: 'flags',
      type: 'string',
      length: 1,
    });
  });
});

describe('rule and message defaults', () => {
  it('creates frame, start and interval rules', () => {
    expect(defaultRule('frame')).toMatchObject({
      name: '新规则',
      enabled: true,
      on: 'frame',
      jitter: 0,
      target: 'all',
      disconnect: false,
    });
    expect(defaultRule('start')).toMatchObject({ on: 'start' });
    expect(defaultRule('interval')).toMatchObject({ every: 5000 });
    expect(defaultRule('interval').on).toBeUndefined();
  });

  it('creates outgoing messages and checksums', () => {
    expect(defaultOutgoingMessage('fields')).toEqual({ fields: {} });
    expect(defaultOutgoingMessage('hex')).toEqual({ hex: '' });
    expect(defaultChecksum()).toEqual({ algo: 'crc16-modbus', verify: true });
  });
});

describe('uniqueDeviceId', () => {
  it('finds an unused id', () => {
    expect(uniqueDeviceId([])).toBe('my-device');
    expect(uniqueDeviceId(['my-device'])).toBe('my-device-2');
    expect(uniqueDeviceId(['my-device', 'my-device-2'])).toBe('my-device-3');
  });
});
