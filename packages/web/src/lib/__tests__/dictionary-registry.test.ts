import { describe, expect, it } from 'vitest';
import { dictionaryRegistryOf } from '../dictionary-registry';
import type { DictionarySummary } from '../../types';

describe('dictionaryRegistryOf', () => {
  it('indexes dictionaries by ID', () => {
    const dictionaries: DictionarySummary[] = [
      {
        id: 'codes',
        name: '码表',
        entries: { '000': { name: '电压' } },
        builtin: false,
        usedBy: [],
      },
    ];
    const registry = dictionaryRegistryOf(dictionaries);
    expect(registry.get('codes')?.entries['000']).toEqual({ name: '电压' });
    expect(registry.has('missing')).toBe(false);
  });

  it('uses the last definition when the same ID appears twice', () => {
    const registry = dictionaryRegistryOf([
      {
        id: 'codes',
        name: '旧',
        entries: {},
        builtin: false,
        usedBy: [],
      },
      {
        id: 'codes',
        name: '新',
        entries: {},
        builtin: false,
        usedBy: [],
      },
    ]);
    expect(registry.get('codes')?.name).toBe('新');
  });
});
