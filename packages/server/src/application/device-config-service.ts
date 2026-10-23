import {
  DeviceConfigSchema,
  findMissingDictionaryReferences,
  migrateInlineTextDictionaries,
  type DeviceConfig,
} from '@deviceforge/core';
import YAML from 'yaml';
import { issuesOf, validateDeviceDocument } from '../lib/device-validation';
import type {
  ApplicationResult,
  DeviceConfigurationApplication,
  DeviceConfigurationRuntime,
  DeviceSummary,
  DictionaryRepository,
  ValidationIssue,
} from './contracts';

export type { ApplicationResult } from './contracts';

function failure<T>(
  statusCode: number,
  error: string,
  details: { issues?: ValidationIssue[]; message?: string } = {},
): ApplicationResult<T> {
  return { ok: false, statusCode, error, ...details };
}

/** Shared device-configuration rules for the REST API and MCP tools. */
export class DeviceConfigApplicationService implements DeviceConfigurationApplication {
  constructor(
    private readonly manager: DeviceConfigurationRuntime,
    private readonly dictionaries: DictionaryRepository,
  ) {}

  parseYaml(yaml: string): ApplicationResult<unknown> {
    try {
      return { ok: true, value: YAML.parse(yaml) };
    } catch (error) {
      return failure(422, 'YAML 解析失败', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  validateDocument(raw: unknown): ApplicationResult<DeviceConfig> {
    const result = validateDeviceDocument(raw, (id) => this.dictionaries.has(id));
    if (!result.config) {
      return failure(422, '配置校验失败', { issues: result.issues });
    }
    return { ok: true, value: result.config };
  }

  validateYaml(yaml: string): ApplicationResult<DeviceConfig> {
    const parsed = this.parseYaml(yaml);
    if (!parsed.ok) return parsed;
    return this.validateDocument(parsed.value);
  }

  createFromYaml(yaml: string): ApplicationResult<DeviceSummary> {
    const parsed = this.parseYaml(yaml);
    if (!parsed.ok) return parsed;
    return this.create(parsed.value);
  }

  updateFromYaml(id: string, yaml: string): ApplicationResult<DeviceSummary> {
    const parsed = this.parseYaml(yaml);
    if (!parsed.ok) return parsed;
    return this.update(id, parsed.value);
  }

  create(raw: unknown): ApplicationResult<DeviceSummary> {
    const migration = migrateInlineTextDictionaries(raw, this.dictionaries.list());
    if (migration.errors.length > 0) {
      return failure(422, '内联字典迁移失败', {
        issues: migration.errors.map((error) => ({
          path: `codec.dictionaries.${error.dictionary}`,
          message: error.message,
        })),
      });
    }

    const parsed = DeviceConfigSchema.safeParse(migration.config);
    if (!parsed.success) {
      return failure(422, '配置校验失败', { issues: issuesOf(parsed.error) });
    }

    const config = parsed.data;
    if (this.manager.hasStoredId(config.id)) {
      return failure(409, `设备 ${config.id} 已存在`);
    }

    const missing = this.missingDictionaries(config, migration.definitions);
    if (missing.length > 0) {
      return failure(422, '配置校验失败', {
        issues: missing.map((reference) => ({
          path: reference.path,
          message: `字典 ${reference.dictionaryId} 不存在`,
        })),
      });
    }

    this.dictionaries.importDefinitions(migration.definitions);
    return { ok: true, value: this.manager.create(config) };
  }

  update(id: string, raw: unknown): ApplicationResult<DeviceSummary> {
    const migration = migrateInlineTextDictionaries(raw, this.dictionaries.list(), {
      source: id,
    });
    if (migration.errors.length > 0) {
      return failure(422, '内联字典迁移失败', {
        issues: migration.errors.map((error) => ({
          path: `codec.dictionaries.${error.dictionary}`,
          message: error.message,
        })),
      });
    }

    const parsed = DeviceConfigSchema.safeParse(migration.config);
    if (!parsed.success) {
      return failure(422, '配置校验失败', { issues: issuesOf(parsed.error) });
    }

    const config = parsed.data;
    if (config.id !== id) {
      return failure(400, '请求路径中的 id 与配置中的 id 不一致');
    }

    const summary = this.manager.get(id);
    if (!summary) return failure(404, `设备 ${id} 不存在`);
    if (this.manager.hasInvalidRecord(id)) {
      return failure(409, `设备 ${id} 还有同 ID 的无效配置记录，请先修复 devices.json`);
    }
    if (this.manager.find(id)?.isActive) {
      return failure(409, '请先停止设备再修改配置');
    }

    const missing = this.missingDictionaries(config, migration.definitions);
    if (missing.length > 0) {
      return failure(422, '配置校验失败', {
        issues: missing.map((reference) => ({
          path: reference.path,
          message: `字典 ${reference.dictionaryId} 不存在`,
        })),
      });
    }

    this.dictionaries.importDefinitions(migration.definitions);
    return { ok: true, value: this.manager.update(id, config) };
  }

  private missingDictionaries(
    config: DeviceConfig,
    definitions: ReturnType<typeof migrateInlineTextDictionaries>['definitions'],
  ) {
    const available = new Set([
      ...this.dictionaries.list().map((item) => item.id),
      ...definitions.map((item) => item.id),
    ]);
    return findMissingDictionaryReferences(config, (id) => available.has(id));
  }
}
