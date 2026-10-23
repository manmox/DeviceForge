import { TrafficEventSchema } from '@deviceforge/core';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { TrafficCapabilities } from '../capabilities';
import { errorResult, successResult } from './result';

export function registerTrafficTools(server: McpServer, capabilities: TrafficCapabilities): void {
  server.registerTool(
    'traffic_query',
    {
      description: '查询设备最近的收发和系统事件。历史只保存在内存中，单次最多返回 5000 条。',
      inputSchema: z.object({
        id: z.string().min(1),
        limit: z.number().int().min(1).max(5000).default(500),
        direction: z.enum(['in', 'out', 'system']).optional(),
        since: z.number().nonnegative().optional().describe('起始时间，Unix 毫秒时间戳'),
      }),
      outputSchema: z.object({
        count: z.number(),
        events: z.array(TrafficEventSchema),
      }),
    },
    async ({ id, limit, direction, since }) => {
      const events = capabilities.query(id, { limit, direction, since });
      if (!events) return errorResult(`设备 ${id} 不存在`);
      return successResult(
        { count: events.length, events },
        `返回 ${events.length} 条设备 ${id} 的流量记录`,
      );
    },
  );
}
