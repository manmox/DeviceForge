import type {
  ModbusReadableTable,
  ModbusWritableTable,
} from '@deviceforge/core';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ModbusCapabilities } from '../capabilities';
import { errorResult, successResult } from './result';

const ReadSchema = z.object({
  id: z.string().min(1),
  table: z.enum(['coils', 'discreteInputs', 'holdingRegisters', 'inputRegisters'] satisfies ModbusReadableTable[]),
  address: z.number().int().min(0).max(65_535),
  quantity: z.number().int().min(1).max(2_000),
}).strict().superRefine((value, context) => {
  const max = value.table === 'coils' || value.table === 'discreteInputs' ? 2_000 : 125;
  if (value.quantity > max) {
    context.addIssue({ code: 'custom', path: ['quantity'], message: `该表一次最多读取 ${max} 项` });
  }
  if (value.address + value.quantity > 65_536) {
    context.addIssue({ code: 'custom', path: ['quantity'], message: '读取范围超出 Modbus 地址空间' });
  }
});

const WriteSchema = z.object({
  id: z.string().min(1),
  table: z.enum(['coils', 'holdingRegisters'] satisfies ModbusWritableTable[]),
  address: z.number().int().min(0).max(65_535),
  values: z.array(z.union([
    z.boolean(),
    z.number().int().min(0).max(65_535),
  ])).min(1).max(1_968),
  broadcast: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  const isCoils = value.table === 'coils';
  const max = isCoils ? 1_968 : 123;
  if (value.values.length > max) {
    context.addIssue({ code: 'custom', path: ['values'], message: `该表一次最多写入 ${max} 项` });
  }
  if (value.values.some((item) => isCoils ? typeof item !== 'boolean' : typeof item !== 'number')) {
    context.addIssue({ code: 'custom', path: ['values'], message: isCoils ? '线圈值必须是布尔值' : '保持寄存器值必须是整数' });
  }
  if (value.address + value.values.length > 65_536) {
    context.addIssue({ code: 'custom', path: ['values'], message: '写入范围超出 Modbus 地址空间' });
  }
});

const ResultSchema = z.object({
  mode: z.enum(['tcp', 'rtu']),
  unitId: z.number().int(),
  functionCode: z.number().int(),
  table: z.enum(['coils', 'discreteInputs', 'holdingRegisters', 'inputRegisters']),
  address: z.number().int(),
  quantity: z.number().int(),
  values: z.array(z.union([z.boolean(), z.number()])),
  requestHex: z.string(),
  responseHex: z.string().optional(),
  exceptionCode: z.number().int().optional(),
  broadcast: z.boolean().optional(),
});

export function registerModbusTools(server: McpServer, capabilities: ModbusCapabilities): void {
  server.registerTool(
    'modbus_read',
    {
      description: '通过运行中的 Modbus TCP 或虚拟 RTU 从站读取线圈或寄存器。地址使用零基 PDU 地址。',
      inputSchema: ReadSchema,
      outputSchema: ResultSchema,
    },
    async ({ id, table, address, quantity }) => {
      try {
        return successResult(await capabilities.read(id, table, address, quantity));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'modbus_write',
    {
      description: '通过运行中的 Modbus TCP 或虚拟 RTU 从站写线圈或保持寄存器。单值写入使用单写功能码，多值写入使用多写功能码；RTU 可选广播写入。',
      inputSchema: WriteSchema,
      outputSchema: ResultSchema,
    },
    async ({ id, table, address, values, broadcast }) => {
      try {
        const typedValues = table === 'coils' ? values as boolean[] : values as number[];
        return successResult(await capabilities.write(id, table, address, typedValues, broadcast));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
