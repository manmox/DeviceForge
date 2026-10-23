import {
  DeviceConfigSchema,
  OutgoingMessageSchema,
  findMissingDictionaryReferences,
  migrateInlineTextDictionaries,
} from '@deviceforge/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { issuesOf } from '../lib/device-validation';
import type { RuntimeManager } from '../runtime-manager';
import type { DictionaryStore } from '../store/dictionary-store';

const IdParamsSchema = z.object({
  id: z.string().min(1),
});

const ConnectionParamsSchema = z.object({
  id: z.string().min(1),
  connId: z.string().min(1),
});

const SendBodySchema = z.object({
  connectionId: z.string().optional(),
  target: z.enum(['all', 'last']).default('last'),
  message: OutgoingMessageSchema,
});

const TrafficQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});

const StateBodySchema = z.object({
  state: z.record(z.string(), z.unknown()),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function registerDeviceRoutes(
  app: FastifyInstance,
  manager: RuntimeManager,
  dictionaries: DictionaryStore,
): Promise<void> {
  app.get('/api/devices', async () => {
    return { devices: manager.list() };
  });

  app.get('/api/devices/:id', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const summary = manager.get(id);
    if (!summary) return reply.code(404).send({ error: `设备 ${id} 不存在` });

    const runtime = manager.find(id);
    return {
      ...summary,
      state: runtime?.getState() ?? summary.config.state,
      traffic: runtime?.getTraffic(200) ?? [],
    };
  });

  app.post('/api/devices', async (request, reply) => {
    const migration = migrateInlineTextDictionaries(
      request.body,
      dictionaries.list(),
    );
    if (migration.errors.length > 0) {
      return reply.code(422).send({
        error: '内联字典迁移失败',
        issues: migration.errors.map((error) => ({
          path: `codec.dictionaries.${error.dictionary}`,
          message: error.message,
        })),
      });
    }

    const parsed = DeviceConfigSchema.safeParse(migration.config);
    if (!parsed.success) {
      return reply.code(422).send({ error: '配置校验失败', issues: issuesOf(parsed.error) });
    }
    const config = parsed.data;
    if (manager.get(config.id)) {
      return reply.code(409).send({ error: `设备 ${config.id} 已存在` });
    }

    const available = new Set([
      ...dictionaries.list().map((item) => item.id),
      ...migration.definitions.map((item) => item.id),
    ]);
    const missing = findMissingDictionaryReferences(
      config,
      (id) => available.has(id),
    );
    if (missing.length > 0) {
      return reply.code(422).send({
        error: '配置校验失败',
        issues: missing.map((reference) => ({
          path: reference.path,
          message: `字典 ${reference.dictionaryId} 不存在`,
        })),
      });
    }

    dictionaries.importDefinitions(migration.definitions);
    return reply.code(201).send(manager.create(config));
  });

  app.put('/api/devices/:id', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const migration = migrateInlineTextDictionaries(
      request.body,
      dictionaries.list(),
      { source: id },
    );
    if (migration.errors.length > 0) {
      return reply.code(422).send({
        error: '内联字典迁移失败',
        issues: migration.errors.map((error) => ({
          path: `codec.dictionaries.${error.dictionary}`,
          message: error.message,
        })),
      });
    }

    const parsed = DeviceConfigSchema.safeParse(migration.config);
    if (!parsed.success) {
      return reply.code(422).send({ error: '配置校验失败', issues: issuesOf(parsed.error) });
    }
    const config = parsed.data;
    if (config.id !== id) {
      return reply.code(400).send({ error: '请求路径中的 id 与配置中的 id 不一致' });
    }

    const summary = manager.get(id);
    if (!summary) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    if (manager.find(id)?.isActive) {
      return reply.code(409).send({ error: '请先停止设备再修改配置' });
    }

    const available = new Set([
      ...dictionaries.list().map((item) => item.id),
      ...migration.definitions.map((item) => item.id),
    ]);
    const missing = findMissingDictionaryReferences(
      config,
      (idValue) => available.has(idValue),
    );
    if (missing.length > 0) {
      return reply.code(422).send({
        error: '配置校验失败',
        issues: missing.map((reference) => ({
          path: reference.path,
          message: `字典 ${reference.dictionaryId} 不存在`,
        })),
      });
    }

    dictionaries.importDefinitions(migration.definitions);
    return manager.update(id, config);
  });

  app.delete('/api/devices/:id', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    if (!manager.get(id)) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    await manager.remove(id);
    return reply.code(204).send();
  });

  app.post('/api/devices/:id/start', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    if (!manager.get(id)) return reply.code(404).send({ error: `设备 ${id} 不存在` });

    try {
      return { status: await manager.start(id) };
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.post('/api/devices/:id/stop', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    if (!manager.get(id)) return reply.code(404).send({ error: `设备 ${id} 不存在` });

    try {
      return { status: await manager.stop(id) };
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.post('/api/devices/:id/restart', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    if (!manager.get(id)) return reply.code(404).send({ error: `设备 ${id} 不存在` });

    try {
      return { status: await manager.restart(id) };
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.post('/api/devices/:id/send', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body = SendBodySchema.parse(request.body);
    const runtime = manager.find(id);
    if (!runtime) return reply.code(404).send({ error: `设备 ${id} 不存在` });

    try {
      await runtime.send(body.message, {
        connectionId: body.connectionId,
        target: body.target,
      });
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.get('/api/devices/:id/traffic', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const { limit } = TrafficQuerySchema.parse(request.query);
    const runtime = manager.find(id);
    if (!runtime) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    return { events: runtime.getTraffic(limit) };
  });

  app.delete('/api/devices/:id/traffic', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const runtime = manager.find(id);
    if (!runtime) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    runtime.clearTraffic();
    return { ok: true };
  });

  app.get('/api/devices/:id/state', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const runtime = manager.find(id);
    if (!runtime) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    return { state: runtime.getState() };
  });

  app.put('/api/devices/:id/state', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body = StateBodySchema.parse(request.body);
    const runtime = manager.find(id);
    if (!runtime) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    return { state: runtime.setState(body.state) };
  });

  app.get('/api/devices/:id/connections', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const runtime = manager.find(id);
    if (!runtime) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    return { connections: runtime.getConnections() };
  });

  app.post('/api/devices/:id/connections/:connId/disconnect', async (request, reply) => {
    const { id, connId } = ConnectionParamsSchema.parse(request.params);
    const runtime = manager.find(id);
    if (!runtime) return reply.code(404).send({ error: `设备 ${id} 不存在` });

    try {
      await runtime.disconnectConnection(connId);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });
}
