import {
  GlobalDictionaryDefinitionSchema,
  collectDictionaryReferences,
  type GlobalDictionaryDefinition,
} from '@deviceforge/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DeviceStore } from '../store/device-store';
import { DictionaryStore } from '../store/dictionary-store';

const IdParamsSchema = z.object({
  id: z.string().min(1),
});

interface Usage {
  id: string;
  name: string;
}

function usageByDevice(store: DeviceStore): Map<string, Usage[]> {
  const usage = new Map<string, Usage[]>();
  for (const config of store.list()) {
    for (const reference of collectDictionaryReferences(config)) {
      const list = usage.get(reference.dictionaryId) ?? [];
      if (!list.some((item) => item.id === config.id)) {
        list.push({ id: config.id, name: config.name });
      }
      usage.set(reference.dictionaryId, list);
    }
  }
  return usage;
}

function view(
  definition: GlobalDictionaryDefinition,
  dictionaries: DictionaryStore,
  usage: Map<string, Usage[]>,
) {
  return {
    ...definition,
    builtin: dictionaries.isBuiltin(definition.id),
    usedBy: usage.get(definition.id) ?? [],
  };
}

export async function registerDictionaryRoutes(
  app: FastifyInstance,
  dictionaries: DictionaryStore,
  devices: DeviceStore,
): Promise<void> {
  app.get('/api/dictionaries', async () => {
    const usage = usageByDevice(devices);
    return {
      dictionaries: dictionaries
        .list()
        .map((definition) => view(definition, dictionaries, usage)),
    };
  });

  app.get('/api/dictionaries/:id', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const definition = dictionaries.get(id);
    if (!definition) {
      return reply.code(404).send({ error: `字典 ${id} 不存在` });
    }
    return {
      dictionary: view(definition, dictionaries, usageByDevice(devices)),
    };
  });

  app.post('/api/dictionaries', async (request, reply) => {
    const definition = GlobalDictionaryDefinitionSchema.parse(request.body);
    const created = dictionaries.create(definition);
    return reply.code(201).send({
      dictionary: view(created, dictionaries, usageByDevice(devices)),
    });
  });

  app.put('/api/dictionaries/:id', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const definition = GlobalDictionaryDefinitionSchema.parse(request.body);
    if (definition.id !== id) {
      return reply.code(400).send({
        error: '请求路径中的 id 与字典中的 id 不一致',
      });
    }
    const updated = dictionaries.update(id, definition);
    return {
      dictionary: view(updated, dictionaries, usageByDevice(devices)),
    };
  });

  app.delete('/api/dictionaries/:id', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const definition = dictionaries.get(id);
    if (!definition) {
      return reply.code(404).send({ error: `字典 ${id} 不存在` });
    }
    if (dictionaries.isBuiltin(id)) {
      return reply.code(403).send({ error: `内置字典 ${id} 只读` });
    }

    const usedBy = usageByDevice(devices).get(id) ?? [];
    if (usedBy.length > 0) {
      return reply.code(409).send({
        error: `字典 ${id} 仍被 ${usedBy.length} 台设备引用，不能删除`,
        usedBy,
      });
    }

    dictionaries.delete(id);
    return reply.code(204).send();
  });
}
