import { z } from 'zod';
import {
  isValidMqttTopicFilter,
  isValidMqttTopicName,
} from '../common/mqtt-topic';
import { EndianSchema } from './common';
import { DictionaryIdSchema } from './dictionary';

const HostSchema = z.string().min(1).default('127.0.0.1');
const PortSchema = z.number().int().min(0).max(65535);

export const TcpServerTransportSchema = z.object({
  type: z.literal('tcp-server'),
  host: HostSchema,
  port: PortSchema,
});

export const DEFAULT_RECONNECT_CONFIG = {
  enabled: true,
  minDelayMs: 500,
  maxDelayMs: 10_000,
} as const;

export const ReconnectConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    minDelayMs: z.number().int().min(10).max(60_000).default(500),
    maxDelayMs: z.number().int().min(10).max(300_000).default(10_000),
  })
  .superRefine((value, ctx) => {
    if (value.minDelayMs > value.maxDelayMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxDelayMs'],
        message: '最大重试间隔不能小于初始重试间隔',
      });
    }
  });

export const TcpClientTransportSchema = z.object({
  type: z.literal('tcp-client'),
  host: HostSchema,
  // 客户端没有“自动分配端口”的语义，0 端口会让连接目标无效。
  port: z.number().int().min(1).max(65535),
  connectTimeoutMs: z.number().int().min(100).max(120_000).default(5_000),
  reconnect: ReconnectConfigSchema.default({ ...DEFAULT_RECONNECT_CONFIG }),
});

export const MqttQosSchema = z.union([z.literal(0), z.literal(1)]);

export const MqttSubscriptionSchema = z.object({
  topic: z
    .string()
    .min(1, '订阅主题不能为空')
    .refine(isValidMqttTopicFilter, 'MQTT 主题过滤器中的 + 和 # 用法无效'),
  qos: MqttQosSchema.default(0),
});

const MqttUrlSchema = z.string().url().superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'MQTT 地址格式无效' });
    return;
  }

  if (url.protocol !== 'mqtt:' && url.protocol !== 'mqtts:') {
    ctx.addIssue({ code: 'custom', message: '仅支持 mqtt:// 和 mqtts:// 地址' });
  }
  if (!url.hostname) {
    ctx.addIssue({ code: 'custom', message: 'MQTT 地址必须包含主机名' });
  }
  if (url.port === '0') {
    ctx.addIssue({ code: 'custom', path: ['port'], message: 'MQTT 端口必须为 1-65535' });
  }
  if (url.username || url.password) {
    ctx.addIssue({ code: 'custom', message: '账号密码请填写独立字段，不要嵌入地址' });
  }
  if ((url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
    ctx.addIssue({ code: 'custom', message: 'MQTT 地址不支持路径、查询参数或片段' });
  }
});

function checkCredentialPair(
  value: { username?: string; password?: string },
  ctx: z.RefinementCtx,
): void {
  if (Boolean(value.username) !== Boolean(value.password)) {
    ctx.addIssue({
      code: 'custom',
      path: [value.username ? 'password' : 'username'],
      message: '账号和密码必须同时填写',
    });
  }
}

export const MqttClientTransportSchema = z
  .object({
    type: z.literal('mqtt-client'),
    url: MqttUrlSchema.default('mqtt://127.0.0.1:1883'),
    clientId: z.string().optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    caFile: z.string().min(1).optional(),
    subscriptions: z.array(MqttSubscriptionSchema).default([]),
    publishTopic: z
      .string()
      .min(1)
      .default('deviceforge/device/up')
      .refine(isValidMqttTopicName, '发布主题不能包含 + 或 #'),
    publishQos: MqttQosSchema.default(0),
  })
  .superRefine((value, ctx) => {
    checkCredentialPair(value, ctx);
    let isSecureUrl = false;
    try {
      isSecureUrl = new URL(value.url).protocol === 'mqtts:';
    } catch {
      // MqttUrlSchema 已经报告地址格式错误。
    }
    if (value.caFile && !isSecureUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['caFile'],
        message: 'CA 文件只适用于 mqtts:// 地址',
      });
    }
  });

export const MqttBrokerTransportSchema = z
  .object({
    type: z.literal('mqtt-broker'),
    host: HostSchema,
    port: PortSchema.default(1883),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    certFile: z.string().min(1).optional(),
    keyFile: z.string().min(1).optional(),
    publishTopic: z
      .string()
      .min(1)
      .default('deviceforge/device/down')
      .refine(isValidMqttTopicName, '发布主题不能包含 + 或 #'),
    publishQos: MqttQosSchema.default(0),
  })
  .superRefine((value, ctx) => {
    checkCredentialPair(value, ctx);
    if (Boolean(value.certFile) !== Boolean(value.keyFile)) {
      ctx.addIssue({
        code: 'custom',
        path: [value.certFile ? 'keyFile' : 'certFile'],
        message: '证书和私钥文件必须同时填写',
      });
    }
  });

export const TransportSchema = z.discriminatedUnion('type', [
  TcpServerTransportSchema,
  TcpClientTransportSchema,
  MqttClientTransportSchema,
  MqttBrokerTransportSchema,
]);

export const LengthFieldSchema = z.object({
  offset: z.number().int().min(0).default(0),
  size: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  endian: EndianSchema.default('be'),
  adjust: z.number().int().default(0),
});

export const DelimiterFormatSchema = z.enum(['text', 'hex']);
export type DelimiterFormat = z.infer<typeof DelimiterFormatSchema>;

export const DelimiterFramingSchema = z
  .object({
    type: z.literal('delimiter'),
    delimiterFormat: DelimiterFormatSchema.default('hex'),
    delimiter: z.string(),
    includeDelimiter: z.boolean().default(false),
  })
  .superRefine((framing, ctx) => {
    if (framing.delimiterFormat === 'hex') {
      if (!/^(?:[0-9a-fA-F]{2})+$/.test(framing.delimiter)) {
        ctx.addIssue({
          code: 'custom',
          path: ['delimiter'],
          message:
            'hex 分隔符必须是不含空格的偶数位十六进制（如 "0D0A"）；文本分隔符请设置 delimiterFormat: text',
        });
      }
      return;
    }
    if (framing.delimiter.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['delimiter'],
        message: '文本分隔符不能为空',
      });
    }
  });

export const FramingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('raw'),
  }),
  DelimiterFramingSchema,
  z.object({
    type: z.literal('length-prefix'),
    lengthField: LengthFieldSchema,
    maxFrameLength: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024 * 1024)
      .default(65535),
  }),
  z.object({
    type: z.literal('fixed'),
    length: z.number().int().min(1).max(16 * 1024 * 1024),
  }),
]);

export const FieldTypeSchema = z.enum([
  'u8',
  'i8',
  'u16',
  'i16',
  'u24',
  'i24',
  'u32',
  'i32',
  'f32',
  'f64',
  'bytes',
  'string',
  'bcd',
]);

const NUMERIC_FIELD_TYPES = new Set([
  'u8',
  'i8',
  'u16',
  'i16',
  'u24',
  'i24',
  'u32',
  'i32',
  'f32',
  'f64',
]);

export const FieldSchema = z
  .object({
    name: z.string().min(1),
    type: FieldTypeSchema,
    endian: EndianSchema.optional(),
    length: z
      .union([
        z.number().int().min(1),
        z.literal('remaining'),
        z.object({ fromField: z.string().min(1) }),
      ])
      .optional(),
    encoding: z.enum(['ascii', 'utf8', 'hex']).optional(),
    calc: z.enum(['totalLength', 'remainingLength']).optional(),
    const: z.union([z.string(), z.number(), z.boolean()]).optional(),
    scale: z.number().optional(),
    unit: z.string().optional(),
    description: z.string().optional(),
  })
  .superRefine((field, ctx) => {
    if ((field.type === 'bytes' || field.type === 'string' || field.type === 'bcd') && field.length === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `${field.name}: ${field.type} 字段必须指定 length`,
        path: ['length'],
      });
    }
    if (field.calc && !NUMERIC_FIELD_TYPES.has(field.type)) {
      ctx.addIssue({
        code: 'custom',
        message: `${field.name}: calc 只能用于数值字段`,
        path: ['calc'],
      });
    }
    if (field.calc && field.length !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `${field.name}: calc 字段不能同时指定 length`,
        path: ['length'],
      });
    }
  });

export const ChecksumSchema = z.object({
  algo: z.enum(['sum8', 'xor8', 'crc8', 'crc16-modbus', 'crc16-ccitt', 'crc32', 'lrc']),
  endian: EndianSchema.optional(),
  verify: z.boolean().default(true),
});
export type ChecksumConfig = z.infer<typeof ChecksumSchema>;

export const RawCodecSchema = z.object({
  type: z.literal('raw'),
  display: z.enum(['hex', 'ascii']).default('hex'),
});

export const FieldsCodecSchema = z.object({
  type: z.literal('fields'),
  fields: z.array(FieldSchema).min(1),
  checksum: ChecksumSchema.optional(),
});

export const TEXT_FIELD_TYPES = [
  'string',
  'int',
  'decimal',
  'timestamp',
  'stringList',
  'int16Array',
] as const;
export type TextFieldType = (typeof TEXT_FIELD_TYPES)[number];

export const TEXT_DEVICE_INFO_KEYS = [
  'manufacturer',
  'model',
  'serialNumber',
  'hardwareVersion',
  'firmwareVersion',
  'tnsImei',
] as const;
export type TextDeviceInfoKey = (typeof TEXT_DEVICE_INFO_KEYS)[number];

const TextFieldPatternSchema = z.object({
  kind: z.literal('field'),
  name: z.string().min(1),
  type: z.enum(TEXT_FIELD_TYPES),
  width: z.number().int().min(1).max(4096).optional(),
  pad: z.enum(['left', 'right']).optional(),
  padChar: z.string().min(1).max(1).default('0'),
  optional: z.boolean().default(false),
  auto: z.enum(['timestamp', 'sequence']).optional(),
  sequenceStart: z.number().int().min(0).default(1),
  format: z.string().min(1).optional(),
  valueSeparator: z.string().min(1).optional(),
  default: z.string().optional(),
  defaultFrom: z.enum(TEXT_DEVICE_INFO_KEYS).optional(),
  pattern: z.string().min(1).optional(),
  patternSeverity: z.enum(['error', 'warning']).default('error'),
  allowEmpty: z.boolean().default(false),
  description: z.string().optional(),
});

export type TextField = z.infer<typeof TextFieldPatternSchema>;

export const TextFieldSchema = TextFieldPatternSchema.superRefine(
  (field, ctx) => {
    const widthTypes = new Set<TextFieldType>([
      'string',
      'int',
      'decimal',
      'timestamp',
    ]);
    if (field.width !== undefined && !widthTypes.has(field.type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['width'],
        message: `${field.type} 字段不支持 width 补位`,
      });
    }
    if (field.pad !== undefined && field.width === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['pad'],
        message: 'pad 需要同时设置 width',
      });
    }
    if (field.type === 'stringList' && field.valueSeparator === undefined) {
      // 编码器/解析器会回退到 repeat.valueSeparator 或 '|'。
    }
    if (field.auto === 'timestamp') {
      if (field.type !== 'timestamp') {
        ctx.addIssue({
          code: 'custom',
          path: ['auto'],
          message: 'auto: timestamp 只能用于 timestamp 字段',
        });
      }
      if (!field.format) {
        ctx.addIssue({
          code: 'custom',
          path: ['format'],
          message: '自动时间戳必须提供 format',
        });
      }
    }
    if (field.auto === 'sequence' && field.type !== 'int') {
      ctx.addIssue({
        code: 'custom',
        path: ['auto'],
        message: 'auto: sequence 只能用于 int 字段',
      });
    }
    if (field.type === 'timestamp' && !field.format) {
      ctx.addIssue({
        code: 'custom',
        path: ['format'],
        message: 'timestamp 字段必须提供 format',
      });
    }
    if (field.default !== undefined && field.defaultFrom !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultFrom'],
        message: 'default 与 defaultFrom 不能同时设置',
      });
    }
    if (field.pattern !== undefined) {
      try {
        new RegExp(field.pattern);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['pattern'],
          message: 'pattern 不是合法的正则表达式',
        });
      }
    }
  },
);

const TextLiteralSlotSchema = z.object({
  kind: z.literal('literal'),
  value: z.string(),
  description: z.string().optional(),
});

const TextRepeatItemFieldSchema = TextFieldSchema.superRefine((field, ctx) => {
  if (field.optional) {
    ctx.addIssue({
      code: 'custom',
      path: ['optional'],
      message: 'repeat item 字段不能声明 optional',
    });
  }
  if (field.auto !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['auto'],
      message: 'repeat item 字段不能使用 auto',
    });
  }
});

export const TextRepeatSchema = z.object({
  kind: z.literal('repeat'),
  name: z.string().min(1),
  countField: z.string().min(1),
  itemSeparator: z.string().min(1).default('*'),
  valueSeparator: z.string().min(1).default('|'),
  fields: z.array(TextRepeatItemFieldSchema).min(1),
  valueField: z.string().min(1).default('values'),
  // 全局数据字典 ID；字典内容不在设备配置中保存。
  dictionary: DictionaryIdSchema.optional(),
  keyField: z.string().min(1).optional(),
  mapField: z.string().min(1).optional(),
  mapKeyPrefix: z.string().optional(),
  description: z.string().optional(),
});

export type TextRepeat = z.infer<typeof TextRepeatSchema>;

export const TextSlotSchema = z.discriminatedUnion('kind', [
  TextLiteralSlotSchema,
  TextFieldSchema,
  TextRepeatSchema,
]);

export type TextSlot = z.infer<typeof TextSlotSchema>;

export const TextMatchSchema = z
  .object({
    index: z.number().int().min(0),
    equals: z.string().optional(),
    oneOf: z.array(z.string()).min(1).optional(),
    regex: z.string().min(1).optional(),
    notEquals: z.string().optional(),
  })
  .superRefine((match, ctx) => {
    const conditions = [
      match.equals !== undefined,
      match.oneOf !== undefined,
      match.regex !== undefined,
      match.notEquals !== undefined,
    ].filter(Boolean).length;
    if (conditions !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'match 条件必须且只能设置 equals / oneOf / regex / notEquals 之一',
      });
    }
    if (match.regex !== undefined) {
      try {
        new RegExp(match.regex);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['regex'],
          message: 'regex 不是合法的正则表达式',
        });
      }
    }
  });

export type TextMatch = z.infer<typeof TextMatchSchema>;

export const TextMessageSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  match: z.array(TextMatchSchema).optional(),
  slots: z.array(TextSlotSchema).min(1),
  display: z
    .object({
      summary: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

export type TextMessage = z.infer<typeof TextMessageSchema>;

export const TextSessionSchema = z.object({
  ackMessage: z.string().min(1),
  trackMessages: z.array(z.string().min(1)).default([]),
  sequenceField: z.string().min(1),
  statusField: z.string().min(1),
  successValues: z.array(z.string().min(1)).default(['OK']),
  timeoutMs: z.number().int().min(100).max(300_000).default(5_000),
  maxRetries: z.number().int().min(0).max(20).default(3),
});

export type TextSession = z.infer<typeof TextSessionSchema>;

function textFieldName(field: TextField): string {
  return field.name;
}

function checkMessageShape(
  message: TextMessage,
  codecSeparator: string,
  codecTerminator: string,
  ctx: z.RefinementCtx,
  basePath: (string | number)[],
): void {
  const names = new Set<string>();
  const priorFields = new Map<string, TextField>();
  let optionalSeen = false;

  for (let index = 0; index < message.slots.length; index += 1) {
    const slot = message.slots[index]!;
    const path = [...basePath, 'slots', index];

    if (slot.kind === 'literal') {
      if (slot.value.includes(codecSeparator)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'value'],
          message: `literal 不能包含顶层分隔符 ${JSON.stringify(codecSeparator)}`,
        });
      }
      if (codecTerminator && slot.value.includes(codecTerminator)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'value'],
          message: 'literal 不能包含结束符',
        });
      }
      continue;
    }

    if (names.has(slot.name)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'name'],
        message: `字段名 ${slot.name} 在同一报文中重复`,
      });
    }
    names.add(slot.name);

    if (slot.kind === 'field') {
      if (slot.optional) {
        if (optionalSeen) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'optional'],
            message: '每条报文最多只能有一个 optional 字段',
          });
        }
        optionalSeen = true;
      }
      if (
        slot.auto === 'timestamp' &&
        slot.format !== undefined &&
        slot.format.includes(codecSeparator)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'format'],
          message: '自动时间格式不能包含顶层分隔符',
        });
      }
      priorFields.set(slot.name, slot);
      continue;
    }

    // repeat
    if (optionalSeen) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'kind'],
        message: 'repeat 不能出现在 optional 字段之后',
      });
    }
    if (!priorFields.has(slot.countField)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'countField'],
        message: `countField ${slot.countField} 必须引用前面的字段`,
      });
    } else {
      const countField = priorFields.get(slot.countField)!;
      if (countField.type !== 'int') {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'countField'],
          message: 'countField 必须引用前面的 int 字段',
        });
      }
      if (countField.optional) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'countField'],
          message: 'countField 不能引用 optional 字段',
        });
      }
      if (countField.auto !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'countField'],
          message: 'countField 不能引用自动生成字段',
        });
      }
    }
    if (
      slot.itemSeparator === codecSeparator ||
      slot.itemSeparator.includes(codecSeparator) ||
      codecSeparator.includes(slot.itemSeparator)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'itemSeparator'],
        message: 'itemSeparator 不能与顶层 separator 相同或互相包含',
      });
    }
    if (
      slot.valueSeparator === slot.itemSeparator ||
      slot.valueSeparator.includes(slot.itemSeparator) ||
      slot.itemSeparator.includes(slot.valueSeparator)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'valueSeparator'],
        message: 'valueSeparator 不能与 itemSeparator 相同或互相包含',
      });
    }
    const itemNames = new Set<string>();
    for (let itemIndex = 0; itemIndex < slot.fields.length; itemIndex += 1) {
      const itemField = slot.fields[itemIndex]!;
      if (itemNames.has(itemField.name)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'fields', itemIndex, 'name'],
          message: `repeat item 字段名 ${itemField.name} 重复`,
        });
      }
      itemNames.add(itemField.name);
    }
    if (!itemNames.has(slot.valueField)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'valueField'],
        message: `valueField ${slot.valueField} 不在 repeat item 字段中`,
      });
    }
    if (slot.keyField !== undefined && !itemNames.has(slot.keyField)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'keyField'],
        message: `keyField ${slot.keyField} 不在 repeat item 字段中`,
      });
    }
    if (slot.mapField !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(slot.mapField)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'mapField'],
        message: 'mapField 必须是合法标识符',
      });
    }
  }

  if (message.prefix?.includes(codecSeparator)) {
    ctx.addIssue({
      code: 'custom',
      path: [...basePath, 'prefix'],
      message: 'prefix 不能包含顶层分隔符',
    });
  }
  if (message.suffix?.includes(codecSeparator)) {
    ctx.addIssue({
      code: 'custom',
      path: [...basePath, 'suffix'],
      message: 'suffix 不能包含顶层分隔符',
    });
  }
  if (message.prefix?.includes(codecTerminator)) {
    ctx.addIssue({
      code: 'custom',
      path: [...basePath, 'prefix'],
      message: 'prefix 不能包含结束符',
    });
  }
  if (message.suffix?.includes(codecTerminator)) {
    ctx.addIssue({
      code: 'custom',
      path: [...basePath, 'suffix'],
      message: 'suffix 不能包含结束符',
    });
  }
}

export const TextCodecSchema = z
  .object({
    type: z.literal('text'),
    separator: z.string().min(1).default(':'),
    terminator: z.string().min(1).default('\r\n'),
    trim: z.boolean().default(true),
    timezone: z.string().min(1).default('local'),
    messages: z.array(TextMessageSchema).min(1),
    session: TextSessionSchema.optional(),
  })
  .superRefine((codec, ctx) => {
    if (codec.timezone !== 'local') {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: codec.timezone });
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['timezone'],
          message: '无效的 IANA 时区，例如 Asia/Shanghai',
        });
      }
    }

    const messageNames = new Set<string>();
    const messageByName = new Map<string, TextMessage>();
    for (let index = 0; index < codec.messages.length; index += 1) {
      const message = codec.messages[index]!;
      if (messageNames.has(message.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['messages', index, 'name'],
          message: `报文名 ${message.name} 重复`,
        });
      }
      messageNames.add(message.name);
      messageByName.set(message.name, message);
      checkMessageShape(message, codec.separator, codec.terminator, ctx, [
        'messages',
        index,
      ]);
    }

    if (codec.session) {
      const ack = messageByName.get(codec.session.ackMessage);
      if (!ack) {
        ctx.addIssue({
          code: 'custom',
          path: ['session', 'ackMessage'],
          message: `ACK 报文 ${codec.session.ackMessage} 不存在`,
        });
      } else {
        const ackFields = new Set(
          ack.slots.flatMap((slot) =>
            slot.kind === 'field' ? [textFieldName(slot)] : [],
          ),
        );
        if (!ackFields.has(codec.session.statusField)) {
          ctx.addIssue({
            code: 'custom',
            path: ['session', 'statusField'],
            message: `ACK 报文缺少状态字段 ${codec.session.statusField}`,
          });
        }
      }
      for (let index = 0; index < codec.session.trackMessages.length; index += 1) {
        const tracked = messageByName.get(codec.session.trackMessages[index]!);
        if (!tracked) {
          ctx.addIssue({
            code: 'custom',
            path: ['session', 'trackMessages', index],
            message: `跟踪报文 ${codec.session.trackMessages[index]} 不存在`,
          });
          continue;
        }
        const trackedFields = new Set(
          tracked.slots.flatMap((slot) =>
            slot.kind === 'field' ? [textFieldName(slot)] : [],
          ),
        );
        if (!trackedFields.has(codec.session.sequenceField)) {
          ctx.addIssue({
            code: 'custom',
            path: ['session', 'sequenceField'],
            message: `跟踪报文缺少流水号字段 ${codec.session.sequenceField}`,
          });
        }
      }
    }
  });

export type TextCodecConfig = z.infer<typeof TextCodecSchema>;

export const CodecSchema = z.discriminatedUnion('type', [
  RawCodecSchema,
  FieldsCodecSchema,
  TextCodecSchema,
]);

export const OutgoingMessageSchema = z
  .object({
    fields: z.record(z.string(), z.unknown()).optional(),
    hex: z
      .string()
      .regex(/^(?:[0-9a-fA-F]{2})*$/, 'hex 必须是偶数位十六进制字符串')
      .optional(),
  })
  .refine((message) => (message.fields !== undefined ? 1 : 0) + (message.hex !== undefined ? 1 : 0) === 1, {
    message: 'send 必须且只能包含 fields 或 hex 之一',
  });

export const MatchValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ $in: z.array(z.unknown()) }),
  z.object({ $ne: z.unknown() }),
  z.object({ $exists: z.boolean() }),
  z.object({ $regex: z.string() }),
]);
export type MatchValue = z.infer<typeof MatchValueSchema>;

export const RuleSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    enabled: z.boolean().default(true),
    on: z.enum(['start', 'connect', 'frame']).optional(),
    match: z.record(z.string(), MatchValueSchema).optional(),
    topicFilter: z
      .string()
      .min(1)
      .refine(isValidMqttTopicFilter, 'MQTT 主题过滤器中的 + 和 # 用法无效')
      .optional(),
    publishTopic: z
      .string()
      .min(1)
      .optional(),
    every: z.number().int().min(10).optional(),
    jitter: z.number().int().min(0).default(0),
    target: z.enum(['all', 'last']).default('all'),
    set: z.record(z.string(), z.unknown()).optional(),
    send: z.union([OutgoingMessageSchema, z.array(OutgoingMessageSchema)]).optional(),
    disconnect: z.boolean().default(false),
  })
  .superRefine((rule, ctx) => {
    if (rule.every !== undefined && rule.match !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'every 与 match 不能同时使用：周期规则请用 on: frame 显式声明请求响应',
        path: ['match'],
      });
    }
    if (rule.every === undefined && rule.on === undefined && rule.match === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: '规则必须指定触发条件：every、on 或 match',
        path: ['on'],
      });
    }
    if (rule.on === 'connect' && rule.match !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'on: connect 规则不能使用 match',
        path: ['match'],
      });
    }
    if (
      rule.topicFilter !== undefined &&
      (rule.every !== undefined || (rule.on !== undefined && rule.on !== 'frame'))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['topicFilter'],
        message: '主题过滤条件仅适用于收到 MQTT 消息时触发的规则',
      });
    }
  });

export const DeviceInfoSchema = z.object({
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  hardwareVersion: z.string().optional(),
  firmwareVersion: z.string().optional(),
  tnsImei: z.string().optional(),
});

export const DeviceConfigSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_-]+$/, 'id 只能包含字母、数字、下划线和中划线'),
  name: z.string().min(1),
  description: z.string().optional(),
  deviceInfo: DeviceInfoSchema.optional(),
  transport: TransportSchema,
  framing: FramingSchema.default({ type: 'raw' }),
  codec: CodecSchema.default({ type: 'raw', display: 'hex' }),
  state: z.record(z.string(), z.unknown()).default({}),
  rules: z.array(RuleSchema).default([]),
  autoStart: z.boolean().default(false),
}).superRefine((config, ctx) => {
  const isMqtt =
    config.transport.type === 'mqtt-client' ||
    config.transport.type === 'mqtt-broker';
  if (isMqtt) return;

  config.rules.forEach((rule, index) => {
    if (rule.topicFilter !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rules', index, 'topicFilter'],
        message: '主题过滤条件仅适用于 MQTT 传输',
      });
    }
    if (rule.publishTopic !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rules', index, 'publishTopic'],
        message: '规则发布主题仅适用于 MQTT 传输',
      });
    }
  });
});

export type TcpServerTransport = z.infer<typeof TcpServerTransportSchema>;
export type TcpClientTransport = z.infer<typeof TcpClientTransportSchema>;
export type MqttClientTransport = z.infer<typeof MqttClientTransportSchema>;
export type MqttBrokerTransport = z.infer<typeof MqttBrokerTransportSchema>;
export type MqttSubscription = z.infer<typeof MqttSubscriptionSchema>;
export type MqttQos = z.infer<typeof MqttQosSchema>;
export type ReconnectConfig = z.infer<typeof ReconnectConfigSchema>;
export type TransportConfig = z.infer<typeof TransportSchema>;
export type FramingConfig = z.infer<typeof FramingSchema>;
export type FieldDef = z.infer<typeof FieldSchema>;
export type CodecConfig = z.infer<typeof CodecSchema>;
export type OutgoingMessage = z.infer<typeof OutgoingMessageSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;
export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;
