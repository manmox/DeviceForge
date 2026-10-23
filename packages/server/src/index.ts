import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { DeviceConfigApplicationService } from './application/device-config-service';
import { PresetApplicationService } from './application/preset-service';
import { ProjectFileApplicationService } from './application/project-file-service';
import { control, mcp, paths } from './config';
import { registerConfigRoutes } from './routes/config';
import { registerDeviceRoutes } from './routes/devices';
import { registerDictionaryRoutes } from './routes/dictionaries';
import { createMcpCapabilities } from './mcp/create-capabilities';
import { startMcpHttpServer, type McpHttpServer } from './mcp/http-transport';
import { RuntimeManager } from './runtime-manager';
import { DeviceStore } from './store/device-store';
import { DictionaryStore } from './store/dictionary-store';
import { RecordingStore } from './store/recording-store';
import { WsHub } from './ws/hub';

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  });

  const dictionaries = new DictionaryStore(paths.dictionariesFile);
  const store = new DeviceStore(paths.devicesFile, dictionaries);
  const recordings = new RecordingStore(paths.recordingsDir);
  await recordings.initialize();
  const manager = new RuntimeManager(store, dictionaries.provider());
  const deviceConfigs = new DeviceConfigApplicationService(manager, dictionaries);
  const presets = new PresetApplicationService(paths.presetsDir, dictionaries);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: '请求参数无效',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : 500;
    const message = error instanceof Error ? error.message : String(error);

    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: message });
    }

    request.log.error(error);
    return reply.code(500).send({ error: message });
  });

  const indexFile = path.join(paths.webDist, 'index.html');
  const webBuilt = existsSync(indexFile);
  if (webBuilt) {
    await app.register(fastifyStatic, { root: paths.webDist, prefix: '/' });
  }

  await registerConfigRoutes(app, deviceConfigs, presets);
  await registerDeviceRoutes(app, manager, deviceConfigs, recordings);
  await registerDictionaryRoutes(app, dictionaries, store);

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (webBuilt && existsSync(indexFile)) {
      return reply.sendFile('index.html');
    }
    return reply
      .code(404)
      .type('text/plain; charset=utf-8')
      .send(
        'DeviceForge 前端尚未构建。\n开发模式请访问 Vite 地址（默认 http://127.0.0.1:5173），或先运行 pnpm build。\n',
      );
  });

  await app.listen({ host: control.host, port: control.port });

  const hub = new WsHub(app.server, () => ({
    devices: manager.list(),
    serverTime: Date.now(),
  }));

  dictionaries.onChange(() => hub.dictionariesChanged());
  manager.onTraffic((event) => hub.pushTraffic(event));
  manager.onTraffic((event) => recordings.append(event));
  recordings.onChange((deviceId) => hub.recordingsChanged(deviceId));
  manager.onStatus((status) => hub.status(status));
  manager.onConnections((deviceId, connections) => hub.connections(deviceId, connections));
  manager.onError((event) => hub.error(event));
  manager.onState((event) => hub.state(event));
  manager.onDevicesChanged(() => hub.devicesChanged());

  const mcpCapabilities = createMcpCapabilities({
    projectFiles: new ProjectFileApplicationService(paths.repoRoot),
    deviceConfigs,
    presets,
    runtimeManager: manager,
  });
  let mcpServer: McpHttpServer;
  try {
    mcpServer = await startMcpHttpServer(mcpCapabilities, mcp.port);
  } catch (error) {
    hub.close();
    await app.close();
    throw error;
  }

  app.log.info(`DeviceForge 控制台已启动: http://${control.host}:${control.port}`);
  app.log.info(`DeviceForge MCP 服务已启动: ${mcpServer.address}`);
  if (!webBuilt) {
    app.log.info('前端开发地址: http://127.0.0.1:5173');
  }

  await manager.autoStart();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`收到 ${signal}，正在关闭 DeviceForge...`);
    await mcpServer.close();
    await manager.stopAll();
    hub.close();
    await app.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('DeviceForge 启动失败', error);
  process.exit(1);
});
