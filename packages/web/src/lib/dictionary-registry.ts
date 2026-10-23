import type {
  DictionaryRegistry,
  DictionarySummary,
  GlobalDictionaryDefinition,
} from '../types';

/** 把服务端字典列表转成编解码/补全使用的只读 registry。 */
export function dictionaryRegistryOf(
  definitions: readonly DictionarySummary[],
): DictionaryRegistry {
  const registry = new Map<string, GlobalDictionaryDefinition>();
  for (const definition of definitions) {
    registry.set(definition.id, definition);
  }
  return registry;
}
