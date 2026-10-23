import { FaultInjectionConfigSchema } from '@deviceforge/core';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { FaultInjectionCapabilities } from '../capabilities';
import { errorResult, successResult } from './result';

const FaultInjectionOutputSchema = z.object({
  faultInjection: FaultInjectionConfigSchema,
  enabled: z.boolean(),
});

export function registerFaultInjectionTools(
  server: McpServer,
  capabilities: FaultInjectionCapabilities,
): void {
  server.registerTool(
    'fault_injection_get',
    {
      description: '读取设备的故障注入规则和当前运行时启用状态。',
      inputSchema: z.object({ id: z.string().min(1) }),
      outputSchema: FaultInjectionOutputSchema,
    },
    async ({ id }) => {
      const snapshot = capabilities.get(id);
      if (!snapshot) return errorResult(`设备 ${id} 不存在`);
      return successResult(snapshot);
    },
  );

  server.registerTool(
    'fault_injection_update_rules',
    {
      description: '校验并更新设备的故障注入规则；设备运行时也可热更新。',
      inputSchema: z.object({
        id: z.string().min(1),
        faultInjection: FaultInjectionConfigSchema,
      }),
      outputSchema: FaultInjectionOutputSchema,
    },
    async ({ id, faultInjection }) => {
      try {
        return successResult(capabilities.updateRules(id, faultInjection));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'fault_injection_set_enabled',
    {
      description: '启用或关闭运行中设备的故障注入；设备停止时不能切换。',
      inputSchema: z.object({ id: z.string().min(1), enabled: z.boolean() }),
      outputSchema: z.object({ enabled: z.boolean() }),
    },
    async ({ id, enabled }) => {
      try {
        const status = await capabilities.setEnabled(id, enabled);
        return successResult({ enabled: status.faultInjectionEnabled });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
