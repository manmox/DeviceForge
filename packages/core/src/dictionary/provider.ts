import type {
  DictionaryEntries,
  GlobalDictionaryDefinition,
} from '../schema/dictionary';

/** 编解码时按 ID 实时查询全局字典。 */
export interface DictionaryProvider {
  get(id: string): DictionaryEntries | undefined;
}

/** 从一组静态定义创建 provider，主要供测试和一次性场景使用。 */
export function createDictionaryProvider(
  definitions: Iterable<GlobalDictionaryDefinition>,
): DictionaryProvider {
  const entriesById = new Map<string, DictionaryEntries>();
  for (const definition of definitions) {
    entriesById.set(definition.id, definition.entries);
  }
  return {
    get: (id) => entriesById.get(id),
  };
}
