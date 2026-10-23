import { describe, expect, it } from 'vitest';
import {
  hasInlineTextDictionaries,
  migrateInlineTextDictionaries,
} from '../dictionary/migrate';
import type {
  DictionaryEntries,
  GlobalDictionaryDefinition,
} from '../schema/dictionary';

const entries: DictionaryEntries = {
  '000': { name: '电压', unit: 'V' },
  '220': {
    name: '波形',
    valueFormat: {
      type: 'int16Array',
      points: 4,
      endian: 'be',
      encoding: 'hex',
      crc: { algo: 'crc16-modbus', endian: 'le' },
    },
  },
};

function legacyConfig(overrides: {
  entries?: Record<string, unknown>;
  alias?: string;
  extraDictionaries?: Record<string, unknown>;
} = {}) {
  const alias = overrides.alias ?? 'sampleCodes';
  return {
    id: 'device-1',
    name: '旧设备',
    transport: { type: 'tcp-server', port: 19001 },
    codec: {
      type: 'text',
      messages: [
        {
          name: 'report',
          slots: [
            { kind: 'field', name: 'count', type: 'int' },
            {
              kind: 'repeat',
              name: 'groups',
              countField: 'count',
              dictionary: alias,
              keyField: 'id',
              valueField: 'values',
              fields: [
                { kind: 'field', name: 'id', type: 'string' },
                { kind: 'field', name: 'values', type: 'stringList' },
              ],
            },
          ],
        },
      ],
      dictionaries: {
        [alias]: overrides.entries ?? entries,
        ...overrides.extraDictionaries,
      },
    },
  };
}

describe('inline dictionary migration', () => {
  it('creates a global definition, rewrites repeat IDs and removes inline data', () => {
    const result = migrateInlineTextDictionaries(legacyConfig(), [], {
      source: 'device-1',
    });
    expect(result.errors).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]).toMatchObject({
      id: 'sampleCodes',
      name: 'sampleCodes',
    });
    expect(result.config).toMatchObject({
      codec: {
        messages: [
          {
            slots: [
              { kind: 'field', name: 'count' },
              { kind: 'repeat', dictionary: 'sampleCodes' },
            ],
          },
        ],
      },
    });
    expect(
      (result.config as { codec: Record<string, unknown> }).codec,
    ).not.toHaveProperty('dictionaries');
  });

  it('reuses an existing dictionary with normalized equal entries', () => {
    const result = migrateInlineTextDictionaries(
      legacyConfig(),
      [
        {
          id: 'sample-codes',
          name: '本机字典',
          entries,
        },
      ],
    );
    expect(result.definitions).toEqual([]);
    expect(result.config).toMatchObject({
      codec: {
        messages: [
          {
            slots: [
              { kind: 'field', name: 'count' },
              {
                kind: 'repeat',
                dictionary: 'sample-codes',
              },
            ],
          },
        ],
      },
    });
  });

  it('normalizes valueFormat defaults before matching existing entries', () => {
    const inline = {
      '220': {
        name: '波形',
        valueFormat: { type: 'int16Array', points: 4 },
      },
    };
    const existing = [
      {
        id: 'builtin-codes',
        name: '内置',
        entries: {
          '220': {
            name: '波形',
            valueFormat: {
              type: 'int16Array',
              points: 4,
              endian: 'be',
              encoding: 'hex',
            },
          },
        },
      },
    ] as unknown as GlobalDictionaryDefinition[];
    const result = migrateInlineTextDictionaries(
      legacyConfig({ entries: inline }),
      existing,
    );
    expect(result.definitions).toEqual([]);
    expect(result.config).toMatchObject({
      codec: {
        messages: [
          {
            slots: [
              { kind: 'field', name: 'count' },
              { kind: 'repeat', dictionary: 'builtin-codes' },
            ],
          },
        ],
      },
    });
  });

  it('adds a suffix when a different dictionary already uses the alias', () => {
    const result = migrateInlineTextDictionaries(legacyConfig(), [
      {
        id: 'sampleCodes',
        name: '已有字典',
        entries: { '999': { name: '其他' } },
      },
    ]);
    expect(result.definitions[0]?.id).toBe('sampleCodes-2');
  });

  it('sanitizes aliases into valid IDs', () => {
    const result = migrateInlineTextDictionaries(
      legacyConfig({ alias: 'bad.alias!' }),
      [],
    );
    expect(result.definitions[0]?.id).toBe('bad-alias');
    expect(result.errors).toEqual([]);
  });

  it('preserves unreferenced dictionaries and merges equal content aliases', () => {
    const result = migrateInlineTextDictionaries(
      legacyConfig({
        extraDictionaries: {
          unused: { '001': { name: '未引用' } },
          sameAsSample: entries,
        },
      }),
      [],
    );
    expect(result.errors).toEqual([]);
    expect(result.definitions).toHaveLength(2);
    expect(result.definitions.map((item) => item.id).sort()).toEqual([
      'sampleCodes',
      'unused',
    ]);
    expect(result.warnings.join(' ')).toContain('内容相同');
  });

  it('is idempotent', () => {
    const first = migrateInlineTextDictionaries(legacyConfig(), []);
    const second = migrateInlineTextDictionaries(
      first.config,
      first.definitions,
    );
    expect(second.changed).toBe(false);
    expect(second.definitions).toEqual([]);
    expect(second.config).toBe(first.config);
  });

  it('returns errors and keeps raw data when entries are invalid', () => {
    const raw = legacyConfig({ entries: { '000': 'not-an-entry' } });
    const result = migrateInlineTextDictionaries(raw, []);
    expect(result.changed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.config).toBe(raw);
    expect(
      (raw.codec as { dictionaries: Record<string, unknown> }).dictionaries,
    ).toBeDefined();
  });

  it('removes inline dictionaries from non-text codecs', () => {
    const raw = {
      id: 'device-2',
      name: 'raw',
      transport: { type: 'tcp-server', port: 19002 },
      codec: { type: 'raw', display: 'hex', dictionaries: { old: {} } },
    };
    const result = migrateInlineTextDictionaries(raw, []);
    expect(result.changed).toBe(true);
    expect(result.warnings.join(' ')).toContain('非 text codec');
    expect(
      (result.config as { codec: Record<string, unknown> }).codec,
    ).not.toHaveProperty('dictionaries');
  });

  it('detects inline dictionaries before schema parsing', () => {
    expect(hasInlineTextDictionaries(legacyConfig())).toBe(true);
    expect(hasInlineTextDictionaries({ codec: { type: 'text' } })).toBe(false);
    expect(hasInlineTextDictionaries(null)).toBe(false);
  });
});
