import type {
  OutgoingMessage,
  TextCodecConfig,
  TextDictionaryEntry,
  TextField,
  TextMessage,
  TextRepeat,
  TextSlot,
} from '../schema/device';
import type {
  EncodeContext,
  PreparedOutbound,
} from './index';
import { formatTextTimestamp } from './text-time';
import { encodeInt16ArrayValue } from './text-waveform';

const INT_PATTERN = /^[+-]?\d+$/;
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export interface TextSequenceAllocator {
  allocate(field: TextField): number;
  reserve(field: TextField, value: unknown): void;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value ?? '');
}

function selectMessage(
  fields: Record<string, unknown>,
  config: TextCodecConfig,
): TextMessage | undefined {
  const kind = fields.kind;
  if (typeof kind === 'string') {
    return config.messages.find((message) => message.name === kind);
  }
  if (config.messages.length === 1) return config.messages[0];
  return undefined;
}

function messageList(config: TextCodecConfig): string {
  return config.messages.map((message) => message.name).join(', ');
}

function fallbackValue(
  field: TextField,
  ctx: EncodeContext,
): unknown {
  if (field.default !== undefined) return field.default;
  if (field.defaultFrom !== undefined) return ctx.device?.[field.defaultFrom];
  return undefined;
}

function padToken(field: TextField, value: string): string {
  if (field.width === undefined) return value;
  if (value.length > field.width) {
    throw new Error(
      `字段 ${field.name} 编码后 ${value.length} 位，超过 width ${field.width}`,
    );
  }
  if (value.length === field.width) return value;
  const pad = field.padChar ?? '0';
  return field.pad === 'right'
    ? value.padEnd(field.width, pad)
    : value.padStart(field.width, pad);
}

function checkEncodePattern(field: TextField, value: string): void {
  if (!field.pattern || field.patternSeverity === 'warning') return;
  let pattern: RegExp;
  try {
    pattern = new RegExp(field.pattern);
  } catch {
    throw new Error(`字段 ${field.name} 的 pattern 无效`);
  }
  if (!pattern.test(value)) {
    throw new Error(
      `字段 ${field.name} 的值 ${JSON.stringify(value)} 不符合格式 ${field.pattern}`,
    );
  }
}

function renderFieldToken(
  field: TextField,
  value: unknown,
  ctx: EncodeContext,
  config: TextCodecConfig,
  valueSeparator = '|',
): string {
  let text: string;

  switch (field.type) {
    case 'int': {
      const numeric =
        typeof value === 'number' ? value : Number(textOf(value));
      if (!Number.isSafeInteger(numeric)) {
        throw new Error(`字段 ${field.name} 需要整数，收到 ${JSON.stringify(value)}`);
      }
      text = String(numeric);
      break;
    }
    case 'decimal': {
      text = textOf(value);
      if (!DECIMAL_PATTERN.test(text)) {
        throw new Error(`字段 ${field.name} 需要数值，收到 ${JSON.stringify(value)}`);
      }
      break;
    }
    case 'timestamp':
      text = textOf(value);
      break;
    case 'stringList': {
      const values = Array.isArray(value)
        ? value.map(textOf)
        : textOf(value).split(field.valueSeparator ?? valueSeparator);
      if (values.length === 0 && !field.allowEmpty) {
        throw new Error(`字段 ${field.name} 不能为空`);
      }
      for (const item of values) {
        if (item.includes(field.valueSeparator ?? valueSeparator)) {
          throw new Error(
            `字段 ${field.name} 的值 ${JSON.stringify(item)} 包含列表分隔符`,
          );
        }
        if (item === '' && !field.allowEmpty) {
          throw new Error(`字段 ${field.name} 包含空值`);
        }
      }
      text = values.join(field.valueSeparator ?? valueSeparator);
      break;
    }
    case 'string':
      text = textOf(value);
      break;
    case 'int16Array':
      throw new Error(
        `字段 ${field.name} 是 int16Array；波形值必须通过字典 valueFormat 编码`,
      );
  }

  if (text === '' && !field.allowEmpty) {
    throw new Error(`字段 ${field.name} 不能为空`);
  }
  checkEncodePattern(field, text);
  return padToken(field, text);
}

function dictionaryEntryForItem(
  repeat: TextRepeat,
  item: Record<string, unknown>,
  config: TextCodecConfig,
): TextDictionaryEntry | undefined {
  if (!repeat.dictionary || !repeat.keyField) return undefined;
  const key = item[repeat.keyField];
  if (key === undefined || key === null) return undefined;
  return config.dictionaries?.[repeat.dictionary]?.[textOf(key)];
}

function renderRepeatItem(
  repeat: TextRepeat,
  item: unknown,
  index: number,
  ctx: EncodeContext,
  config: TextCodecConfig,
): string {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`repeat ${repeat.name} 第 ${index + 1} 组必须是对象`);
  }
  const record = item as Record<string, unknown>;
  const entry = dictionaryEntryForItem(repeat, record, config);
  const parts: string[] = [];

  for (const field of repeat.fields) {
    let value = record[field.name];
    if (value === undefined) value = fallbackValue(field, ctx);

    if (
      field.name === repeat.valueField &&
      entry?.valueFormat &&
      (value !== undefined || Array.isArray(record.waveform))
    ) {
      if (typeof value === 'string') {
        parts.push(value);
        continue;
      }
      const waveform = record.waveform;
      const points = Array.isArray(waveform) ? waveform : value;
      if (!Array.isArray(points)) {
        throw new Error(
          `repeat ${repeat.name} 第 ${index + 1} 组的 ${field.name} 需要波形数组`,
        );
      }
      parts.push(encodeInt16ArrayValue(points, entry.valueFormat));
      continue;
    }

    if (value === undefined || value === null) {
      throw new Error(
        `repeat ${repeat.name} 第 ${index + 1} 组缺少字段 ${field.name}`,
      );
    }
    parts.push(
      renderFieldToken(
        field,
        value,
        ctx,
        config,
        field.valueSeparator ?? repeat.valueSeparator,
      ),
    );
  }

  const token = parts.join(repeat.itemSeparator);
  if (token.includes(repeat.itemSeparator)) {
    // 上面的 join 必然包含 itemSeparator；这里只检查字段值本身是否引入
    // 额外分隔符，避免把两个字段错误地合成更多字段。
    for (let fieldIndex = 0; fieldIndex < repeat.fields.length; fieldIndex += 1) {
      if (parts[fieldIndex]!.includes(repeat.itemSeparator)) {
        throw new Error(
          `repeat ${repeat.name} 第 ${index + 1} 组字段 ${repeat.fields[fieldIndex]!.name} 包含 itemSeparator`,
        );
      }
    }
  }
  return token;
}

export function prepareTextMessage(
  message: OutgoingMessage,
  ctx: EncodeContext,
  config: TextCodecConfig,
  sequences: TextSequenceAllocator,
): PreparedOutbound {
  if (message.hex !== undefined) return { message };
  const originalFields = message.fields ?? {};
  const selected = selectMessage(originalFields, config);
  if (!selected) return { message };

  const fields = { ...originalFields };
  let changed = false;

  for (const slot of selected.slots) {
    if (slot.kind !== 'field') continue;
    const value = fields[slot.name];

    if (slot.auto === 'timestamp') {
      if (value === null) continue;
      if (value === undefined) {
        fields[slot.name] = formatTextTimestamp(
          ctx.now,
          config.timezone,
          slot.format!,
        );
        changed = true;
      }
      continue;
    }

    if (slot.auto === 'sequence') {
      if (value === null) continue;
      if (value === undefined) {
        fields[slot.name] = String(sequences.allocate(slot));
        changed = true;
      } else {
        sequences.reserve(slot, value);
      }
      continue;
    }

    if (value === undefined && !slot.optional) {
      const fallback = fallbackValue(slot, ctx);
      if (fallback !== undefined) {
        fields[slot.name] = fallback;
        changed = true;
      }
    }
  }

  const result: PreparedOutbound = {
    message: changed ? { fields } : message,
  };

  const session = config.session;
  if (
    session &&
    session.trackMessages.includes(selected.name) &&
    fields[session.sequenceField] !== undefined &&
    fields[session.sequenceField] !== null
  ) {
    let key = textOf(fields[session.sequenceField]);
    const sequenceSlot = selected.slots.find(
      (slot) => slot.kind === 'field' && slot.name === session.sequenceField,
    );
    if (
      sequenceSlot?.kind === 'field' &&
      sequenceSlot.type === 'int' &&
      /^[+-]?\d+$/.test(key)
    ) {
      const numeric = Number(key);
      if (Number.isSafeInteger(numeric)) key = String(numeric);
    }
    if (key !== '') {
      result.track = {
        key,
        field: session.sequenceField,
        timeoutMs: session.timeoutMs,
        maxRetries: session.maxRetries,
      };
    }
  }

  return result;
}

function renderSlot(
  slot: TextSlot,
  fields: Record<string, unknown>,
  ctx: EncodeContext,
  config: TextCodecConfig,
  sequences: TextSequenceAllocator,
): string[] {
  if (slot.kind === 'literal') return [slot.value];

  if (slot.kind === 'repeat') {
    const raw = fields[slot.name];
    if (!Array.isArray(raw)) {
      throw new Error(`repeat ${slot.name} 需要数组`);
    }
    fields[slot.countField] = raw.length;
    return raw.map((item, index) =>
      renderRepeatItem(slot, item, index, ctx, config),
    );
  }

  let value = fields[slot.name];
  if (slot.optional) {
    if (value === null) return [];
    if (value === undefined) {
      if (slot.auto === 'timestamp') {
        value = formatTextTimestamp(ctx.now, config.timezone, slot.format!);
      } else if (slot.auto === 'sequence') {
        value = String(sequences.allocate(slot));
      } else {
        return [];
      }
    }
  } else {
    if (value === undefined) {
      if (slot.auto === 'timestamp') {
        value = formatTextTimestamp(ctx.now, config.timezone, slot.format!);
      } else if (slot.auto === 'sequence') {
        value = String(sequences.allocate(slot));
      } else {
        value = fallbackValue(slot, ctx);
      }
    }
    if (value === undefined || value === null) {
      throw new Error(`缺少字段 ${slot.name}`);
    }
  }

  return [renderFieldToken(slot, value, ctx, config, '|')];
}

export function encodeTextMessage(
  message: OutgoingMessage,
  ctx: EncodeContext,
  config: TextCodecConfig,
  sequences: TextSequenceAllocator,
): Buffer {
  if (message.hex !== undefined) return Buffer.from(message.hex, 'hex');

  const fields = { ...(message.fields ?? {}) };
  const selected = selectMessage(fields, config);
  if (!selected) {
    if (fields.kind !== undefined) {
      throw new Error(`未知报文类型 ${JSON.stringify(fields.kind)}；可选：${messageList(config)}`);
    }
    throw new Error(`报文类型缺失；可选：${messageList(config)}`);
  }

  // countField 可能出现在 repeat 之前，必须在渲染任何槽位之前写入组数。
  for (const slot of selected.slots) {
    if (slot.kind !== 'repeat') continue;
    const items = fields[slot.name];
    if (!Array.isArray(items)) {
      throw new Error(`repeat ${slot.name} 需要数组`);
    }
    fields[slot.countField] = items.length;
  }

  const tokens: string[] = [];
  if (selected.prefix !== undefined) tokens.push(selected.prefix);
  for (const slot of selected.slots) {
    tokens.push(...renderSlot(slot, fields, ctx, config, sequences));
  }
  if (selected.suffix !== undefined) tokens.push(selected.suffix);

  for (const token of tokens) {
    if (token.includes(config.separator)) {
      throw new Error(
        `字段值 ${JSON.stringify(token)} 包含顶层分隔符 ${JSON.stringify(config.separator)}`,
      );
    }
    if (token.includes(config.terminator)) {
      throw new Error(`字段值 ${JSON.stringify(token)} 包含结束符`);
    }
  }

  return Buffer.from(tokens.join(config.separator) + config.terminator, 'utf8');
}
