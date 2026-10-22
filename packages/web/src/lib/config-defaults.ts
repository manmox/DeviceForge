import type {
  ChecksumConfig,
  CodecConfig,
  DeviceConfig,
  FieldDef,
  FramingConfig,
  OutgoingMessage,
  Rule,
} from '@deviceforge/core';
import { fieldNeedsLength, isMultiByteFieldType, isNumericFieldType } from './codec-fields';
import { withRuleTrigger, type RuleTrigger } from './rule-shape';

export function defaultFraming(type: FramingConfig['type']): FramingConfig {
  switch (type) {
    case 'raw':
      return { type: 'raw' };
    case 'delimiter':
      return {
        type: 'delimiter',
        delimiterFormat: 'text',
        delimiter: '\r\n',
        includeDelimiter: false,
      };
    case 'length-prefix':
      return {
        type: 'length-prefix',
        lengthField: { offset: 0, size: 2, endian: 'be', adjust: 0 },
        maxFrameLength: 65535,
      };
    case 'fixed':
      return { type: 'fixed', length: 16 };
  }
}

export function defaultField(type: FieldDef['type'], name = 'payload'): FieldDef {
  const field: FieldDef = { name, type };
  if (fieldNeedsLength(type)) field.length = 1;
  return field;
}

export function defaultCodec(type: CodecConfig['type']): CodecConfig {
  if (type === 'raw') return { type: 'raw', display: 'hex' };
  return {
    type: 'fields',
    fields: [{ name: 'payload', type: 'bytes', length: 'remaining' }],
  };
}

export function defaultChecksum(): ChecksumConfig {
  return { algo: 'crc16-modbus', verify: true };
}

export function defaultOutgoingMessage(kind: 'fields' | 'hex' = 'fields'): OutgoingMessage {
  return kind === 'hex' ? { hex: '' } : { fields: {} };
}

export function defaultRule(trigger: RuleTrigger = 'frame'): Rule {
  return withRuleTrigger(
    {
      name: '新规则',
      enabled: true,
      jitter: 0,
      target: 'all',
      disconnect: false,
    },
    trigger,
  );
}

export function uniqueDeviceId(existing: Iterable<string>, base = 'my-device'): string {
  const ids = new Set(existing);
  if (!ids.has(base)) return base;
  let index = 2;
  while (ids.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function createBlankConfig(): DeviceConfig {
  return {
    id: 'my-device',
    name: '我的设备',
    transport: { type: 'tcp-server', host: '127.0.0.1', port: 19010 },
    framing: { type: 'raw' },
    codec: { type: 'raw', display: 'hex' },
    state: {},
    rules: [],
    autoStart: false,
  };
}

export function changeFramingType(
  current: FramingConfig,
  type: FramingConfig['type'],
): FramingConfig {
  if (current.type === type) return current;
  const next = defaultFraming(type);
  if (next.type === 'length-prefix' && 'maxFrameLength' in current) {
    return { ...next, maxFrameLength: current.maxFrameLength };
  }
  return next;
}

export function changeCodecType(
  current: CodecConfig,
  type: CodecConfig['type'],
): CodecConfig {
  if (current.type === type) return current;
  return defaultCodec(type);
}

function isValidFieldLength(
  value: FieldDef['length'],
): value is NonNullable<FieldDef['length']> {
  if (value === undefined) return false;
  if (value === 'remaining') return true;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1;
  return typeof value.fromField === 'string' && value.fromField.length > 0;
}

export function changeFieldType(field: FieldDef, type: FieldDef['type']): FieldDef {
  if (field.type === type) return field;

  const next: FieldDef = { name: field.name, type };
  if (field.description !== undefined) next.description = field.description;

  if (isNumericFieldType(type)) {
    if (isMultiByteFieldType(type) && field.endian !== undefined) next.endian = field.endian;
    if (field.calc !== undefined) next.calc = field.calc;
    if (typeof field.const === 'number' || typeof field.const === 'boolean') {
      next.const = field.const;
    }
    if (field.scale !== undefined) next.scale = field.scale;
    if (field.unit !== undefined) next.unit = field.unit;
    return next;
  }

  if (fieldNeedsLength(type)) {
    next.length = isValidFieldLength(field.length) ? field.length : 1;
  }
  if (type === 'string' && field.encoding !== undefined) next.encoding = field.encoding;
  if (typeof field.const === 'string') next.const = field.const;
  return next;
}
