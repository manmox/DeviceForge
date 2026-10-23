import { checksumSize, encodeChecksum, verifyChecksum } from '../checksum';
import type {
  CodecConfig,
  DeviceInfo,
  FieldDef,
  OutgoingMessage,
} from '../schema/device';
import type { DictionaryProvider } from '../dictionary/provider';
import type { ConnectionInfo, TrafficEvent } from '../types';
import { TextCodec } from './text';

export interface DecodeResult {
  fields: Record<string, unknown>;
  valid: boolean;
  error?: string;
  warnings?: string[];
}

export interface EncodeContext {
  state: Record<string, unknown>;
  counters: Record<string, number>;
  conn?: ConnectionInfo;
  req?: Record<string, unknown>;
  /** 设备信息，模板可用 $device.* 引用。 */
  device?: DeviceInfo;
  now: number;
}

/** prepareOutbound 的返回值；track 用于 ACK/重传会话。 */
export interface PreparedOutbound {
  message: OutgoingMessage;
  track?: {
    key: string;
    /** 流水号在 decoded.fields 中的字段名，runtime 用它校验实际发送的帧。 */
    field: string;
    timeoutMs: number;
    maxRetries: number;
  };
}

export interface InboundObservation {
  ackKey?: string;
  ackOk?: boolean;
}

export interface Codec {
  decode(frame: Buffer): DecodeResult;
  encode(message: OutgoingMessage, ctx: EncodeContext): Buffer;
  /** 在目标连接循环之前执行一次，用于固定协议流水号/时间戳。 */
  prepareOutbound?(
    message: OutgoingMessage,
    ctx: EncodeContext,
  ): PreparedOutbound;
  /** 帧解码成功后调用，用于识别 ACK 等协议状态。 */
  observeInbound?(
    fields: Record<string, unknown>,
  ): InboundObservation | undefined;
}

export interface CodecOptions {
  deviceInfo?: DeviceInfo;
  /** text codec 的 repeat 通过 ID 实时查询全局字典。 */
  dictionaries?: DictionaryProvider;
}

const FIXED_SIZES: Partial<Record<FieldDef['type'], number>> = {
  u8: 1,
  i8: 1,
  u16: 2,
  i16: 2,
  u24: 3,
  i24: 3,
  u32: 4,
  i32: 4,
  f32: 4,
  f64: 8,
};

function isNumeric(type: FieldDef['type']): boolean {
  return FIXED_SIZES[type] !== undefined;
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt8(offset) | (buffer.readUInt8(offset + 1) << 8) | (buffer.readUInt8(offset + 2) << 16);
}

function readNumeric(field: FieldDef, buffer: Buffer, offset: number): number {
  const endian = field.endian ?? 'be';
  switch (field.type) {
    case 'u8':
      return buffer.readUInt8(offset);
    case 'i8':
      return buffer.readInt8(offset);
    case 'u16':
      return endian === 'be' ? buffer.readUInt16BE(offset) : buffer.readUInt16LE(offset);
    case 'i16':
      return endian === 'be' ? buffer.readInt16BE(offset) : buffer.readInt16LE(offset);
    case 'u24':
      return endian === 'be' ? buffer.readUIntBE(offset, 3) : readUInt24LE(buffer, offset);
    case 'i24': {
      const raw = endian === 'be' ? buffer.readUIntBE(offset, 3) : readUInt24LE(buffer, offset);
      return raw >= 0x800000 ? raw - 0x1000000 : raw;
    }
    case 'u32':
      return endian === 'be' ? buffer.readUInt32BE(offset) : buffer.readUInt32LE(offset);
    case 'i32':
      return endian === 'be' ? buffer.readInt32BE(offset) : buffer.readInt32LE(offset);
    case 'f32':
      return endian === 'be' ? buffer.readFloatBE(offset) : buffer.readFloatLE(offset);
    case 'f64':
      return endian === 'be' ? buffer.readDoubleBE(offset) : buffer.readDoubleLE(offset);
    default:
      throw new Error(`字段 ${field.name} 不是数值类型`);
  }
}

function assertInteger(value: number, min: number, max: number, field: FieldDef): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`字段 ${field.name} 的值 ${value} 超出范围 [${min}, ${max}] 或不是整数`);
  }
}

function writeNumeric(field: FieldDef, value: number, buffer: Buffer, offset: number): void {
  const endian = field.endian ?? 'be';
  switch (field.type) {
    case 'u8':
      assertInteger(value, 0, 0xff, field);
      buffer.writeUInt8(value, offset);
      break;
    case 'i8':
      assertInteger(value, -0x80, 0x7f, field);
      buffer.writeInt8(value, offset);
      break;
    case 'u16':
      assertInteger(value, 0, 0xffff, field);
      if (endian === 'be') buffer.writeUInt16BE(value, offset);
      else buffer.writeUInt16LE(value, offset);
      break;
    case 'i16':
      assertInteger(value, -0x8000, 0x7fff, field);
      if (endian === 'be') buffer.writeInt16BE(value, offset);
      else buffer.writeInt16LE(value, offset);
      break;
    case 'u24':
      assertInteger(value, 0, 0xffffff, field);
      if (endian === 'be') buffer.writeUIntBE(value, offset, 3);
      else {
        buffer.writeUInt8(value & 0xff, offset);
        buffer.writeUInt8((value >>> 8) & 0xff, offset + 1);
        buffer.writeUInt8((value >>> 16) & 0xff, offset + 2);
      }
      break;
    case 'i24': {
      assertInteger(value, -0x800000, 0x7fffff, field);
      const raw = value < 0 ? value + 0x1000000 : value;
      if (endian === 'be') buffer.writeUIntBE(raw, offset, 3);
      else {
        buffer.writeUInt8(raw & 0xff, offset);
        buffer.writeUInt8((raw >>> 8) & 0xff, offset + 1);
        buffer.writeUInt8((raw >>> 16) & 0xff, offset + 2);
      }
      break;
    }
    case 'u32':
      assertInteger(value, 0, 0xffffffff, field);
      if (endian === 'be') buffer.writeUInt32BE(value, offset);
      else buffer.writeUInt32LE(value, offset);
      break;
    case 'i32':
      assertInteger(value, -0x80000000, 0x7fffffff, field);
      if (endian === 'be') buffer.writeInt32BE(value, offset);
      else buffer.writeInt32LE(value, offset);
      break;
    case 'f32':
      if (!Number.isFinite(value)) throw new Error(`字段 ${field.name} 必须是有限数值`);
      if (endian === 'be') buffer.writeFloatBE(value, offset);
      else buffer.writeFloatLE(value, offset);
      break;
    case 'f64':
      if (!Number.isFinite(value)) throw new Error(`字段 ${field.name} 必须是有限数值`);
      if (endian === 'be') buffer.writeDoubleBE(value, offset);
      else buffer.writeDoubleLE(value, offset);
      break;
    default:
      throw new Error(`字段 ${field.name} 不是数值类型`);
  }
}

function toRawNumber(field: FieldDef, value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'boolean'
        ? value
          ? 1
          : 0
        : Number(value);

  if (!Number.isFinite(numeric)) {
    throw new Error(`字段 ${field.name} 需要数值，收到 ${JSON.stringify(value)}`);
  }

  if (field.scale !== undefined) {
    if (field.scale === 0) throw new Error(`字段 ${field.name} 的 scale 不能为 0`);
    const scaled = numeric / field.scale;
    if (!Number.isFinite(scaled)) throw new Error(`字段 ${field.name} 的 scale 计算结果无效`);
    return field.type === 'f32' || field.type === 'f64' ? scaled : Math.round(scaled);
  }

  if (field.type === 'f32' || field.type === 'f64') return numeric;
  if (!Number.isInteger(numeric)) {
    throw new Error(`字段 ${field.name} 需要整数，收到 ${numeric}（可配置 scale）`);
  }
  return numeric;
}

function fixedSizeOf(field: FieldDef): number | undefined {
  if (isNumeric(field.type)) return FIXED_SIZES[field.type];
  if (field.length === undefined) return undefined;
  if (typeof field.length === 'number') return field.length;
  return undefined;
}

function fieldSizeForDecode(
  field: FieldDef,
  fields: Record<string, unknown>,
  laterFields: FieldDef[],
  remainingBytes: number,
): number {
  const fixed = fixedSizeOf(field);
  if (fixed !== undefined) return fixed;

  if (field.length === undefined) {
    throw new Error(`字段 ${field.name} 缺少长度定义`);
  }
  if (typeof field.length === 'number') return field.length;
  if (field.length === 'remaining') {
    // 校验和尾部已由 payloadEnd 排除；这里只需为后续字段预留固定长度。
    let reserved = 0;
    for (const later of laterFields) {
      const size = fixedSizeOf(later);
      if (size === undefined) {
        throw new Error(`remaining 字段 ${field.name} 之后存在动态长度字段 ${later.name}`);
      }
      reserved += size;
    }
    const size = remainingBytes - reserved;
    if (size < 0) throw new Error(`字段 ${field.name} 的 remaining 长度为负数`);
    return size;
  }

  const referenced = fields[field.length.fromField];
  if (typeof referenced !== 'number' || !Number.isInteger(referenced) || referenced < 0) {
    throw new Error(`字段 ${field.name} 引用的长度字段 ${field.length.fromField} 尚未解析或不是非负整数`);
  }
  return referenced;
}

function decodeBcd(buffer: Buffer): string {
  let result = '';
  for (const byte of buffer) {
    const high = byte >> 4;
    const low = byte & 0x0f;
    if (high > 9 || low > 9) throw new Error('BCD 字段包含非法半字节');
    result += `${high}${low}`;
  }
  return result;
}

function encodeBcd(value: unknown, targetLength: number | undefined, fieldName: string): Buffer {
  let digits = String(value).replace(/[^0-9]/g, '');
  if (digits.length === 0) throw new Error(`BCD 字段 ${fieldName} 没有有效数字`);

  if (targetLength !== undefined) {
    const wantedDigits = targetLength * 2;
    if (digits.length > wantedDigits) {
      throw new Error(`BCD 字段 ${fieldName} 需要 ${wantedDigits} 位数字，收到 ${digits.length} 位`);
    }
    digits = digits.padStart(wantedDigits, '0');
  } else if (digits.length % 2 === 1) {
    digits = `0${digits}`;
  }

  const output = Buffer.alloc(digits.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    const high = digits.charCodeAt(index * 2) - 48;
    const low = digits.charCodeAt(index * 2 + 1) - 48;
    output.writeUInt8((high << 4) | low, index);
  }
  return output;
}

function bytesFromValue(value: unknown, field: FieldDef): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) {
    if (!value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      throw new Error(`字段 ${field.name} 的字节数组包含非法值`);
    }
    return Buffer.from(value as number[]);
  }
  if (typeof value === 'string') {
    const hex = value.replace(/\s+/g, '');
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
      throw new Error(`字段 ${field.name} 需要十六进制字符串（偶数位），收到 "${value}"`);
    }
    return Buffer.from(hex, 'hex');
  }
  throw new Error(`字段 ${field.name} 需要十六进制字符串或字节数组`);
}

function padTarget(buffer: Buffer, target: number, fieldName: string, align: 'left' | 'right'): Buffer {
  if (buffer.length > target) {
    throw new Error(`字段 ${fieldName} 编码后 ${buffer.length} 字节，超过固定长度 ${target}`);
  }
  if (buffer.length === target) return buffer;
  const padding = Buffer.alloc(target - buffer.length);
  return align === 'left' ? Buffer.concat([padding, buffer]) : Buffer.concat([buffer, padding]);
}

function resolveTargetLength(
  field: FieldDef,
  values: Record<string, unknown>,
  provided: Record<string, unknown>,
): number | undefined {
  if (field.length === undefined || field.length === 'remaining') return undefined;
  if (typeof field.length === 'number') return field.length;
  const referenced = values[field.length.fromField] ?? provided[field.length.fromField];
  if (typeof referenced !== 'number' || !Number.isInteger(referenced) || referenced < 0) {
    throw new Error(`字段 ${field.name} 引用的长度字段 ${field.length.fromField} 缺失或不是非负整数`);
  }
  return referenced;
}

class RawCodec implements Codec {
  constructor(private readonly display: 'hex' | 'ascii') {}

  decode(frame: Buffer): DecodeResult {
    const fields: Record<string, unknown> = {
      hex: frame.toString('hex'),
      ascii: frame
        .toString('latin1')
        .replace(/[^\x20-\x7e]/g, '.'),
      length: frame.length,
    };
    return { fields, valid: true };
  }

  encode(message: OutgoingMessage): Buffer {
    if (message.hex !== undefined) return Buffer.from(message.hex, 'hex');
    const fields = message.fields ?? {};
    if (typeof fields.hex === 'string') {
      const hex = fields.hex.replace(/\s+/g, '');
      if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
        throw new Error('raw codec 的 fields.hex 必须是偶数位十六进制');
      }
      return Buffer.from(hex, 'hex');
    }
    if (typeof fields.text === 'string') return Buffer.from(fields.text, 'utf8');
    if (Array.isArray(fields.data)) {
      if (!fields.data.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
        throw new Error('raw codec 的 fields.data 必须是 0-255 的整数数组');
      }
      return Buffer.from(fields.data as number[]);
    }
    throw new Error('raw codec 需要 fields.hex、fields.text 或 fields.data');
  }
}

class FieldsCodec implements Codec {
  constructor(private readonly config: Extract<CodecConfig, { type: 'fields' }>) {}

  decode(frame: Buffer): DecodeResult {
    const checksumBytes = this.config.checksum ? checksumSize(this.config.checksum.algo) : 0;
    if (frame.length < checksumBytes) {
      return { fields: {}, valid: false, error: '帧长度小于校验字段长度' };
    }

    // 解析字段前先预留校验和尾部，确保长度字段和 remaining 不会把校验和
    // 算进载荷。
    const payloadEnd = frame.length - checksumBytes;
    const fields: Record<string, unknown> = {};
    const warnings: string[] = [];
    let offset = 0;

    try {
      for (let index = 0; index < this.config.fields.length; index += 1) {
        const field = this.config.fields[index]!;
        const remaining = payloadEnd - offset;
        const size = fieldSizeForDecode(field, fields, this.config.fields.slice(index + 1), remaining);
        if (size < 0 || offset + size > payloadEnd) {
          throw new Error(`字段 ${field.name} 需要 ${size} 字节，但帧内只剩 ${remaining} 字节`);
        }

        let value: unknown;
        if (isNumeric(field.type)) {
          const raw = readNumeric(field, frame, offset);
          value = field.scale !== undefined ? raw * field.scale : raw;
        } else if (field.type === 'bytes') {
          value = frame.subarray(offset, offset + size).toString('hex');
        } else if (field.type === 'string') {
          const slice = frame.subarray(offset, offset + size);
          const encoding = field.encoding ?? 'utf8';
          value = encoding === 'hex' ? slice.toString('hex') : slice.toString(encoding);
        } else {
          value = decodeBcd(frame.subarray(offset, offset + size));
        }

        if (field.const !== undefined) {
          const expected = field.type === 'bytes' ? String(field.const).replace(/\s+/g, '').toLowerCase() : String(field.const);
          const actual = typeof value === 'string' ? (field.type === 'bytes' ? value.toLowerCase() : value) : String(value);
          if (actual !== expected) {
            warnings.push(`字段 ${field.name} 的常量不匹配：期望 ${expected}，实际 ${actual}`);
          }
        }

        fields[field.name] = value;
        offset += size;
      }

      if (offset < payloadEnd) {
        warnings.push(`帧尾部有 ${payloadEnd - offset} 字节未解析`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { fields, valid: false, error: message };
    }

    let valid = true;
    let error: string | undefined;
    if (this.config.checksum) {
      const result = verifyChecksum(this.config.checksum.algo, frame, this.config.checksum.endian);
      fields._checksum = result.actual;
      fields._checksumValid = result.valid;
      // 只有启用 verify 的校验和不匹配才会让整帧无效；常量不匹配和尾部
      // 多余字节只记 warning，规则仍可执行。
      if (!result.valid) {
        const message = `校验失败：期望 0x${result.expected.toString(16)}，实际 0x${result.actual.toString(16)}`;
        if (this.config.checksum.verify) {
          valid = false;
          error = message;
        } else {
          warnings.push(message);
        }
      }
    }

    if (warnings.length > 0) fields._warnings = warnings;
    return { fields, valid, error, warnings: warnings.length > 0 ? warnings : undefined };
  }

  encode(message: OutgoingMessage): Buffer {
    if (message.hex !== undefined) return Buffer.from(message.hex, 'hex');

    const provided = message.fields ?? {};
    const checksumBytes = this.config.checksum ? checksumSize(this.config.checksum.algo) : 0;
    const chunks: { field: FieldDef; buffer: Buffer; offset: number }[] = [];
    const values: Record<string, unknown> = {};
    let offset = 0;

    for (const field of this.config.fields) {
      let value = provided[field.name];
      if (value === undefined) value = field.const;

      if (field.calc !== undefined) {
        const size = FIXED_SIZES[field.type];
        if (size === undefined) throw new Error(`calc 字段 ${field.name} 必须是数值类型`);
        const buffer = Buffer.alloc(size);
        chunks.push({ field, buffer, offset });
        values[field.name] = 0;
        offset += size;
        continue;
      }

      if (value === undefined) {
        throw new Error(`缺少字段 ${field.name} 的值`);
      }

      let buffer: Buffer;
      if (isNumeric(field.type)) {
        buffer = Buffer.alloc(FIXED_SIZES[field.type]!);
        writeNumeric(field, toRawNumber(field, value), buffer, 0);
      } else if (field.type === 'string') {
        const encoding = field.encoding ?? 'utf8';
        buffer = Buffer.from(String(value), encoding === 'hex' ? 'hex' : encoding);
        const target = resolveTargetLength(field, values, provided);
        if (target !== undefined) buffer = padTarget(buffer, target, field.name, 'right');
      } else if (field.type === 'bcd') {
        const target = resolveTargetLength(field, values, provided);
        buffer = encodeBcd(value, target, field.name);
      } else {
        buffer = bytesFromValue(value, field);
        const target = resolveTargetLength(field, values, provided);
        if (target !== undefined) buffer = padTarget(buffer, target, field.name, 'right');
      }

      chunks.push({ field, buffer, offset });
      values[field.name] = value;
      offset += buffer.length;
    }

    // calc 字段先填零占位，因为值依赖最终布局。totalLength 包含尾部校验和，
    // 而校验和只覆盖 body，并在该阶段之后追加。
    const total = offset + checksumBytes;
    for (const chunk of chunks) {
      if (chunk.field.calc === undefined) continue;
      const calculated = chunk.field.calc === 'totalLength' ? total : total - (chunk.offset + chunk.buffer.length);
      writeNumeric(chunk.field, calculated, chunk.buffer, 0);
      values[chunk.field.name] = calculated;
    }

    const body = Buffer.concat(chunks.map((chunk) => chunk.buffer));
    if (!this.config.checksum) return body;
    const checksum = encodeChecksum(this.config.checksum.algo, body, this.config.checksum.endian);
    return Buffer.concat([body, checksum]);
  }
}

export function createCodec(
  config: CodecConfig,
  options: CodecOptions = {},
): Codec {
  switch (config.type) {
    case 'raw':
      return new RawCodec(config.display);
    case 'fields':
      return new FieldsCodec(config);
    case 'text':
      return new TextCodec(config, options);
  }
}

/** 仅用于出站帧展示的容错解码。 */
export function tryDecode(codec: Codec, frame: Buffer): DecodeResult | undefined {
  try {
    return codec.decode(frame);
  } catch {
    return undefined;
  }
}

export function trafficDecoded(result: DecodeResult | undefined): TrafficEvent['decoded'] {
  return result?.fields;
}
