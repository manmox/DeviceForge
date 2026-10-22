import type {
  TextCodecConfig,
  TextDictionaryEntry,
  TextField,
  TextMessage,
  TextRepeat,
  TextSlot,
  TextValueFormat,
} from '../schema/device';
import type { DecodeResult } from './index';
import {
  parseInt16ArrayValue,
  waveformSummary,
  type TextWaveform,
} from './text-waveform';

class TextParseError extends Error {}

const MAX_TOKENS = 4096;
const INT_PATTERN = /^[+-]?\d+$/;
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function fail(error: string): DecodeResult {
  return { fields: {}, valid: false, error };
}

function stripTerminator(frame: Buffer, terminator: string): Buffer {
  const suffix = Buffer.from(terminator, 'utf8');
  if (suffix.length > 0 && frame.length >= suffix.length) {
    if (frame.subarray(frame.length - suffix.length).equals(suffix)) {
      return frame.subarray(0, frame.length - suffix.length);
    }
  }
  return frame;
}

function normalizeToken(value: string, trim: boolean): string {
  return trim ? value.trim() : value;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value ?? '');
}

function checkPattern(
  field: TextField,
  raw: string,
  warnings: string[],
): void {
  if (!field.pattern) return;
  let pattern: RegExp;
  try {
    pattern = new RegExp(field.pattern);
  } catch {
    throw new TextParseError(`字段 ${field.name} 的 pattern 无效`);
  }
  if (pattern.test(raw)) return;

  const message = `字段 ${field.name} 的值 ${JSON.stringify(raw)} 不符合格式 ${field.pattern}`;
  if (field.patternSeverity === 'warning') warnings.push(message);
  else throw new TextParseError(message);
}

function checkWidth(field: TextField, raw: string): void {
  if (field.width !== undefined && raw.length !== field.width) {
    throw new TextParseError(
      `字段 ${field.name} 需要 ${field.width} 位，实际 ${raw.length} 位`,
    );
  }
}

function parseStringList(
  raw: string,
  field: TextField,
  separator: string,
  trim: boolean,
): string[] {
  if (raw === '') {
    if (field.allowEmpty) return [];
    throw new TextParseError(`字段 ${field.name} 不能为空`);
  }
  const values = raw.split(separator).map((value) => (trim ? value.trim() : value));
  if (values.some((value) => value === '')) {
    throw new TextParseError(`字段 ${field.name} 包含空值`);
  }
  return values;
}

function parseFieldValue(
  rawValue: string,
  field: TextField,
  separator: string,
  trim: boolean,
): unknown {
  const raw = normalizeToken(rawValue, false);
  if (raw === '' && !field.allowEmpty) {
    throw new TextParseError(`字段 ${field.name} 不能为空`);
  }
  checkWidth(field, raw);

  let value: unknown;
  switch (field.type) {
    case 'int': {
      if (!INT_PATTERN.test(raw)) {
        throw new TextParseError(`字段 ${field.name} 不是整数：${raw}`);
      }
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed)) {
        throw new TextParseError(`字段 ${field.name} 超出安全整数范围`);
      }
      value = parsed;
      break;
    }
    case 'decimal':
      if (!DECIMAL_PATTERN.test(raw)) {
        throw new TextParseError(`字段 ${field.name} 不是数值：${raw}`);
      }
      value = raw;
      break;
    case 'stringList':
      value = parseStringList(raw, field, field.valueSeparator ?? separator, trim);
      break;
    case 'string':
    case 'timestamp':
      value = raw;
      break;
    case 'int16Array':
      throw new TextParseError(
        `字段 ${field.name} 是 int16Array；波形值必须通过字典 valueFormat 解析`,
      );
  }

  return value;
}

function parseFieldValueWithWarnings(
  raw: string,
  field: TextField,
  separator: string,
  warnings: string[],
  trim: boolean,
): unknown {
  const value = parseFieldValue(raw, field, separator, trim);
  checkPattern(field, raw, warnings);
  return value;
}

function dictionaryForToken(
  repeat: TextRepeat,
  parts: string[],
  config: TextCodecConfig,
): TextDictionaryEntry | undefined {
  if (!repeat.dictionary || !repeat.keyField) return undefined;
  const index = repeat.fields.findIndex((field) => field.name === repeat.keyField);
  if (index < 0) return undefined;
  const key = parts[index];
  if (key === undefined) return undefined;
  return config.dictionaries?.[repeat.dictionary]?.[key];
}

function parseWaveformOrFallback(
  raw: string,
  valueFormat: TextValueFormat,
  field: TextField,
  valueSeparator: string,
  warnings: string[],
  trim: boolean,
): { waveform?: TextWaveform; values: string[] } {
  const parsed = parseInt16ArrayValue(raw, valueFormat);
  if (parsed.ok) {
    if (!parsed.waveform.crcValid) {
      warnings.push(`字段 ${field.name} 的波形 CRC 校验失败，已丢弃波形数据`);
    }
    return { waveform: parsed.waveform, values: [] };
  }

  warnings.push(
    `字段 ${field.name} 的波形值${parsed.error}，已按普通值保留`,
  );
  return {
    values: parseStringList(raw, field, valueSeparator, trim),
  };
}

function warnUnknownDictionaryEntry(
  repeat: TextRepeat,
  parts: string[],
  config: TextCodecConfig,
  warnings: string[],
): void {
  if (!repeat.dictionary || !repeat.keyField) return;
  if (!config.dictionaries?.[repeat.dictionary]) return;
  const index = repeat.fields.findIndex((field) => field.name === repeat.keyField);
  if (index < 0) return;
  const key = parts[index];
  if (key === undefined) return;
  if (!config.dictionaries[repeat.dictionary]?.[key]) {
    warnings.push(`repeat ${repeat.name} 的字典码 ${key} 不存在，已保留原始值`);
  }
}

function safeMapKey(prefix: string | undefined, value: unknown): string {
  const raw = textOf(value);
  let key = `${prefix ?? ''}${raw}`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    key = `c_${raw.replace(/[^A-Za-z0-9_]/g, '_')}`;
  }
  return key;
}

function parseRepeat(
  repeat: TextRepeat,
  tokens: string[],
  start: number,
  end: number,
  fields: Record<string, unknown>,
  config: TextCodecConfig,
  warnings: string[],
): number {
  const count = fields[repeat.countField];
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 0
  ) {
    throw new TextParseError(
      `repeat ${repeat.name} 的 countField ${repeat.countField} 不是非负整数`,
    );
  }
  if (start + count > end) {
    throw new TextParseError(
      `repeat ${repeat.name} 需要 ${count} 组，但只剩 ${Math.max(0, end - start)} 个 token`,
    );
  }

  const items: Record<string, unknown>[] = [];
  const map: Record<string, Record<string, unknown>> | undefined =
    repeat.mapField ? {} : undefined;

  for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
    const rawItem = tokens[start + itemIndex]!;
    const parts = rawItem.split(repeat.itemSeparator);
    if (config.trim) {
      for (let index = 0; index < parts.length; index += 1) {
        parts[index] = parts[index]!.trim();
      }
    }
    if (parts.length !== repeat.fields.length) {
      throw new TextParseError(
        `repeat ${repeat.name} 第 ${itemIndex + 1} 组应有 ${repeat.fields.length} 个字段，实际 ${parts.length} 个`,
      );
    }

    const entry = dictionaryForToken(repeat, parts, config);
    warnUnknownDictionaryEntry(repeat, parts, config, warnings);
    const item: Record<string, unknown> = { raw: rawItem };
    let waveform: TextWaveform | undefined;

    for (let fieldIndex = 0; fieldIndex < repeat.fields.length; fieldIndex += 1) {
      const field = repeat.fields[fieldIndex]!;
      const raw = parts[fieldIndex]!;
      if (field.name === repeat.valueField && entry?.valueFormat) {
        const parsed = parseWaveformOrFallback(
          raw,
          entry.valueFormat,
          field,
          field.valueSeparator ?? repeat.valueSeparator,
          warnings,
          config.trim,
        );
        item[field.name] = parsed.waveform ? [] : parsed.values;
        waveform = parsed.waveform;
      } else {
        item[field.name] = parseFieldValueWithWarnings(
          raw,
          field,
          field.valueSeparator ?? repeat.valueSeparator,
          warnings,
          config.trim,
        );
      }
    }

    if (entry?.name !== undefined) item.name = entry.name;
    if (entry?.unit !== undefined) item.unit = entry.unit;
    if (entry?.multi !== undefined) item.multi = entry.multi;
    if (entry?.description !== undefined) item.description = entry.description;
    if (waveform) item.waveform = waveform;
    items.push(item);

    if (map) {
      const keyValue =
        repeat.keyField !== undefined ? item[repeat.keyField] : item.id;
      const key = safeMapKey(repeat.mapKeyPrefix, keyValue ?? itemIndex);
      if (map[key]) {
        warnings.push(`repeat ${repeat.name} 的索引键 ${key} 重复，后面的值覆盖前面的值`);
      }
      const values = Array.isArray(item[repeat.valueField])
        ? (item[repeat.valueField] as unknown[])
        : [];
      map[key] = {
        id: item.id ?? textOf(keyValue ?? itemIndex),
        value: waveform ? '' : textOf(values[0] ?? item[repeat.valueField] ?? ''),
        values: waveform ? [] : values,
        ...(entry?.name !== undefined ? { name: entry.name } : {}),
        ...(entry?.unit !== undefined ? { unit: entry.unit } : {}),
        ...(entry?.multi !== undefined ? { multi: entry.multi } : {}),
        ...(waveform ? { waveform: waveformSummary(waveform) } : {}),
      };
    }
  }

  fields[repeat.name] = items;
  if (map) fields[repeat.mapField!] = map;
  return start + count;
}

function parseSlotToken(
  slot: Exclude<TextSlot, { kind: 'repeat' }>,
  token: string,
  fields: Record<string, unknown>,
  config: TextCodecConfig,
  warnings: string[],
): void {
  if (slot.kind === 'literal') {
    if (token !== slot.value) {
      throw new TextParseError(
        `期望 literal ${JSON.stringify(slot.value)}，实际 ${JSON.stringify(token)}`,
      );
    }
    return;
  }

  fields[slot.name] = parseFieldValueWithWarnings(
    token,
    slot,
    '|',
    warnings,
    config.trim,
  );
}

function parseSlotsLeft(
  slots: TextSlot[],
  tokens: string[],
  start: number,
  end: number,
  fields: Record<string, unknown>,
  config: TextCodecConfig,
  warnings: string[],
): number {
  let index = start;
  for (const slot of slots) {
    if (slot.kind === 'repeat') {
      index = parseRepeat(slot, tokens, index, end, fields, config, warnings);
      continue;
    }
    if (index >= end) {
      throw new TextParseError(`缺少字段 ${slot.kind === 'field' ? slot.name : slot.value}`);
    }
    parseSlotToken(slot, tokens[index]!, fields, config, warnings);
    index += 1;
  }
  return index;
}

function parseSlotsRight(
  slots: TextSlot[],
  tokens: string[],
  start: number,
  end: number,
  fields: Record<string, unknown>,
  config: TextCodecConfig,
  warnings: string[],
): number {
  let index = end;
  for (let slotIndex = slots.length - 1; slotIndex >= 0; slotIndex -= 1) {
    const slot = slots[slotIndex]!;
    if (slot.kind === 'repeat') {
      throw new TextParseError('optional 之后不能出现 repeat');
    }
    if (index <= start) {
      throw new TextParseError(
        `缺少字段 ${slot.kind === 'field' ? slot.name : slot.value}`,
      );
    }
    index -= 1;
    parseSlotToken(slot, tokens[index]!, fields, config, warnings);
  }
  return index;
}

function matchMessage(
  message: TextMessage,
  tokens: string[],
): boolean {
  if (message.prefix !== undefined && tokens[0] !== message.prefix) return false;
  if (
    message.suffix !== undefined &&
    tokens[tokens.length - 1] !== message.suffix
  ) {
    return false;
  }
  if (!message.match) return true;
  return message.match.every((condition) => {
    const token = tokens[condition.index];
    if (token === undefined) return false;
    if (condition.equals !== undefined) return token === condition.equals;
    if (condition.oneOf !== undefined) return condition.oneOf.includes(token);
    if (condition.notEquals !== undefined) return token !== condition.notEquals;
    if (condition.regex !== undefined) {
      try {
        return new RegExp(condition.regex).test(token);
      } catch {
        return false;
      }
    }
    return false;
  });
}

function parseMessage(
  message: TextMessage,
  tokens: string[],
  config: TextCodecConfig,
  warnings: string[],
): Record<string, unknown> {
  const start = message.prefix !== undefined ? 1 : 0;
  const end = message.suffix !== undefined ? tokens.length - 1 : tokens.length;
  if (end < start) throw new TextParseError(`报文 ${message.name} 缺少正文`);

  const body = tokens.slice(start, end);
  const fields: Record<string, unknown> = {};
  const optionalIndex = message.slots.findIndex(
    (slot) => slot.kind === 'field' && slot.optional,
  );

  if (optionalIndex < 0) {
    const consumed = parseSlotsLeft(
      message.slots,
      body,
      0,
      body.length,
      fields,
      config,
      warnings,
    );
    if (consumed !== body.length) {
      throw new TextParseError(
        `报文 ${message.name} 还有 ${body.length - consumed} 个 token 未解析`,
      );
    }
  } else {
    const before = message.slots.slice(0, optionalIndex);
    const optional = message.slots[optionalIndex]!;
    const after = message.slots.slice(optionalIndex + 1);
    let left = parseSlotsLeft(
      before,
      body,
      0,
      body.length,
      fields,
      config,
      warnings,
    );
    let right = parseSlotsRight(
      after,
      body,
      left,
      body.length,
      fields,
      config,
      warnings,
    );
    if (right < left) {
      throw new TextParseError(`报文 ${message.name} 的可选字段位置重叠`);
    }
    const remaining = right - left;
    if (remaining > 1) {
      throw new TextParseError(
        `报文 ${message.name} 的可选字段 ${optional.kind === 'field' ? optional.name : ''} 前有 ${remaining} 个多余 token`,
      );
    }
    if (remaining === 1 && optional.kind === 'field') {
      fields[optional.name] = parseFieldValueWithWarnings(
        body[left]!,
        optional,
        '|',
        warnings,
        config.trim,
      );
      left += 1;
    }
    if (left !== right) {
      throw new TextParseError(`报文 ${message.name} 存在多余 token`);
    }
  }

  const label = message.label ?? message.name;
  const summaryParts = [label];
  for (const name of message.display?.summary ?? []) {
    const value = fields[name];
    if (Array.isArray(value)) summaryParts.push(`${name}=${value.length}项`);
    else if (value !== undefined && value !== null) {
      summaryParts.push(`${name}=${textOf(value)}`);
    }
  }

  fields._codec = 'text';
  fields._message = message.name;
  fields._messageLabel = label;
  fields._summary = summaryParts.join(' · ');
  return fields;
}

/**
 * 按配置顺序尝试每个 message。结构错误只让当前 message 失败；
 * 全部失败时返回第一条错误，方便定位第一个候选报文的问题。
 */
export function parseTextFrame(
  frame: Buffer,
  config: TextCodecConfig,
): DecodeResult {
  const body = stripTerminator(frame, config.terminator);
  const text = body.toString('utf8');
  if (text === '') return fail('空报文');

  const tokens = text.split(config.separator);
  if (tokens.length > MAX_TOKENS) {
    return fail(`报文 token 数 ${tokens.length} 超过上限 ${MAX_TOKENS}`);
  }
  if (config.trim) {
    for (let index = 0; index < tokens.length; index += 1) {
      tokens[index] = tokens[index]!.trim();
    }
  }

  const errors: string[] = [];
  for (const message of config.messages) {
    if (!matchMessage(message, tokens)) continue;
    const warnings: string[] = [];
    try {
      const fields = parseMessage(message, tokens, config, warnings);
      if (warnings.length > 0) fields._warnings = warnings;
      return {
        fields,
        valid: true,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (errors.length === 0) {
    return fail('无法匹配任何报文：prefix/suffix 或 match 条件不匹配');
  }
  return fail(errors[0]!);
}
