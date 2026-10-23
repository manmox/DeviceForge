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
  DeviceConfigSchema,
  findMissingDictionaryReferences,
  migrateInlineTextDictionaries,
  type DeviceConfig,
  type GlobalDictionaryDefinition,
} from '@deviceforge/core';
import { z } from 'zod';
import type { DictionaryRepository } from './dictionary-store';

const StoreFileSchema = z.object({
  version: z.number().int().default(1),
  devices: z.array(z.unknown()).default([]),
});

function rawId(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const id = (raw as Record<string, unknown>).id;
  return typeof id === 'string' ? id : undefined;
}

function rawName(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const name = (raw as Record<string, unknown>).name;
  return typeof name === 'string' ? name : undefined;
}

function rawDictionaryIds(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const codec = (raw as Record<string, unknown>).codec;
  if (codec === null || typeof codec !== 'object' || Array.isArray(codec)) return [];
  const codecRecord = codec as Record<string, unknown>;
  if (codecRecord.type !== 'text' || !Array.isArray(codecRecord.messages)) return [];

  const ids = new Set<string>();
  for (const message of codecRecord.messages) {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      continue;
    }
    const slots = (message as Record<string, unknown>).slots;
    if (!Array.isArray(slots)) continue;
    for (const slot of slots) {
      if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
        continue;
      }
      const record = slot as Record<string, unknown>;
      if (record.kind === 'repeat' && typeof record.dictionary === 'string') {
        ids.add(record.dictionary);
      }
    }
  }
  return [...ids];
}

export interface InvalidDeviceDictionaryReference {
  dictionaryId: string;
  deviceId: string;
  deviceName: string;
}

interface LoadedDevice {
  original: unknown;
  config: DeviceConfig;
}

export class DeviceStore {
  private readonly devices = new Map<string, DeviceConfig>();
  /** 读取失败/引用缺失的原始记录；保存时原样写回，避免迁移时丢数据。 */
  private readonly invalidRecords: unknown[] = [];

  constructor(
    private readonly filePath: string,
    private readonly dictionaries: DictionaryRepository,
  ) {
    this.load();
  }

  list(): DeviceConfig[] {
    return [...this.devices.values()];
  }

  /**
   * 无效设备暂不自动重试，必须修复配置并重启服务。它们仍受字典删除保护，
   * 避免跳过的原始记录继续引用某字典时，该字典被误删。
   */
  invalidDictionaryReferences(): InvalidDeviceDictionaryReference[] {
    const references: InvalidDeviceDictionaryReference[] = [];
    this.invalidRecords.forEach((record, index) => {
      const ids = rawDictionaryIds(record);
      if (ids.length === 0) return;

      const rawDeviceId = rawId(record);
      const rawDeviceName = rawName(record);
      const deviceId = rawDeviceId ?? `invalid-record-${index + 1}`;
      const deviceName = rawDeviceName
        ? `${rawDeviceName}（配置无效）`
        : `无效设备记录 ${index + 1}`;
      for (const dictionaryId of ids) {
        references.push({ dictionaryId, deviceId, deviceName });
      }
    });
    return references;
  }

  get(id: string): DeviceConfig | undefined {
    return this.devices.get(id);
  }

  has(id: string): boolean {
    return this.devices.has(id);
  }

  hasStoredId(id: string): boolean {
    return this.devices.has(id) || this.invalidRecords.some(
      (record) => rawId(record) === id,
    );
  }

  hasInvalidRecord(id: string): boolean {
    return this.invalidRecords.some((record) => rawId(record) === id);
  }

  create(config: DeviceConfig): DeviceConfig {
    if (this.hasStoredId(config.id)) throw new Error(`设备 ${config.id} 已存在`);
    this.devices.set(config.id, config);
    try {
      this.save();
    } catch (error) {
      this.devices.delete(config.id);
      throw error;
    }
    return config;
  }

  update(id: string, config: DeviceConfig): DeviceConfig {
    if (!this.devices.has(id)) throw new Error(`设备 ${id} 不存在`);
    if (config.id !== id) throw new Error('不能修改设备 ID');
    if (this.hasInvalidRecord(id)) {
      throw new Error(`设备 ${id} 还有同 ID 的无效配置记录，请先修复 devices.json`);
    }
    const previous = this.devices.get(id)!;
    this.devices.set(id, config);
    try {
      this.save();
    } catch (error) {
      this.devices.set(id, previous);
      throw error;
    }
    return config;
  }

  delete(id: string): boolean {
    const previous = this.devices.get(id);
    const deleted = this.devices.delete(id);
    if (deleted) {
      try {
        this.save();
      } catch (error) {
        this.devices.set(id, previous!);
        throw error;
      }
    }
    return deleted;
  }

  // 单条无效设备配置跳过，避免一条坏数据阻塞启动；迁移必须在
  // DeviceConfigSchema.parse 之前执行，否则 codec.dictionaries 会被 strip。
  private load(): void {
    if (!existsSync(this.filePath)) return;

    let rawRecords: unknown[];
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      rawRecords = StoreFileSchema.parse(raw).devices;
    } catch (error) {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        copyFileSync(this.filePath, backup);
      } catch {
        // 备份失败可忽略
      }
      console.error(`[store] 读取 ${this.filePath} 失败，已备份到 ${backup}`, error);
      return;
    }

    const existing = this.dictionaries.list();
    const pendingDefinitions: GlobalDictionaryDefinition[] = [];
    const candidates: LoadedDevice[] = [];
    let migratedAny = false;

    // 第一遍：迁移原始对象并做 schema 校验；引用校验留到所有设备迁移出的
    // 字典都汇总之后，支持设备 A 定义、设备 B 引用的前向关系。
    for (const item of rawRecords) {
      const migration = migrateInlineTextDictionaries(
        item,
        [...existing, ...pendingDefinitions],
        { source: rawId(item) },
      );
      if (migration.errors.length > 0) {
        console.warn(
          `[store] 设备 ${rawId(item) ?? '(unknown)'} 的内联字典无法迁移`,
          migration.errors,
        );
        this.invalidRecords.push(item);
        continue;
      }

      const parsed = DeviceConfigSchema.safeParse(migration.config);
      if (!parsed.success) {
        console.warn(`[store] 跳过无效设备配置`, parsed.error.issues);
        this.invalidRecords.push(item);
        continue;
      }

      if (migration.changed) {
        migratedAny = true;
        for (const definition of migration.definitions) {
          if (!pendingDefinitions.some((item) => item.id === definition.id)) {
            pendingDefinitions.push(definition);
          }
        }
      }

      candidates.push({
        original: item,
        config: parsed.data,
      });
    }

    let importFailed = false;
    if (pendingDefinitions.length > 0) {
      try {
        this.dictionaries.importDefinitions(pendingDefinitions);
      } catch (error) {
        importFailed = true;
        console.error('[store] 写入迁移字典失败，保留原始 devices.json', error);
      }
    }

    const available = new Set(this.dictionaries.list().map((item) => item.id));
    for (const candidate of candidates) {
      const missing = findMissingDictionaryReferences(
        candidate.config,
        (id) => available.has(id),
      );
      if (missing.length > 0) {
        console.warn(
          `[store] 设备 ${candidate.config.id} 引用了不存在的字典`,
          missing,
        );
        this.invalidRecords.push(candidate.original);
        continue;
      }
      this.devices.set(candidate.config.id, candidate.config);
    }

    if (migratedAny && !importFailed) {
      const backup = `${this.filePath}.pre-dictionary-migration-${Date.now()}.bak`;
      try {
        copyFileSync(this.filePath, backup);
      } catch (error) {
        console.warn(`[store] 备份 ${this.filePath} 失败`, error);
      }
      this.save();
    }
  }

  // 先写同目录临时文件再 rename；同目录 rename 是原子操作，崩溃时不会
  // 留下截断的 devices.json。
  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const payload = {
      version: 1,
      devices: [...this.devices.values(), ...this.invalidRecords],
    };
    writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tempPath, this.filePath);
  }
}
