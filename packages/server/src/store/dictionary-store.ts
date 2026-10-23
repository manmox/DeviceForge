import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  GlobalDictionaryDefinitionSchema,
  type DictionaryProvider,
  type GlobalDictionaryDefinition,
} from '@deviceforge/core';
import { z } from 'zod';

const StoreFileSchema = z.object({
  version: z.number().int().default(1),
  dictionaries: z.array(z.unknown()).default([]),
});

export class DictionaryStoreError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DictionaryStoreError';
  }
}

/** DeviceStore 启动迁移只需要读取现有定义和导入新定义。 */
export interface DictionaryRepository {
  list(): GlobalDictionaryDefinition[];
  importDefinitions(
    definitions: Iterable<GlobalDictionaryDefinition>,
  ): GlobalDictionaryDefinition[];
}

function byId(
  left: GlobalDictionaryDefinition,
  right: GlobalDictionaryDefinition,
): number {
  return left.id.localeCompare(right.id);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sameDefinition(
  left: GlobalDictionaryDefinition,
  right: GlobalDictionaryDefinition,
): boolean {
  return canonical(left.entries) === canonical(right.entries);
}

export class DictionaryStore implements DictionaryRepository {
  private readonly users = new Map<string, GlobalDictionaryDefinition>();
  /** 用户文件中单条无效记录；保存时原样写回，避免静默丢数据。 */
  private readonly invalidUserRecords: unknown[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly dictionaryProvider: DictionaryProvider = {
    get: (id) => this.get(id)?.entries,
  };

  constructor(private readonly userFilePath: string) {
    this.loadUsers();
  }

  list(): GlobalDictionaryDefinition[] {
    return [...this.users.values()].sort(byId);
  }

  get(id: string): GlobalDictionaryDefinition | undefined {
    return this.users.get(id);
  }

  has(id: string): boolean {
    return this.users.has(id);
  }

  create(definition: GlobalDictionaryDefinition): GlobalDictionaryDefinition {
    const parsed = GlobalDictionaryDefinitionSchema.parse(definition);
    if (this.has(parsed.id)) {
      throw new DictionaryStoreError(`字典 ${parsed.id} 已存在`, 409);
    }
    this.users.set(parsed.id, parsed);
    this.save();
    this.emitChange();
    return parsed;
  }

  update(
    id: string,
    definition: GlobalDictionaryDefinition,
  ): GlobalDictionaryDefinition {
    if (!this.users.has(id)) {
      throw new DictionaryStoreError(`字典 ${id} 不存在`, 404);
    }
    if (definition.id !== id) {
      throw new DictionaryStoreError('不能修改字典 ID', 400);
    }
    const parsed = GlobalDictionaryDefinitionSchema.parse(definition);
    this.users.set(id, parsed);
    this.save();
    this.emitChange();
    return parsed;
  }

  delete(id: string): boolean {
    if (!this.users.has(id)) {
      throw new DictionaryStoreError(`字典 ${id} 不存在`, 404);
    }
    this.users.delete(id);
    this.save();
    this.emitChange();
    return true;
  }

  importDefinitions(
    definitions: Iterable<GlobalDictionaryDefinition>,
  ): GlobalDictionaryDefinition[] {
    const parsedDefinitions = [...definitions].map((definition) =>
      GlobalDictionaryDefinitionSchema.parse(definition),
    );
    const added: GlobalDictionaryDefinition[] = [];
    for (const parsed of parsedDefinitions) {
      const existing = this.get(parsed.id);
      if (existing) {
        if (!sameDefinition(existing, parsed)) {
          throw new DictionaryStoreError(`字典 ${parsed.id} 内容冲突`, 409);
        }
        continue;
      }
      if (added.some((item) => item.id === parsed.id)) {
        throw new DictionaryStoreError(`字典 ${parsed.id} 重复`, 409);
      }
      added.push(parsed);
    }
    if (added.length > 0) {
      for (const definition of added) {
        this.users.set(definition.id, definition);
      }
      this.save();
      this.emitChange();
    }
    return added;
  }

  provider(): DictionaryProvider {
    return this.dictionaryProvider;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private loadUsers(): void {
    if (!existsSync(this.userFilePath)) return;

    try {
      const raw: unknown = JSON.parse(readFileSync(this.userFilePath, 'utf8'));
      const parsed = StoreFileSchema.parse(raw);
      for (const item of parsed.dictionaries) {
        const definition = GlobalDictionaryDefinitionSchema.safeParse(item);
        if (!definition.success) {
          console.warn('[dictionaries] 跳过无效用户字典', definition.error.issues);
          this.invalidUserRecords.push(item);
          continue;
        }
        if (this.users.has(definition.data.id)) {
          console.warn(
            `[dictionaries] 用户字典 ${definition.data.id} 重复，已跳过`,
          );
          this.invalidUserRecords.push(item);
          continue;
        }
        this.users.set(definition.data.id, definition.data);
      }
    } catch (error) {
      const backup = `${this.userFilePath}.corrupt-${Date.now()}`;
      try {
        copyFileSync(this.userFilePath, backup);
      } catch {
        // 备份失败可忽略
      }
      console.error(
        `[dictionaries] 读取 ${this.userFilePath} 失败，已备份到 ${backup}`,
        error,
      );
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.userFilePath), { recursive: true });
    const tempPath = `${this.userFilePath}.tmp`;
    const payload = {
      version: 1,
      dictionaries: [
        ...[...this.users.values()],
        ...this.invalidUserRecords,
      ],
    };
    writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tempPath, this.userFilePath);
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }
}
