import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { FaultInjectionConfigSchema } from '@deviceforge/core';
import { ProjectFileApplicationService } from '../application/project-file-service';
import type { McpCapabilities } from '../mcp/capabilities';
import { startMcpHttpServer } from '../mcp/http-transport';

const directories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'deviceforge-mcp-'));
  directories.push(directory);
  return directory;
}

function capabilities(root: string, calls: string[] = []): McpCapabilities {
  const status = {
    deviceId: 'sim-a',
    state: 'stopped' as const,
    transport: { kind: 'tcp-server' as const, state: 'idle' as const },
    endpoints: [],
    connections: [],
    counters: { rxBytes: 0, txBytes: 0, rxFrames: 0, txFrames: 0 },
    faultInjectionEnabled: false,
  };
  let faultInjection = FaultInjectionConfigSchema.parse({});
  let faultInjectionEnabled = false;
  const recordingId = '9c2e0b56-3db5-45d1-9f08-9b48a8a1f9d3';
  let recordingState: 'recording' | 'stopped' = 'stopped';
  let recordingExists = false;
  let recordingDeleted = false;
  const recordingSession = () => ({
    id: recordingId,
    deviceId: 'sim-a',
    startedAt: 1_700_000_000_000,
    ...(recordingState === 'stopped' ? { endedAt: 1_700_000_001_000 } : {}),
    state: recordingState,
    eventCount: 1,
  });
  const recordedEvent = {
    offsetMs: 125,
    event: {
      id: 'event-1',
      deviceId: 'sim-a',
      ts: 1_700_000_000_125,
      direction: 'in' as const,
      data: 'AA55',
      size: 2,
      mqtt: { topic: 'sensor/up', qos: 1 as const, retain: false, clientId: 'sim-client' },
    },
  };
  return {
    projectFiles: new ProjectFileApplicationService(root),
    devices: {
      list: () => [],
      get: () => undefined,
      listPresets: () => [],
      validateYaml: () => ({ ok: false, statusCode: 422, error: '配置无效' }),
      createFromYaml: () => ({ ok: false, statusCode: 422, error: '配置无效' }),
      updateFromYaml: () => ({ ok: false, statusCode: 422, error: '配置无效' }),
    },
    runtime: {
      start: async (id) => { calls.push(`start:${id}`); return status; },
      stop: async (id) => { calls.push(`stop:${id}`); return status; },
      restart: async (id) => { calls.push(`restart:${id}`); return status; },
      send: async (id) => { calls.push(`send:${id}`); },
      disconnect: async (id, connectionId) => { calls.push(`disconnect:${id}:${connectionId}`); },
    },
    traffic: { query: () => [] },
    faultInjection: {
      get: (id) => id === 'sim-a' ? { faultInjection, enabled: faultInjectionEnabled } : undefined,
      updateRules: (id, config) => {
        if (id !== 'sim-a') throw new Error(`设备 ${id} 不存在`);
        faultInjection = config;
        calls.push(`fault-rules:${id}`);
        return { faultInjection, enabled: faultInjectionEnabled };
      },
      setEnabled: async (id, enabled) => {
        if (id !== 'sim-a') throw new Error(`设备 ${id} 不存在`);
        faultInjectionEnabled = enabled;
        calls.push(`fault-enabled:${id}:${enabled}`);
        return { ...status, faultInjectionEnabled };
      },
    },
    recordings: {
      list: (id) => id === 'sim-a' && recordingExists && !recordingDeleted ? [recordingSession()] : [],
      start: (id) => {
        if (id !== 'sim-a') throw new Error(`设备 ${id} 不存在`);
        if (recordingState === 'recording') throw new Error('设备已有正在进行的录制');
        recordingState = 'recording';
        recordingExists = true;
        recordingDeleted = false;
        calls.push(`recording-start:${id}`);
        return recordingSession();
      },
      stop: (id, idToStop) => {
        if (id !== 'sim-a' || idToStop !== recordingId || recordingState !== 'recording') return undefined;
        recordingState = 'stopped';
        calls.push(`recording-stop:${id}`);
        return recordingSession();
      },
      readEvents: async (id, idToRead, offset, limit) => {
        if (id !== 'sim-a' || idToRead !== recordingId || recordingDeleted) return undefined;
        calls.push(`recording-read:${offset}:${limit}`);
        return { events: [recordedEvent].slice(offset, offset + limit), total: 1 };
      },
      delete: (id, idToDelete) => {
        if (id !== 'sim-a' || idToDelete !== recordingId || recordingDeleted) return false;
        if (recordingState === 'recording') throw new Error('请先停止录制再删除会话');
        recordingDeleted = true;
        recordingExists = false;
        calls.push(`recording-delete:${id}`);
        return true;
      },
    },
    modbus: {
      read: async () => { throw new Error('设备 sim-a 不是 Modbus 从站'); },
      write: async () => { throw new Error('设备 sim-a 不是 Modbus 从站'); },
    },
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('DeviceForge MCP HTTP 服务', () => {
  it('完成 Streamable HTTP 握手，注册分组工具并执行文件读取和运行操作', async () => {
    const root = tempDirectory();
    mkdirSync(path.join(root, 'data'));
    writeFileSync(path.join(root, 'data', 'devices.json'), '{"devices":[]}');
    const calls: string[] = [];
    const server = await startMcpHttpServer(capabilities(root, calls), 0);
    const client = new Client({ name: 'deviceforge-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(server.address));

    try {
      expect(server.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      await client.connect(transport);
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain('project_list_files');
      expect(names).toContain('devices_create_from_yaml');
      expect(names).toContain('runtime_send');
      expect(names).toContain('modbus_read');
      expect(names).toContain('modbus_write');
      expect(names).toContain('traffic_query');
      expect(names).toContain('fault_injection_get');
      expect(names).toContain('fault_injection_update_rules');
      expect(names).toContain('fault_injection_set_enabled');
      expect(names).toContain('recordings_list');
      expect(names).toContain('recordings_start');
      expect(names).toContain('recordings_stop');
      expect(names).toContain('recordings_read_events');
      expect(names).toContain('recordings_delete');
      expect(names).not.toContain('devices_delete');
      expect(names).not.toContain('traffic_clear');
      expect(tools.find((tool) => tool.name === 'project_search_files')?.inputSchema)
        .toMatchObject({ properties: { query: { minLength: 1 } } });

      const file = await client.callTool({
        name: 'project_read_file',
        arguments: { path: 'data/devices.json' },
      });
      expect(file.structuredContent).toMatchObject({ path: 'data/devices.json', content: '{"devices":[]}' });

      const traversal = await client.callTool({
        name: 'project_read_file',
        arguments: { path: '../outside.txt' },
      });
      expect(traversal.isError).toBe(true);

      let invalidArgumentsRejected = false;
      try {
        const invalid = await client.callTool({
          name: 'project_search_files',
          arguments: { query: '' },
        });
        invalidArgumentsRejected = invalid.isError === true;
      } catch {
        invalidArgumentsRejected = true;
      }
      expect(invalidArgumentsRejected).toBe(true);

      for (const action of ['start', 'stop', 'restart'] as const) {
        await client.callTool({ name: `runtime_${action}`, arguments: { id: 'sim-a' } });
      }
      await client.callTool({
        name: 'runtime_send',
        arguments: { id: 'sim-a', message: { hex: 'AA55' }, target: 'all' },
      });
      await client.callTool({
        name: 'runtime_disconnect',
        arguments: { id: 'sim-a', connectionId: 'conn-1' },
      });
      expect(calls).toEqual([
        'start:sim-a',
        'stop:sim-a',
        'restart:sim-a',
        'send:sim-a',
        'disconnect:sim-a:conn-1',
      ]);

      const faultSnapshot = await client.callTool({
        name: 'fault_injection_get',
        arguments: { id: 'sim-a' },
      });
      expect(faultSnapshot.structuredContent).toMatchObject({
        enabled: false,
        faultInjection: { segmentSizeBytes: 256, rules: [] },
      });

      const updatedFaultRules = await client.callTool({
        name: 'fault_injection_update_rules',
        arguments: {
          id: 'sim-a',
          faultInjection: {
            segmentSizeBytes: 128,
            rules: [{
              id: 'drop-second',
              name: '丢弃第二段',
              direction: 'in',
              trigger: { type: 'sequence', mode: 'indices', indices: [2] },
              action: { type: 'drop' },
            }],
          },
        },
      });
      expect(updatedFaultRules.structuredContent).toMatchObject({
        faultInjection: { segmentSizeBytes: 128, rules: [{ id: 'drop-second' }] },
      });

      const invalidFaultRules = await client.callTool({
        name: 'fault_injection_update_rules',
        arguments: {
          id: 'sim-a',
          faultInjection: { rules: [{ id: 'bad', name: '无效规则', trigger: {}, action: { type: 'unknown' } }] },
        },
      });
      expect(invalidFaultRules.isError).toBe(true);

      const faultEnabled = await client.callTool({
        name: 'fault_injection_set_enabled',
        arguments: { id: 'sim-a', enabled: true },
      });
      expect(faultEnabled.structuredContent).toEqual({ enabled: true });

      const recordingStart = await client.callTool({
        name: 'recordings_start',
        arguments: { id: 'sim-a' },
      });
      expect(recordingStart.structuredContent).toMatchObject({
        session: { id: '9c2e0b56-3db5-45d1-9f08-9b48a8a1f9d3', state: 'recording' },
      });
      const recordingList = await client.callTool({
        name: 'recordings_list',
        arguments: { id: 'sim-a' },
      });
      expect(recordingList.structuredContent).toMatchObject({
        sessions: [{ id: '9c2e0b56-3db5-45d1-9f08-9b48a8a1f9d3', state: 'recording' }],
      });

      const recordedPage = await client.callTool({
        name: 'recordings_read_events',
        arguments: { id: 'sim-a', recordingId: '9c2e0b56-3db5-45d1-9f08-9b48a8a1f9d3' },
      });
      expect(recordedPage.structuredContent).toMatchObject({
        total: 1,
        events: [{
          offsetMs: 125,
          event: { data: 'AA55', mqtt: { topic: 'sensor/up', clientId: 'sim-client' } },
        }],
      });

      const missingRecording = await client.callTool({
        name: 'recordings_read_events',
        arguments: { id: 'sim-a', recordingId: '9c2e0b56-3db5-45d1-9f08-9b48a8a1f9d4' },
      });
      expect(missingRecording.isError).toBe(true);

      const oversizedPage = await client.callTool({
        name: 'recordings_read_events',
        arguments: {
          id: 'sim-a',
          recordingId: '9c2e0b56-3db5-45d1-9f08-9b48a8a1f9d3',
          limit: 1001,
        },
      });
      expect(oversizedPage.isError).toBe(true);

      const activeDelete = await client.callTool({
        name: 'recordings_delete',
        arguments: { id: 'sim-a', recordingId: '9c2e0b56-3db5-45d1-9f08-9b48a8a1f9d3' },
      });
      expect(activeDelete.isError).toBe(true);

      const stopped = await client.callTool({
        name: 'recordings_stop',
        arguments: { id: 'sim-a', recordingId: '9c2e0b56-3db5-45d1-9f08-9b48a8a1f9d3' },
      });
      expect(stopped.structuredContent).toMatchObject({ session: { state: 'stopped' } });

      const deleted = await client.callTool({
        name: 'recordings_delete',
        arguments: { id: 'sim-a', recordingId: '9c2e0b56-3db5-45d1-9f08-9b48a8a1f9d3' },
      });
      expect(deleted.structuredContent).toEqual({ deleted: true });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
