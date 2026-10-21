import type { CodecConfig, FieldDef } from '@deviceforge/core';

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

export function defaultFieldsForCodec(codec: CodecConfig): Record<string, unknown> {
  if (codec.type === 'raw') {
    return { hex: '' };
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
  return [{ name: 'hex' }, { name: 'text' }, { name: 'data' }];
}

export function codecMatchFieldSuggestions(codec: CodecConfig): string[] {
  if (codec.type === 'fields') {
    return codec.fields.map((field) => field.name);
  }
  return ['hex', 'ascii', 'length'];
}

export function uniqueFieldName(fields: FieldDef[], base: string): string {
  const names = new Set(fields.map((field) => field.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}
