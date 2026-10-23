import {
  OutgoingMessageSchema,
} from '@deviceforge/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DeviceConfigurationApplication } from '../application/contracts';
import type { RuntimeManager } from '../runtime-manager';

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
  deviceConfigs: Pick<DeviceConfigurationApplication, 'create' | 'update'>,
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
    const result = deviceConfigs.create(request.body);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        error: result.error,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.message ? { message: result.message } : {}),
      });
    }
    return reply.code(201).send(result.value);
  });

  app.put('/api/devices/:id', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const result = deviceConfigs.update(id, request.body);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        error: result.error,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.message ? { message: result.message } : {}),
      });
    }
    return result.value;
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
