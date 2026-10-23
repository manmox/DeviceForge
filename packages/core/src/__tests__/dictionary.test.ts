import { describe, expect, it } from 'vitest';
import { DeviceConfigSchema } from '../schema/device';
import { GlobalDictionaryDefinitionSchema } from '../schema/dictionary';
import {
  collectDictionaryReferences,
  findMissingDictionaryReferences,
} from '../dictionary/references';
import { createDictionaryProvider } from '../dictionary/provider';

function textConfig(dictionary?: string) {
  return DeviceConfigSchema.parse({
    id: 'device-1',
    name: '测试设备',
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
              dictionary,
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
    },
  });
}

describe('global dictionary schema', () => {
  it('accepts empty entries and valid IDs', () => {
    expect(
      GlobalDictionaryDefinitionSchema.parse({
        id: 'codes_1',
        name: '码表',
        entries: {},
      }),
    ).toMatchObject({ id: 'codes_1', entries: {} });
  });

  it('rejects invalid IDs', () => {
    for (const id of ['', '_bad', '-bad', 'bad.id', 'bad id', 'x'.repeat(65)]) {
      expect(
        GlobalDictionaryDefinitionSchema.safeParse({
          id,
          name: '码表',
          entries: {},
        }).success,
      ).toBe(false);
    }
  });
});

describe('dictionary provider', () => {
  it('resolves entries by ID', () => {
    const provider = createDictionaryProvider([
      {
        id: 'codes',
        name: '码表',
        entries: { '000': { name: '电压', unit: 'V' } },
      },
    ]);
    expect(provider.get('codes')?.['000']).toEqual({ name: '电压', unit: 'V' });
    expect(provider.get('missing')).toBeUndefined();
  });
});

describe('dictionary references', () => {
  it('collects repeat dictionary paths and finds missing IDs', () => {
    const config = textConfig('codes');
    const references = collectDictionaryReferences(config);
    expect(references).toEqual([
      {
        dictionaryId: 'codes',
        path: 'codec.messages.0.slots.1.dictionary',
        messageName: 'report',
        repeatName: 'groups',
      },
    ]);
    expect(
      findMissingDictionaryReferences(config, (id) => id === 'codes'),
    ).toEqual([]);
    expect(
      findMissingDictionaryReferences(config, (id) => id === 'other'),
    ).toEqual(references);
  });

  it('ignores text configs without dictionary references', () => {
    expect(collectDictionaryReferences(textConfig())).toEqual([]);
  });
});
