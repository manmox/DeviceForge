import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { McpCapabilities } from './capabilities';
import { createDeviceForgeMcpServer } from './server';

export interface McpHttpServer {
  address: string;
  close(): Promise<void>;
}

/** Owns only the local MCP transport; capabilities are composed by the application. */
export async function startMcpHttpServer(
  capabilities: McpCapabilities,
  port: number,
): Promise<McpHttpServer> {
  const app = createMcpFastifyApp({ host: '127.0.0.1' });
  const handler = toNodeHandler(
    createMcpHandler(() => createDeviceForgeMcpServer(capabilities)),
  );

  app.all('/mcp', async (request, reply) => {
    await handler(request.raw, reply.raw, request.body);
  });

  const address = await app.listen({ host: '127.0.0.1', port });
  return {
    address: `${address}/mcp`,
    close: () => app.close(),
  };
}
