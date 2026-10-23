import {
  DeviceConfigSchema,
  FaultInjectionConfigSchema,
  OutgoingMessageSchema,
  findMissingDictionaryReferences,
  migrateInlineTextDictionaries,
} from '@deviceforge/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { issuesOf } from '../lib/device-validation';
import type { RuntimeManager } from '../runtime-manager';
import type { DictionaryStore } from '../store/dictionary-store';
import type { RecordingStore } from '../store/recording-store';

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
const RecordingParamsSchema = z.object({
  id: z.string().min(1),
  recordingId: z.string().uuid(),
});
const RecordingEventsQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

const FaultInjectionRulesBodySchema = FaultInjectionConfigSchema;
const FaultInjectionEnabledBodySchema = z.object({ enabled: z.boolean() });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function registerDeviceRoutes(
  app: FastifyInstance,
  manager: RuntimeManager,
  dictionaries: DictionaryStore,
  recordings: RecordingStore,
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
    if (manager.hasStoredId(config.id)) {
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

    dictionaries.validateImportDefinitions(migration.definitions);
    const created = manager.create(config);
    try {
      dictionaries.importDefinitions(migration.definitions);
    } catch (error) {
      try {
        await manager.remove(config.id);
      } catch (rollbackError) {
        throw new Error(
          `字典迁移失败，且设备 ${config.id} 回滚失败：${errorMessage(rollbackError)}`,
          { cause: error },
        );
      }
      throw error;
    }
    return reply.code(201).send(created);
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
    if (manager.hasInvalidRecord(id)) {
      return reply.code(409).send({ error: `设备 ${id} 还有同 ID 的无效配置记录，请先修复 devices.json` });
    }
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

    dictionaries.validateImportDefinitions(migration.definitions);
    const previous = summary.config;
    const updated = manager.update(id, config);
    try {
      dictionaries.importDefinitions(migration.definitions);
    } catch (error) {
      try {
        manager.update(id, previous);
      } catch (rollbackError) {
        throw new Error(
          `字典迁移失败，且设备 ${id} 回滚失败：${errorMessage(rollbackError)}`,
          { cause: error },
        );
      }
      throw error;
    }
    return updated;
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

  app.get('/api/devices/:id/fault-injection', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const summary = manager.get(id);
    if (!summary) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    return {
      faultInjection: summary.config.faultInjection,
      enabled: summary.status.faultInjectionEnabled,
    };
  });

  app.put('/api/devices/:id/fault-injection/rules', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const current = manager.get(id);
    if (!current) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    const faultInjection = FaultInjectionRulesBodySchema.parse(request.body);
    const updated = manager.updateFaultInjection(id, faultInjection);
    return {
      faultInjection: updated.config.faultInjection,
      enabled: updated.status.faultInjectionEnabled,
    };
  });

  app.patch('/api/devices/:id/fault-injection', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    if (!manager.get(id)) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    const { enabled } = FaultInjectionEnabledBodySchema.parse(request.body);
    try {
      return { enabled: (await manager.setFaultInjectionEnabled(id, enabled)).faultInjectionEnabled };
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.get('/api/devices/:id/recordings', async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    return { recordings: recordings.list(id) };
  });

  app.post('/api/devices/:id/recordings', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    if (!manager.get(id)) return reply.code(404).send({ error: `设备 ${id} 不存在` });
    try {
      return reply.code(201).send({ recording: recordings.start(id) });
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.post('/api/devices/:id/recordings/:recordingId/stop', async (request, reply) => {
    const { id, recordingId } = RecordingParamsSchema.parse(request.params);
    try {
      const recording = recordings.stop(id, recordingId);
      if (!recording) return reply.code(404).send({ error: '录制会话不存在或已结束' });
      return { recording };
    } catch (error) {
      return reply.code(500).send({ error: `停止录制失败：${errorMessage(error)}` });
    }
  });

  app.get('/api/devices/:id/recordings/:recordingId/events', async (request, reply) => {
    const { id, recordingId } = RecordingParamsSchema.parse(request.params);
    const query = RecordingEventsQuerySchema.parse(request.query);
    const result = await recordings.readEvents(
      id,
      recordingId,
      query.offset,
      query.limit,
    );
    if (!result) return reply.code(404).send({ error: '录制会话不存在' });
    return result;
  });

  app.delete('/api/devices/:id/recordings/:recordingId', async (request, reply) => {
    const { id, recordingId } = RecordingParamsSchema.parse(request.params);
    try {
      if (!recordings.delete(id, recordingId)) {
        return reply.code(404).send({ error: '录制会话不存在' });
      }
      return reply.code(204).send();
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
