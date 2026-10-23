import { OutgoingMessageSchema } from '@deviceforge/core';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { RuntimeCapabilities } from '../capabilities';
import { errorResult, successResult } from './result';

const StatusOutputSchema = z.object({ status: z.record(z.string(), z.unknown()) });

export function registerRuntimeTools(server: McpServer, capabilities: RuntimeCapabilities): void {
  for (const action of ['start', 'stop', 'restart'] as const) {
    server.registerTool(
      `runtime_${action}`,
      {
        description: `${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}指定模拟设备。`,
        inputSchema: z.object({ id: z.string().min(1) }),
        outputSchema: StatusOutputSchema,
      },
      async ({ id }) => {
        try {
          const status = await capabilities[action](id);
          return successResult({ status });
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }

  server.registerTool(
    'runtime_send',
    {
      description: '向模拟设备发送一条已校验的消息。',
      inputSchema: z.object({
        id: z.string().min(1),
        message: OutgoingMessageSchema,
        connectionId: z.string().optional(),
        target: z.enum(['all', 'last']).default('last'),
      }),
      outputSchema: z.object({ ok: z.literal(true) }),
    },
    async ({ id, message, connectionId, target }) => {
      try {
        await capabilities.send(id, message, { connectionId, target });
        return successResult({ ok: true as const });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'runtime_disconnect',
    {
      description: '断开指定设备上的一个连接。',
      inputSchema: z.object({ id: z.string().min(1), connectionId: z.string().min(1) }),
      outputSchema: z.object({ ok: z.literal(true) }),
    },
    async ({ id, connectionId }) => {
      try {
        await capabilities.disconnect(id, connectionId);
        return successResult({ ok: true as const });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
