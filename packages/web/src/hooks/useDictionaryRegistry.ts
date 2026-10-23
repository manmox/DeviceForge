import { useMemo } from 'react';
import { dictionaryRegistryOf } from '../lib/dictionary-registry';
import { useAppStore } from '../store';
import type { DictionaryRegistry } from '../types';

export function useDictionaryRegistry(): DictionaryRegistry {
  const dictionaries = useAppStore((state) => state.dictionaries);
  return useMemo(
    () => dictionaryRegistryOf(dictionaries),
    [dictionaries],
  );
}
