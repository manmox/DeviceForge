import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DeviceConfigSchema, type DeviceConfig } from '@deviceforge/core';
import type { FastifyInstance } from 'fastify';
import YAML from 'yaml';
import { z } from 'zod';
import { paths } from '../config';

const ValidateBodySchema = z.union([
  z.object({ yaml: z.string() }),
  z.object({ config: z.unknown() }),
]);

function issuesOf(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
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

    const parsed = DeviceConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return reply.code(422).send({ error: '配置校验失败', issues: issuesOf(parsed.error) });
    }

    return { config: parsed.data };
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
        const parsed = DeviceConfigSchema.safeParse(YAML.parse(yaml));
        if (!parsed.success) {
          console.warn(`[presets] 跳过无效预设 ${file}`, parsed.error.issues);
          continue;
        }
        presets.push({
          file,
          id: parsed.data.id,
          name: parsed.data.name,
          description: parsed.data.description ?? '',
          yaml,
          config: parsed.data,
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
