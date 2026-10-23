import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { DeviceCapabilities } from '../capabilities';
import { applicationErrorResult, errorResult, successResult } from './result';

const RecordSchema = z.record(z.string(), z.unknown());
const SummarySchema = z.object({ config: RecordSchema, status: RecordSchema });
const ValidationIssueSchema = z.object({ path: z.string(), message: z.string() });

export function registerDeviceTools(server: McpServer, capabilities: DeviceCapabilities): void {
  server.registerTool(
    'devices_list',
    {
      description: '列出所有已配置设备及其当前状态。配置中的传输凭据也会返回。',
      inputSchema: z.object({}),
      outputSchema: z.object({ devices: z.array(SummarySchema) }),
    },
    async () => successResult({ devices: capabilities.list() }),
  );

  server.registerTool(
    'devices_get',
    {
      description: '读取指定设备的配置、运行状态、设备状态变量和连接信息。',
      inputSchema: z.object({ id: z.string().min(1) }),
      outputSchema: z.object({
        device: SummarySchema,
        state: RecordSchema,
        connections: z.array(RecordSchema),
      }),
    },
    async ({ id }) => {
      const device = capabilities.get(id);
      if (!device) return errorResult(`设备 ${id} 不存在`);
      return successResult({
        device: device.summary,
        state: device.state,
        connections: device.connections,
      });
    },
  );

  server.registerTool(
    'devices_list_presets',
    {
      description: '列出可用设备预设及其 YAML 和归一化配置。',
      inputSchema: z.object({}),
      outputSchema: z.object({ presets: z.array(z.record(z.string(), z.unknown())) }),
    },
    async () => successResult({ presets: capabilities.listPresets() }),
  );

  server.registerTool(
    'devices_validate_config',
    {
      description: '校验设备 YAML 配置并返回补齐默认值后的配置；失败时返回问题列表。',
      inputSchema: z.object({ yaml: z.string() }),
      outputSchema: z.object({
        valid: z.boolean(),
        config: RecordSchema.optional(),
        error: z.string().optional(),
        message: z.string().optional(),
        issues: z.array(ValidationIssueSchema).optional(),
      }),
    },
    async ({ yaml }) => {
      const result = capabilities.validateYaml(yaml);
      if (!result.ok) {
        return successResult({
          valid: false,
          error: result.error,
          ...(result.message ? { message: result.message } : {}),
          ...(result.issues ? { issues: result.issues } : {}),
        });
      }
      return successResult({ valid: true, config: result.value });
    },
  );

  server.registerTool(
    'devices_create_from_yaml',
    {
      description: '校验 YAML 并创建设备配置，写入本机设备存储；设备不会自动启动。',
      inputSchema: z.object({ yaml: z.string() }),
      outputSchema: z.object({ device: SummarySchema }),
    },
    async ({ yaml }) => {
      try {
        const result = capabilities.createFromYaml(yaml);
        if (!result.ok) return applicationErrorResult(result);
        return successResult({ device: result.value });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'devices_update_from_yaml',
    {
      description: '校验 YAML 并更新已有设备配置；设备必须处于停止状态。',
      inputSchema: z.object({ id: z.string().min(1), yaml: z.string() }),
      outputSchema: z.object({ device: SummarySchema }),
    },
    async ({ id, yaml }) => {
      try {
        const result = capabilities.updateFromYaml(id, yaml);
        if (!result.ok) return applicationErrorResult(result);
        return successResult({ device: result.value });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
