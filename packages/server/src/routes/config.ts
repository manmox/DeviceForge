import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DeviceConfigurationApplication, PresetApplication } from '../application/contracts';
import { issuesOf } from '../lib/device-validation';

const ValidateBodySchema = z.union([
  z.object({ yaml: z.string() }),
  z.object({ config: z.unknown() }),
]);

export async function registerConfigRoutes(
  app: FastifyInstance,
  deviceConfigs: Pick<DeviceConfigurationApplication, 'validateYaml' | 'validateDocument'>,
  presets: PresetApplication,
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

    const result = 'yaml' in body.data
      ? deviceConfigs.validateYaml(body.data.yaml)
      : deviceConfigs.validateDocument(body.data.config);
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        error: result.error,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.message ? { message: result.message } : {}),
      });
    }

    return { config: result.value };
  });

  app.get('/api/presets', async () => ({ presets: presets.list() }));
}
