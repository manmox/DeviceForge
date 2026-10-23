import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
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
      expect(names).toContain('traffic_query');
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
    } finally {
      await client.close();
      await server.close();
    }
  });
});
