import { z } from 'zod';

export const EndianSchema = z.enum(['be', 'le']);
export type Endian = z.infer<typeof EndianSchema>;

const HostSchema = z.string().min(1).default('127.0.0.1');
const PortSchema = z.number().int().min(0).max(65535);

export const TcpServerTransportSchema = z.object({
  type: z.literal('tcp-server'),
  host: HostSchema,
  port: PortSchema,
});

export const TransportSchema = z.discriminatedUnion('type', [TcpServerTransportSchema]);

export const LengthFieldSchema = z.object({
  offset: z.number().int().min(0).default(0),
  size: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  endian: EndianSchema.default('be'),
  adjust: z.number().int().default(0),
});

export const FramingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('raw'),
  }),
  z.object({
    type: z.literal('delimiter'),
    delimiter: z
      .string()
      .regex(/^(?:[0-9a-fA-F]{2})+$/, 'delimiter 必须是不含空格的偶数位十六进制，例如 "0D0A"'),
    includeDelimiter: z.boolean().default(false),
  }),
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

export const CodecSchema = z.discriminatedUnion('type', [RawCodecSchema, FieldsCodecSchema]);

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
  });

export const DeviceConfigSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_-]+$/, 'id 只能包含字母、数字、下划线和中划线'),
  name: z.string().min(1),
  description: z.string().optional(),
  transport: TransportSchema,
  framing: FramingSchema.default({ type: 'raw' }),
  codec: CodecSchema.default({ type: 'raw', display: 'hex' }),
  state: z.record(z.string(), z.unknown()).default({}),
  rules: z.array(RuleSchema).default([]),
  autoStart: z.boolean().default(false),
});

export type TcpServerTransport = z.infer<typeof TcpServerTransportSchema>;
export type TransportConfig = z.infer<typeof TransportSchema>;
export type FramingConfig = z.infer<typeof FramingSchema>;
export type FieldDef = z.infer<typeof FieldSchema>;
export type CodecConfig = z.infer<typeof CodecSchema>;
export type OutgoingMessage = z.infer<typeof OutgoingMessageSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;
