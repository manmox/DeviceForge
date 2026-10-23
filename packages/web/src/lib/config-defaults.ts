import {
  DEFAULT_RECONNECT_CONFIG,
  TextCodecSchema,
} from '@deviceforge/core/schema';
import type {
  ChecksumConfig,
  CodecConfig,
  DeviceConfig,
  FieldDef,
  FramingConfig,
  OutgoingMessage,
  Rule,
  MqttBrokerTransport,
  MqttClientTransport,
  TcpClientTransport,
  TcpServerTransport,
  TransportConfig,
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
  if (type === 'text') {
    return TextCodecSchema.parse({
      type: 'text',
      messages: [
        {
          name: 'message',
          slots: [{ kind: 'field', name: 'payload', type: 'string' }],
        },
      ],
    });
  }
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

export function defaultTransport(type: 'tcp-server'): TcpServerTransport;
export function defaultTransport(type: 'tcp-client'): TcpClientTransport;
export function defaultTransport(type: 'mqtt-client'): MqttClientTransport;
export function defaultTransport(type: 'mqtt-broker'): MqttBrokerTransport;
export function defaultTransport(type: TransportConfig['type']): TransportConfig;
export function defaultTransport(type: TransportConfig['type']): TransportConfig {
  if (type === 'tcp-client') {
    return {
      type: 'tcp-client',
      host: '127.0.0.1',
      port: 19001,
      connectTimeoutMs: 5_000,
      reconnect: { ...DEFAULT_RECONNECT_CONFIG },
    };
  }
  if (type === 'mqtt-client') {
    return {
      type: 'mqtt-client',
      url: 'mqtt://127.0.0.1:1883',
      subscriptions: [],
      publishTopic: 'deviceforge/device/up',
      publishQos: 0,
    };
  }
  if (type === 'mqtt-broker') {
    return {
      type: 'mqtt-broker',
      host: '127.0.0.1',
      port: 1883,
      publishTopic: 'deviceforge/device/down',
      publishQos: 0,
    };
  }
  return { type: 'tcp-server', host: '127.0.0.1', port: 19010 };
}

export function changeTransportType(
  current: TransportConfig,
  type: TransportConfig['type'],
): TransportConfig {
  if (current.type === type) return current;

  const host = 'host' in current ? current.host || '127.0.0.1' : '127.0.0.1';
  const currentPort = 'port' in current ? current.port : 1883;
  if (type === 'mqtt-client' || type === 'mqtt-broker') {
    return defaultTransport(type);
  }
  if (type === 'tcp-client') {
    const defaults = defaultTransport('tcp-client');
    return {
      ...defaults,
      host,
      // 监听端口 0 表示自动分配，切到 client 后没有意义。
      port: currentPort > 0 ? currentPort : defaults.port,
    };
  }

  const defaults = defaultTransport('tcp-server');
  return { ...defaults, host, port: currentPort };
}

export function createBlankConfig(): DeviceConfig {
  return {
    id: 'my-device',
    name: '我的设备',
    transport: defaultTransport('tcp-server'),
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
