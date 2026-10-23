import { TrafficEventSchema } from '@deviceforge/core';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { RecordingCapabilities } from '../capabilities';
import { errorResult, successResult } from './result';

const RecordingSessionSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  state: z.enum(['recording', 'stopped', 'interrupted', 'error']),
  eventCount: z.number().int().nonnegative(),
  error: z.string().optional(),
});

const RecordedTrafficEventSchema = z.object({
  offsetMs: z.number().nonnegative(),
  event: TrafficEventSchema,
});

const RecordingParamsSchema = z.object({
  id: z.string().min(1),
  recordingId: z.string().uuid(),
});

export function registerRecordingTools(
  server: McpServer,
  capabilities: RecordingCapabilities,
): void {
  server.registerTool(
    'recordings_list',
    {
      description: '列出指定设备的录制会话，包含会话状态和事件数量。',
      inputSchema: z.object({ id: z.string().min(1) }),
      outputSchema: z.object({ sessions: z.array(RecordingSessionSchema) }),
    },
    async ({ id }) => successResult({ sessions: capabilities.list(id) }),
  );

  server.registerTool(
    'recordings_start',
    {
      description: '开始录制指定设备的收发流量和系统事件。每台设备同时只能录制一个会话。',
      inputSchema: z.object({ id: z.string().min(1) }),
      outputSchema: z.object({ session: RecordingSessionSchema }),
    },
    async ({ id }) => {
      try {
        return successResult({ session: capabilities.start(id) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'recordings_stop',
    {
      description: '停止指定设备的活动录制会话。',
      inputSchema: RecordingParamsSchema,
      outputSchema: z.object({ session: RecordingSessionSchema }),
    },
    async ({ id, recordingId }) => {
      try {
        const session = capabilities.stop(id, recordingId);
        if (!session) return errorResult('录制会话不存在或已结束');
        return successResult({ session });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'recordings_read_events',
    {
      description: '分页读取录制会话中的历史事件；事件含相对时间偏移，不会重发到设备。',
      inputSchema: RecordingParamsSchema.extend({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(1000).default(200),
      }),
      outputSchema: z.object({
        total: z.number().int().nonnegative(),
        events: z.array(RecordedTrafficEventSchema),
      }),
    },
    async ({ id, recordingId, offset, limit }) => {
      try {
        const result = await capabilities.readEvents(id, recordingId, offset, limit);
        if (!result) return errorResult('录制会话不存在');
        return successResult(result, `返回 ${result.events.length}/${result.total} 条录制事件`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'recordings_delete',
    {
      description: '永久删除已停止的录制会话及其事件；活动会话必须先停止。',
      inputSchema: RecordingParamsSchema,
      outputSchema: z.object({ deleted: z.literal(true) }),
    },
    async ({ id, recordingId }) => {
      try {
        if (!capabilities.delete(id, recordingId)) {
          return errorResult('录制会话不存在');
        }
        return successResult({ deleted: true as const });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
