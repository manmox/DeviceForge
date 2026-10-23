import type { CodecConfig, FieldDef } from '@deviceforge/core';
import { TextCodecSchema } from '@deviceforge/core/schema';
import { describe, expect, it } from 'vitest';
import type { DictionaryRegistry } from '../../types';
import {
  codecFieldSuggestions,
  codecMatchFieldSuggestions,
  defaultFieldsForCodec,
  fieldNeedsLength,
  isMultiByteFieldType,
  isNumericFieldType,
  uniqueFieldName,
} from '../codec-fields';

const fields: FieldDef[] = [
  { name: 'magic', type: 'bytes', length: 2, const: 'AA55' },
  { name: 'length', type: 'u16', calc: 'totalLength' },
  { name: 'cmd', type: 'u8' },
  { name: 'label', type: 'string', length: 4 },
  { name: 'code', type: 'bcd', length: 2 },
];

const fieldsCodec: CodecConfig = { type: 'fields', fields };
const rawCodec: CodecConfig = { type: 'raw', display: 'hex' };
const textCodec: CodecConfig = TextCodecSchema.parse({
  type: 'text',
  messages: [
    {
      name: 'report',
      slots: [
        { kind: 'field', name: 'deviceCode', type: 'string' },
        { kind: 'field', name: 'count', type: 'int' },
        {
          kind: 'repeat',
          name: 'groups',
          countField: 'count',
          itemSeparator: '*',
          keyField: 'id',
          mapField: 'data',
          mapKeyPrefix: 'c',
          dictionary: 'codes',
          fields: [
            { kind: 'field', name: 'id', type: 'string' },
            { kind: 'field', name: 'values', type: 'stringList' },
          ],
        },
        {
          kind: 'field',
          name: 'timestamp',
          type: 'timestamp',
          format: 'YYYY-MM-DD HH-mm-ss',
          auto: 'timestamp',
        },
        {
          kind: 'field',
          name: 'sequence',
          type: 'int',
          optional: true,
          auto: 'sequence',
        },
      ],
    },
  ],
});

const dictionaries: DictionaryRegistry = new Map([
  [
    'codes',
    {
      id: 'codes',
      name: 'codes',
      entries: {
        '000': { name: '电压', unit: 'V' },
        '001': { name: '电流', unit: 'A' },
      },
    },
  ],
]);

describe('field type helpers', () => {
  it('classifies numeric and variable-length types', () => {
    expect(isNumericFieldType('u8')).toBe(true);
    expect(isNumericFieldType('f64')).toBe(true);
    expect(isNumericFieldType('bytes')).toBe(false);
    expect(isMultiByteFieldType('u8')).toBe(false);
    expect(isMultiByteFieldType('u16')).toBe(true);
    expect(fieldNeedsLength('bytes')).toBe(true);
    expect(fieldNeedsLength('string')).toBe(true);
    expect(fieldNeedsLength('bcd')).toBe(true);
    expect(fieldNeedsLength('u32')).toBe(false);
  });
});

describe('defaultFieldsForCodec', () => {
  it('skips const/calc fields and uses type-appropriate defaults', () => {
    expect(defaultFieldsForCodec(fieldsCodec)).toEqual({
      cmd: 0,
      label: '',
      code: '0',
    });
  });

  it('uses hex for raw codec', () => {
    expect(defaultFieldsForCodec(rawCodec)).toEqual({ hex: '' });
  });

  it('uses the first text message and one dictionary sample group', () => {
    expect(defaultFieldsForCodec(textCodec, dictionaries)).toEqual({
      kind: 'report',
      deviceCode: 'value',
      count: 0,
      groups: [{ id: '000', values: ['0'] }],
    });
  });
});

describe('field suggestions', () => {
  it('suggests field names for send and match editors', () => {
    expect(codecFieldSuggestions(fieldsCodec)).toEqual([
      { name: 'magic', type: 'bytes' },
      { name: 'length', type: 'u16' },
      { name: 'cmd', type: 'u8' },
      { name: 'label', type: 'string' },
      { name: 'code', type: 'bcd' },
    ]);
    expect(codecMatchFieldSuggestions(fieldsCodec)).toEqual([
      'magic',
      'length',
      'cmd',
      'label',
      'code',
    ]);
    expect(codecFieldSuggestions(rawCodec)).toEqual([
      { name: 'hex' },
      { name: 'text' },
      { name: 'data' },
    ]);
    expect(codecMatchFieldSuggestions(rawCodec)).toEqual(['hex', 'ascii', 'length']);
  });

  it('suggests text codec fields and map indexes', () => {
    expect(codecFieldSuggestions(textCodec).map((item) => item.name)).toEqual([
      'kind',
      'deviceCode',
      'count',
      'groups',
      'timestamp',
      'sequence',
    ]);
    expect(codecMatchFieldSuggestions(textCodec)).toEqual([
      '_message',
      'deviceCode',
      'count',
      'groups',
      'timestamp',
      'sequence',
      'data',
    ]);
  });
});

describe('uniqueFieldName', () => {
  it('appends a numeric suffix when needed', () => {
    expect(uniqueFieldName(fields, 'new')).toBe('new');
    expect(uniqueFieldName(fields, 'cmd')).toBe('cmd2');
    expect(uniqueFieldName([...fields, { name: 'cmd2', type: 'u8' }], 'cmd')).toBe(
      'cmd3',
    );
  });
});
