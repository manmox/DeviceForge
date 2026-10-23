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
import type { DictionaryRepository } from '../application/contracts';

export type { DictionaryRepository } from '../application/contracts';

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
  // 内联字典迁移只负责合并码表条目；原字典的名称和说明属于用户元数据。
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
    const conflict = this.findCaseInsensitive(parsed.id);
    if (conflict) {
      throw new DictionaryStoreError(
        conflict === parsed.id
          ? `字典 ${parsed.id} 已存在`
          : `字典 ID ${parsed.id} 与现有字典 ${conflict} 仅大小写不同`,
        409,
      );
    }
    this.users.set(parsed.id, parsed);
    try {
      this.save();
    } catch (error) {
      this.users.delete(parsed.id);
      throw error;
    }
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
    const conflict = this.findCaseInsensitive(id, id);
    if (conflict) {
      throw new DictionaryStoreError(
        `字典 ID ${id} 与现有字典 ${conflict} 仅大小写不同`,
        409,
      );
    }
    const previous = this.users.get(id)!;
    this.users.set(id, parsed);
    try {
      this.save();
    } catch (error) {
      this.users.set(id, previous);
      throw error;
    }
    this.emitChange();
    return parsed;
  }

  delete(id: string): boolean {
    if (!this.users.has(id)) {
      throw new DictionaryStoreError(`字典 ${id} 不存在`, 404);
    }
    const previous = this.users.get(id)!;
    this.users.delete(id);
    try {
      this.save();
    } catch (error) {
      this.users.set(id, previous);
      throw error;
    }
    this.emitChange();
    return true;
  }

  importDefinitions(
    definitions: Iterable<GlobalDictionaryDefinition>,
  ): GlobalDictionaryDefinition[] {
    const added = this.prepareDefinitions(definitions);
    if (added.length > 0) {
      for (const definition of added) {
        this.users.set(definition.id, definition);
      }
      try {
        this.save();
      } catch (error) {
        for (const definition of added) this.users.delete(definition.id);
        throw error;
      }
      this.emitChange();
    }
    return added;
  }

  /** 验证批量迁入定义，保证设备存储前能发现所有 ID/内容冲突。 */
  validateImportDefinitions(
    definitions: Iterable<GlobalDictionaryDefinition>,
  ): void {
    this.prepareDefinitions(definitions);
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
        const conflict = this.findCaseInsensitive(definition.data.id);
        if (conflict) {
          console.warn(
            `[dictionaries] 用户字典 ${definition.data.id} 与 ${conflict} 仅大小写不同，已跳过`,
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

  private findCaseInsensitive(id: string, exceptId?: string): string | undefined {
    const normalized = id.toLowerCase();
    return [...this.users.keys()].find(
      (existing) =>
        existing !== exceptId && existing.toLowerCase() === normalized,
    );
  }

  private prepareDefinitions(
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
      const conflict =
        this.findCaseInsensitive(parsed.id) ??
        added.find((item) => item.id.toLowerCase() === parsed.id.toLowerCase())?.id;
      if (conflict) {
        throw new DictionaryStoreError(
          conflict === parsed.id
            ? `字典 ${parsed.id} 重复`
            : `字典 ID ${parsed.id} 与现有字典 ${conflict} 仅大小写不同`,
          409,
        );
      }
      added.push(parsed);
    }
    return added;
  }
}
