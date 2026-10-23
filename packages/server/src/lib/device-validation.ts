import {
  DeviceConfigSchema,
  findMissingDictionaryReferences,
  hasInlineTextDictionaries,
  type DeviceConfig,
} from '@deviceforge/core';
import type { z } from 'zod';

export interface ValidationIssue {
  path: string;
  message: string;
}

export function issuesOf(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * 预览/静态配置校验：不接受旧内联字典，避免 Zod 静默 strip 后用户不知道
 * 数据为什么消失；设备 POST/PUT 和启动加载会先走迁移再校验。
 */
export function validateDeviceDocument(
  raw: unknown,
  hasDictionary: (id: string) => boolean,
): { config?: DeviceConfig; issues: ValidationIssue[] } {
  if (hasInlineTextDictionaries(raw)) {
    return {
      issues: [
        {
          path: 'codec.dictionaries',
          message:
            '内联字典已移除；请先在“数据字典”中创建全局字典，并在 repeat.dictionary 中引用 ID',
        },
      ],
    };
  }

  const parsed = DeviceConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { issues: issuesOf(parsed.error) };
  }

  const missing = findMissingDictionaryReferences(
    parsed.data,
    hasDictionary,
  );
  if (missing.length > 0) {
    return {
      issues: missing.map((reference) => ({
        path: reference.path,
        message: `字典 ${reference.dictionaryId} 不存在`,
      })),
    };
  }

  return { config: parsed.data, issues: [] };
}
