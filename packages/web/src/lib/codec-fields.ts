import type { CodecConfig, FieldDef } from '@deviceforge/core';
import type { DictionaryRegistry } from '../types';
import {
  allTopLevelFields,
  allTopLevelNames,
  defaultFieldsForTextCodec,
  findMessage,
  topLevelRepeatSlots,
} from './text-codec-model';

const NUMERIC_FIELD_TYPES = new Set<FieldDef['type']>([
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

const MULTI_BYTE_FIELD_TYPES = new Set<FieldDef['type']>([
  'u16',
  'i16',
  'u24',
  'i24',
  'u32',
  'i32',
  'f32',
  'f64',
]);

const LENGTH_FIELD_TYPES = new Set<FieldDef['type']>(['bytes', 'string', 'bcd']);

export function isNumericFieldType(type: FieldDef['type']): boolean {
  return NUMERIC_FIELD_TYPES.has(type);
}

export function isMultiByteFieldType(type: FieldDef['type']): boolean {
  return MULTI_BYTE_FIELD_TYPES.has(type);
}

export function fieldNeedsLength(type: FieldDef['type']): boolean {
  return LENGTH_FIELD_TYPES.has(type);
}

export function defaultFieldsForCodec(
  codec: CodecConfig,
  registry?: DictionaryRegistry,
): Record<string, unknown> {
  if (codec.type === 'raw') {
    return { hex: '' };
  }
  if (codec.type === 'text') {
    return defaultFieldsForTextCodec(codec, registry);
  }

  const values: Record<string, unknown> = {};
  for (const field of codec.fields) {
    if (field.const !== undefined || field.calc !== undefined) continue;
    if (field.type === 'bytes' || field.type === 'string') values[field.name] = '';
    else if (field.type === 'bcd') values[field.name] = '0';
    else values[field.name] = 0;
  }
  return values;
}

export function codecFieldSuggestions(
  codec: CodecConfig,
): { name: string; type?: string }[] {
  if (codec.type === 'fields') {
    return codec.fields.map((field) => ({ name: field.name, type: field.type }));
  }
  if (codec.type === 'text') {
    return [
      { name: 'kind', type: 'string' },
      ...allTopLevelFields(codec).map((field) => ({
        name: field.name,
        type: field.type,
      })),
    ];
  }
  return [{ name: 'hex' }, { name: 'text' }, { name: 'data' }];
}

export function codecMatchFieldSuggestions(codec: CodecConfig): string[] {
  if (codec.type === 'fields') {
    return codec.fields.map((field) => field.name);
  }
  if (codec.type === 'text') {
    const names = new Set<string>(['_message']);
    for (const name of allTopLevelNames(codec)) names.add(name);
    for (const message of codec.messages) {
      for (const repeat of topLevelRepeatSlots(message)) {
        if (repeat.mapField) names.add(repeat.mapField);
      }
    }
    return [...names];
  }
  return ['hex', 'ascii', 'length'];
}

export function missingFieldsForCodec(
  codec: CodecConfig,
  fields: Record<string, unknown>,
): string[] {
  if (codec.type === 'fields') {
    return codec.fields
      .filter(
        (field) =>
          field.const === undefined &&
          field.calc === undefined &&
          !Object.prototype.hasOwnProperty.call(fields, field.name),
      )
      .map((field) => field.name);
  }
  if (codec.type !== 'text') return [];

  const kind = fields.kind;
  const message =
    typeof kind === 'string'
      ? findMessage(codec, kind)
      : codec.messages.length === 1
        ? codec.messages[0]
        : undefined;
  if (typeof kind === 'string' && !message) return [];
  const messages = message ? [message] : codec.messages;
  const missing = new Set<string>();
  if (typeof kind !== 'string' && codec.messages.length > 1) missing.add('kind');

  for (const item of messages) {
    for (const slot of item.slots) {
      if (slot.kind === 'literal') continue;
      if (slot.kind === 'repeat') {
        if (!Array.isArray(fields[slot.name])) missing.add(slot.name);
        continue;
      }
      if (
        slot.optional ||
        slot.auto !== undefined ||
        slot.default !== undefined ||
        slot.defaultFrom !== undefined
      ) {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(fields, slot.name)) {
        missing.add(slot.name);
      }
    }
  }
  return [...missing];
}

export function uniqueFieldName(fields: FieldDef[], base: string): string {
  const names = new Set(fields.map((field) => field.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}
