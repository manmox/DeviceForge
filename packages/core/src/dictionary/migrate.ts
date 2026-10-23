import {
  DictionaryEntriesSchema,
  GlobalDictionaryDefinitionSchema,
  type DictionaryEntries,
  type GlobalDictionaryDefinition,
} from '../schema/dictionary';

export interface DictionaryMigrationOptions {
  /** 来源说明，例如设备 ID，会写入迁移出的字典描述。 */
  source?: string;
}

export interface DictionaryMigrationResult {
  config: unknown;
  definitions: GlobalDictionaryDefinition[];
  changed: boolean;
  errors: { dictionary: string; message: string }[];
  warnings: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

/** 稳定序列化：对象 key 排序、丢弃 undefined，保证内容比较不受顺序影响。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sanitizeDictionaryId(alias: string): string {
  const replaced = alias.replace(/[^A-Za-z0-9_-]+/g, '-');
  const trimmedStart = replaced.replace(/^[^A-Za-z0-9]+/, '');
  const trimmed = trimmedStart.replace(/[-_]+$/, '');
  return trimmed.length > 0 ? trimmed : 'dictionary';
}

function uniqueDictionaryId(base: string, used: ReadonlySet<string>): string {
  const withSuffix = (suffix: string): string => {
    const maxBase = Math.max(1, 64 - suffix.length);
    return `${base.slice(0, maxBase)}${suffix}`;
  };

  let id = withSuffix('');
  let index = 2;
  while (used.has(id)) {
    id = withSuffix(`-${index}`);
    index += 1;
  }
  return id;
}

/** 判断原始配置是否仍带有旧的 codec.dictionaries 块。 */
export function hasInlineTextDictionaries(raw: unknown): boolean {
  if (!isPlainObject(raw)) return false;
  const codec = raw.codec;
  return isPlainObject(codec) && Object.prototype.hasOwnProperty.call(codec, 'dictionaries');
}

/**
 * 把设备配置中的 codec.dictionaries 迁移为全局字典。
 *
 * 必须在 DeviceConfigSchema.parse 之前调用：Zod 会静默丢弃未知的
 * codec.dictionaries 字段。任何条目非法时返回 errors，并保持原配置不变，
 * 让调用方保留原始记录而不是丢数据。
 */
export function migrateInlineTextDictionaries(
  raw: unknown,
  existing: Iterable<GlobalDictionaryDefinition> = [],
  options: DictionaryMigrationOptions = {},
): DictionaryMigrationResult {
  const empty: DictionaryMigrationResult = {
    config: raw,
    definitions: [],
    changed: false,
    errors: [],
    warnings: [],
  };
  if (!isPlainObject(raw)) return empty;
  const codec = raw.codec;
  if (!isPlainObject(codec)) return empty;
  if (!Object.prototype.hasOwnProperty.call(codec, 'dictionaries')) return empty;

  const config = cloneJson(raw);
  const clonedCodec = config.codec as Record<string, unknown>;
  const inline = clonedCodec.dictionaries;

  if (clonedCodec.type !== 'text') {
    delete clonedCodec.dictionaries;
    return {
      config,
      definitions: [],
      changed: true,
      errors: [],
      warnings: ['非 text codec 上的 codec.dictionaries 已移除'],
    };
  }

  if (!isPlainObject(inline)) {
    return {
      ...empty,
      errors: [{ dictionary: '(root)', message: 'codec.dictionaries 必须是对象' }],
    };
  }

  const normalizedExisting: { id: string; entries: DictionaryEntries }[] = [];
  const warnings: string[] = [];
  for (const definition of existing) {
    const parsed = GlobalDictionaryDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      warnings.push(`忽略无效的已有字典 ${String((definition as { id?: unknown })?.id ?? '')}`);
      continue;
    }
    normalizedExisting.push({
      id: parsed.data.id,
      entries: parsed.data.entries,
    });
  }

  const errors: { dictionary: string; message: string }[] = [];
  const normalizedInline = new Map<string, DictionaryEntries>();

  for (const [alias, entries] of Object.entries(inline)) {
    const parsed = DictionaryEntriesSchema.safeParse(entries);
    if (!parsed.success) {
      errors.push({
        dictionary: alias,
        message: parsed.error.issues.map((issue) => issue.message).join('；'),
      });
      continue;
    }
    normalizedInline.set(alias, parsed.data);
  }

  if (errors.length > 0) {
    return {
      ...empty,
      errors,
      warnings,
    };
  }

  const usedIds = new Set(normalizedExisting.map((item) => item.id));
  const definitions: GlobalDictionaryDefinition[] = [];
  const aliasToId = new Map<string, string>();
  const canonicalToId = new Map<string, string>();
  for (const item of normalizedExisting) {
    if (!canonicalToId.has(canonical(item.entries))) {
      canonicalToId.set(canonical(item.entries), item.id);
    }
  }

  for (const [alias, entries] of normalizedInline.entries()) {
    const signature = canonical(entries);
    const existingId = canonicalToId.get(signature);
    if (existingId !== undefined) {
      aliasToId.set(alias, existingId);
      continue;
    }

    const id = uniqueDictionaryId(sanitizeDictionaryId(alias), usedIds);
    const source = options.source ? `设备 ${options.source} 的` : '';
    const definition: GlobalDictionaryDefinition = {
      id,
      name: alias.length > 0 ? alias : id,
      description: `由${source}内联字典 ${alias || id} 自动迁移`,
      entries,
    };
    definitions.push(definition);
    aliasToId.set(alias, id);
    usedIds.add(id);
    canonicalToId.set(signature, id);
  }

  // 多个别名内容完全相同时会指向同一个全局 ID；在 warning 中说明。
  const idsByAlias = new Map<string, string[]>();
  for (const [alias, id] of aliasToId) {
    const aliases = idsByAlias.get(id) ?? [];
    aliases.push(alias);
    idsByAlias.set(id, aliases);
  }
  for (const [id, aliases] of idsByAlias) {
    if (aliases.length > 1) {
      warnings.push(`内联字典 ${aliases.join('、')} 内容相同，已合并为 ${id}`);
    }
  }

  const messages = clonedCodec.messages;
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (!isPlainObject(message) || !Array.isArray(message.slots)) continue;
      for (const slot of message.slots) {
        if (!isPlainObject(slot) || slot.kind !== 'repeat') continue;
        if (typeof slot.dictionary !== 'string') continue;
        const target = aliasToId.get(slot.dictionary);
        if (target !== undefined) slot.dictionary = target;
      }
    }
  }

  delete clonedCodec.dictionaries;

  return {
    config,
    definitions,
    changed: true,
    errors: [],
    warnings,
  };
}
