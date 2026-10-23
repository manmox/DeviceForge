import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DeviceConfig } from '@deviceforge/core';
import type { FastifyInstance } from 'fastify';
import YAML from 'yaml';
import { z } from 'zod';
import { paths } from '../config';
import { issuesOf, validateDeviceDocument } from '../lib/device-validation';
import type { DictionaryStore } from '../store/dictionary-store';

const ValidateBodySchema = z.union([
  z.object({ yaml: z.string() }),
  z.object({ config: z.unknown() }),
]);

export async function registerConfigRoutes(
  app: FastifyInstance,
  dictionaries: DictionaryStore,
): Promise<void> {
  app.get('/api/health', async () => ({
    ok: true,
    service: 'deviceforge',
    ts: Date.now(),
  }));

  app.post('/api/config/validate', async (request, reply) => {
    const body = ValidateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: '请求体需要包含 yaml 或 config', issues: issuesOf(body.error) });
    }

    let raw: unknown;
    if ('yaml' in body.data) {
      try {
        raw = YAML.parse(body.data.yaml);
      } catch (error) {
        return reply.code(422).send({
          error: 'YAML 解析失败',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      raw = body.data.config;
    }

    const result = validateDeviceDocument(raw, (id) => dictionaries.has(id));
    if (!result.config) {
      return reply.code(422).send({ error: '配置校验失败', issues: result.issues });
    }

    // 成功时返回经 Zod 归一化的完整配置（默认值已补齐），不是布尔值；可视化
    // 编辑器会用该值替换草稿。字典只保留 ID，绝不把 entries 物化回设备配置。
    return { config: result.config };
  });

  app.get('/api/presets', async () => {
    if (!existsSync(paths.presetsDir)) return { presets: [] };

    const files = readdirSync(paths.presetsDir)
      .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
      .sort();

    const presets: {
      file: string;
      id: string;
      name: string;
      description: string;
      yaml: string;
      config: DeviceConfig;
    }[] = [];
    for (const file of files) {
      try {
        const yaml = readFileSync(path.join(paths.presetsDir, file), 'utf8');
        const result = validateDeviceDocument(
          YAML.parse(yaml),
          (id) => dictionaries.has(id),
        );
        if (!result.config) {
          console.warn(`[presets] 跳过无效预设 ${file}`, result.issues);
          continue;
        }
        presets.push({
          file,
          id: result.config.id,
          name: result.config.name,
          description: result.config.description ?? '',
          yaml,
          config: result.config,
        });
      } catch (error) {
        console.warn(`[presets] 读取预设 ${file} 失败`, error);
      }
    }

    const priority = ['vendor-sensor', 'line-protocol', 'tcp-echo'];
    presets.sort((left, right) => {
      const leftIndex = priority.indexOf(left.id);
      const rightIndex = priority.indexOf(right.id);
      return (leftIndex === -1 ? priority.length : leftIndex) -
        (rightIndex === -1 ? priority.length : rightIndex);
    });

    return { presets };
  });
}
