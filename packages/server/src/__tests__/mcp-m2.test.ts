import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import YAML from 'yaml';
import WebSocket, { type RawData } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrafficEvent } from '@deviceforge/core';
import { DeviceConfigApplicationService } from '../application/device-config-service';
import { PresetApplicationService } from '../application/preset-service';
import { ProjectFileApplicationService } from '../application/project-file-service';
import { createMcpCapabilities } from '../mcp/create-capabilities';
import { startMcpHttpServer, type McpHttpServer } from '../mcp/http-transport';
import { RuntimeManager } from '../runtime-manager';
import { DeviceStore } from '../store/device-store';
import { DictionaryStore } from '../store/dictionary-store';
import { RecordingStore } from '../store/recording-store';

interface Harness {
  root: string;
  manager: RuntimeManager;
  recordings: RecordingStore;
  server: McpHttpServer;
  client: Client;
}

interface RuntimeStatusOutput {
  status: {
    state: string;
    endpoints: string[];
    connections: Array<{ id: string }>;
  };
}

interface DeviceOutput {
  device: {
    config: { id: string; transport: { type: string } };
    status: { state: string; endpoints: string[] };
  };
  state: Record<string, unknown>;
  connections: Array<{ id: string }>;
}

interface TrafficOutput {
  count: number;
  events: TrafficEvent[];
}

const harnesses: Harness[] = [];
const presetsDir = fileURLToPath(new URL('../../../../presets/', import.meta.url));
const socatAvailable = (() => {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return false;
  try {
    execFileSync('socat', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error(message);
}

async function createHarness(): Promise<Harness> {
  const root = mkdtempSync(path.join(tmpdir(), 'deviceforge-mcp-m2-'));
  const dictionaries = new DictionaryStore(path.join(root, 'dictionaries.json'));
  const store = new DeviceStore(path.join(root, 'devices.json'), dictionaries);
  const recordings = new RecordingStore(path.join(root, 'recordings'));
  await recordings.initialize();
  const manager = new RuntimeManager(store, dictionaries.provider());
  manager.onTraffic((event) => recordings.append(event));
  const deviceConfigs = new DeviceConfigApplicationService(manager, dictionaries);
  const presets = new PresetApplicationService(presetsDir, dictionaries);
  const capabilities = createMcpCapabilities({
    projectFiles: new ProjectFileApplicationService(root),
    deviceConfigs,
    presets,
    recordings,
    runtimeManager: manager,
  });
  const server = await startMcpHttpServer(capabilities, 0);
  const client = new Client({ name: 'deviceforge-m2-acceptance', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(server.address)));
  } catch (error) {
    await server.close();
    await manager.stopAll();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const harness = { root, manager, recordings, server, client };
  harnesses.push(harness);
  return harness;
}

async function call<T>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  }
  return result.structuredContent as T;
}

async function expectToolError(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
}

async function queryTraffic(client: Client, id: string, direction?: 'in' | 'out' | 'system') {
  return call<TrafficOutput>(client, 'traffic_query', {
    id,
    limit: 500,
    ...(direction ? { direction } : {}),
  });
}

function yaml(config: unknown): string {
  return YAML.stringify(config);
}

function portFromEndpoint(endpoint: string): number {
  const parsed = new URL(endpoint.includes('://') ? endpoint : `udp://${endpoint}`);
  return Number(parsed.port);
}

function nextWebSocketMessage(socket: WebSocket): Promise<{ data: Buffer; binary: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      socket.off('error', onError);
      reject(new Error('等待 MCP WebSocket 响应超时'));
    }, 2_000);
    const onError = (error: Error): void => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      reject(error);
    };
    const onMessage = (data: RawData, binary: boolean): void => {
      clearTimeout(timer);
      socket.off('error', onError);
      const buffer = Buffer.isBuffer(data)
        ? Buffer.from(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(data))
          : Buffer.concat(data);
      resolve({ data: buffer, binary });
    };
    socket.once('message', onMessage);
    socket.once('error', onError);
  });
}

async function closeWebSocket(socket: WebSocket | undefined): Promise<void> {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  socket.terminate();
  await once(socket, 'close').catch(() => undefined);
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.manager.stopAll();
    await harness.client.close();
    await harness.server.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

describe('MCP M2/M3 真实调用链', () => {
  it('校验、创建并读取全部新增传输配置，返回配置错误', async () => {
    const harness = await createHarness();
    const presets = await call<{
      presets: Array<{ config: { transport: { type: string } } }>;
    }>(harness.client, 'devices_list_presets');
    expect(presets.presets).toHaveLength(14);
    expect(new Set(presets.presets.map((preset) => preset.config.transport.type))).toEqual(new Set([
      'tcp-server', 'tcp-client', 'mqtt-client', 'mqtt-broker',
      'udp-server', 'udp-client', 'serial', 'virtual-serial',
      'http-server', 'websocket-server',
      'modbus-tcp', 'modbus-rtu',
    ]));

    const configs = [
      { id: 'mcp-udp-server', name: 'MCP UDP Server', transport: { type: 'udp-server', host: '127.0.0.1', port: 0 } },
      { id: 'mcp-udp-client', name: 'MCP UDP Client', transport: { type: 'udp-client', host: '127.0.0.1', port: 9, localPort: 0 } },
      { id: 'mcp-physical-serial', name: 'MCP Physical Serial', transport: { type: 'serial', portPath: '/dev/deviceforge-mcp-validation-only' } },
      { id: 'mcp-virtual-serial', name: 'MCP Virtual Serial', transport: { type: 'virtual-serial' } },
      { id: 'mcp-http-server', name: 'MCP HTTP Server', transport: { type: 'http-server', host: '127.0.0.1', port: 0 } },
      { id: 'mcp-websocket-server', name: 'MCP WebSocket Server', transport: { type: 'websocket-server', host: '127.0.0.1', port: 0, path: '/mcp' } },
      { id: 'mcp-modbus-tcp', name: 'MCP Modbus TCP', transport: { type: 'modbus-tcp', host: '127.0.0.1', port: 0, unitId: 1, tables: { coils: { '0': false }, holdingRegisters: { '0': 17 } } } },
      { id: 'mcp-modbus-rtu', name: 'MCP Modbus RTU', transport: { type: 'modbus-rtu', unitId: 1, serial: { type: 'virtual-serial' }, tables: { coils: { '0': false }, holdingRegisters: { '0': 17 } } } },
    ];

    for (const config of configs) {
      const document = yaml(config);
      const validation = await call<{ valid: boolean; config: { transport: { type: string } } }>(
        harness.client,
        'devices_validate_config',
        { yaml: document },
      );
      expect(validation.valid, config.id).toBe(true);
      expect(validation.config.transport.type).toBe(config.transport.type);

      const created = await call<{ device: { config: { id: string } } }>(
        harness.client,
        'devices_create_from_yaml',
        { yaml: document },
      );
      expect(created.device.config.id).toBe(config.id);

      const read = await call<DeviceOutput>(harness.client, 'devices_get', { id: config.id });
      expect(read.device.config.transport.type).toBe(config.transport.type);
    }

    const listed = await call<{ devices: Array<{ config: { id: string } }> }>(
      harness.client,
      'devices_list',
    );
    expect(listed.devices.map((device) => device.config.id)).toEqual(configs.map(({ id }) => id));

    const malformed = await call<{ valid: boolean }>(harness.client, 'devices_validate_config', {
      yaml: 'id: [',
    });
    expect(malformed.valid).toBe(false);
    await expectToolError(harness.client, 'devices_create_from_yaml', { yaml: yaml(configs[0]) });
    await expectToolError(harness.client, 'devices_create_from_yaml', { yaml: 'id: [' });
  });

  it('经 MCP 启停 UDP Server/Client、收发、故障注入并查询流量', async () => {
    const harness = await createHarness();
    const serverConfig = {
      id: 'mcp-udp-roundtrip',
      name: 'MCP UDP roundtrip',
      transport: { type: 'udp-server', host: '127.0.0.1', port: 0 },
      rules: [{ on: 'frame', send: { hex: '4F4B' } }],
    };
    await call(harness.client, 'devices_create_from_yaml', { yaml: yaml(serverConfig) });
    const serverStart = await call<RuntimeStatusOutput>(harness.client, 'runtime_start', {
      id: serverConfig.id,
    });
    expect(serverStart.status.state).toBe('running');
    const serverPort = portFromEndpoint(serverStart.status.endpoints[0]!);

    const clientConfig = {
      id: 'mcp-udp-sender',
      name: 'MCP UDP sender',
      transport: { type: 'udp-client', host: '127.0.0.1', port: serverPort, localPort: 0 },
    };
    await call(harness.client, 'devices_create_from_yaml', { yaml: yaml(clientConfig) });
    const clientStart = await call<RuntimeStatusOutput>(harness.client, 'runtime_start', {
      id: clientConfig.id,
    });
    expect(clientStart.status.state).toBe('running');

    await expectToolError(harness.client, 'devices_update_from_yaml', {
      id: serverConfig.id,
      yaml: yaml({ ...serverConfig, description: 'cannot update while running' }),
    });

    await call(harness.client, 'runtime_send', {
      id: clientConfig.id,
      message: { hex: '50494E47' },
    });
    await waitFor(async () => (await queryTraffic(harness.client, clientConfig.id, 'in')).count === 1,
      'UDP Client 未收到 MCP UDP Server 的回复');
    const serverDevice = await call<DeviceOutput>(harness.client, 'devices_get', { id: serverConfig.id });
    expect(serverDevice.connections).toHaveLength(1);
    expect((await queryTraffic(harness.client, serverConfig.id, 'in')).count).toBe(1);
    expect((await queryTraffic(harness.client, serverConfig.id, 'out')).events[0]?.data).toBe('4f4b');

    const faultConfig = {
      segmentSizeBytes: 256,
      rules: [{
        id: 'mcp-drop-inbound',
        name: '丢弃 UDP 入站',
        direction: 'in',
        trigger: { type: 'probability', percent: 100 },
        action: { type: 'drop' },
      }],
    };
    await call(harness.client, 'fault_injection_update_rules', {
      id: serverConfig.id,
      faultInjection: faultConfig,
    });
    const enabled = await call<{ enabled: boolean }>(harness.client, 'fault_injection_set_enabled', {
      id: serverConfig.id,
      enabled: true,
    });
    expect(enabled.enabled).toBe(true);

    await call(harness.client, 'runtime_send', {
      id: clientConfig.id,
      message: { hex: '44524F50' },
    });
    await waitFor(async () => {
      const traffic = await queryTraffic(harness.client, serverConfig.id, 'system');
      return traffic.events.some((event) => event.note?.includes('故障注入'));
    }, 'MCP 流量查询未返回 UDP 故障注入事件');
    const serverTraffic = await queryTraffic(harness.client, serverConfig.id);
    expect(serverTraffic.events.filter((event) => event.direction === 'out')).toHaveLength(1);

    await call(harness.client, 'fault_injection_set_enabled', {
      id: serverConfig.id,
      enabled: false,
    });
    await call(harness.client, 'runtime_stop', { id: clientConfig.id });
    await call(harness.client, 'runtime_stop', { id: serverConfig.id });
    expect((await call<DeviceOutput>(harness.client, 'devices_get', { id: serverConfig.id })).device.status.state)
      .toBe('stopped');
  });

  it('经 MCP 启停 HTTP Server，查询请求响应流量并读取录制元数据', async () => {
    const harness = await createHarness();
    const config = {
      id: 'mcp-http-roundtrip',
      name: 'MCP HTTP roundtrip',
      transport: { type: 'http-server', host: '127.0.0.1', port: 0 },
      rules: [{
        on: 'frame',
        match: {
          'http.method': 'POST',
          'http.path': '/mcp-check',
          'http.query.source': 'mcp',
          'http.headers.x-check': 'yes',
        },
        set: { receivedBody: '$http.body' },
        send: { hex: '4F4B' },
        httpResponse: {
          statusCode: 202,
          headers: { 'x-mcp-acceptance': 'passed', 'content-type': 'text/plain' },
        },
      }],
    };
    await call(harness.client, 'devices_create_from_yaml', { yaml: yaml(config) });
    const started = await call<RuntimeStatusOutput>(harness.client, 'runtime_start', { id: config.id });
    expect(started.status.state).toBe('running');
    const recording = await call<{ session: { id: string; state: string } }>(
      harness.client,
      'recordings_start',
      { id: config.id },
    );
    expect(recording.session.state).toBe('recording');

    const response = await fetch(`${started.status.endpoints[0]!}/mcp-check?source=mcp`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-check': 'yes' },
      body: 'request from MCP acceptance',
    });
    expect(response.status).toBe(202);
    expect(response.headers.get('x-mcp-acceptance')).toBe('passed');
    expect(await response.text()).toBe('OK');

    const device = await call<DeviceOutput>(harness.client, 'devices_get', { id: config.id });
    expect(device.state.receivedBody).toBe('request from MCP acceptance');
    const traffic = await queryTraffic(harness.client, config.id);
    const inbound = traffic.events.find((event) => event.direction === 'in');
    const outbound = traffic.events.find((event) => event.direction === 'out');
    expect(inbound?.http).toMatchObject({
      method: 'POST',
      path: '/mcp-check',
      query: { source: 'mcp' },
      headers: { 'x-check': 'yes' },
    });
    expect(outbound?.httpResponse).toMatchObject({
      statusCode: 202,
      headers: { 'x-mcp-acceptance': 'passed' },
    });

    const stoppedRecording = await call<{ session: { state: string } }>(
      harness.client,
      'recordings_stop',
      { id: config.id, recordingId: recording.session.id },
    );
    expect(stoppedRecording.session.state).toBe('stopped');
    const recorded = await call<{
      total: number;
      events: Array<{ event: TrafficEvent }>;
    }>(harness.client, 'recordings_read_events', {
      id: config.id,
      recordingId: recording.session.id,
    });
    expect(recorded.total).toBeGreaterThanOrEqual(2);
    expect(recorded.events.some((event) => event.event.http?.path === '/mcp-check')).toBe(true);
    expect(recorded.events.some((event) => event.event.httpResponse?.statusCode === 202)).toBe(true);

    await call(harness.client, 'runtime_stop', { id: config.id });
  });

  it('经 MCP 管理 WebSocket Server，多客户端收发文本与二进制消息', async () => {
    const harness = await createHarness();
    const config = {
      id: 'mcp-websocket-roundtrip',
      name: 'MCP WebSocket roundtrip',
      transport: { type: 'websocket-server', host: '127.0.0.1', port: 0, path: '/mcp' },
      rules: [{ on: 'frame', set: { lastBinary: '$websocket.isBinary' }, send: { hex: '4F4B' } }],
    };
    await call(harness.client, 'devices_create_from_yaml', { yaml: yaml(config) });
    const started = await call<RuntimeStatusOutput>(harness.client, 'runtime_start', { id: config.id });
    let first: WebSocket | undefined;
    let second: WebSocket | undefined;
    try {
      first = new WebSocket(started.status.endpoints[0]!);
      await once(first, 'open');
      const firstConnection = await waitFor(async () => {
        const device = await call<DeviceOutput>(harness.client, 'devices_get', { id: config.id });
        return device.connections.length === 1;
      }, 'MCP devices_get 未显示首个 WebSocket 客户端').then(async () =>
        (await call<DeviceOutput>(harness.client, 'devices_get', { id: config.id })).connections[0]!.id,
      );

      second = new WebSocket(started.status.endpoints[0]!);
      await once(second, 'open');
      await waitFor(async () =>
        (await call<DeviceOutput>(harness.client, 'devices_get', { id: config.id })).connections.length === 2,
      'MCP devices_get 未显示两个 WebSocket 客户端');
      const deviceWithTwoPeers = await call<DeviceOutput>(harness.client, 'devices_get', { id: config.id });
      const secondConnection = deviceWithTwoPeers.connections.find(({ id }) => id !== firstConnection)!.id;

      const firstReply = nextWebSocketMessage(first);
      first.send('plain text');
      expect(await firstReply).toMatchObject({ data: Buffer.from('OK'), binary: false });

      const secondReply = nextWebSocketMessage(second);
      second.send(Buffer.from([0x01, 0x02]), { binary: true });
      expect(await secondReply).toMatchObject({ data: Buffer.from('OK'), binary: true });

      const targetedReply = nextWebSocketMessage(second);
      await call(harness.client, 'runtime_send', {
        id: config.id,
        connectionId: secondConnection,
        message: { hex: '4D4350' },
        target: 'last',
      });
      expect(await targetedReply).toMatchObject({ data: Buffer.from('MCP'), binary: true });

      const traffic = await queryTraffic(harness.client, config.id, 'in');
      expect(traffic.events.filter((event) => event.websocket?.isBinary).length).toBe(1);
      expect(traffic.events.map((event) => event.websocket?.path)).toEqual(['/mcp', '/mcp']);
      expect((await call<DeviceOutput>(harness.client, 'devices_get', { id: config.id })).connections)
        .toHaveLength(2);
    } finally {
      await call(harness.client, 'runtime_stop', { id: config.id });
      await Promise.all([closeWebSocket(first), closeWebSocket(second)]);
    }
  });

  it.skipIf(!socatAvailable)('经 MCP 启停虚拟串口并查询、清理两端 PTY', async () => {
    const harness = await createHarness();
    const config = {
      id: 'mcp-virtual-serial',
      name: 'MCP virtual serial',
      transport: { type: 'virtual-serial' },
    };
    const validation = await call<{ valid: boolean }>(harness.client, 'devices_validate_config', {
      yaml: yaml(config),
    });
    expect(validation.valid).toBe(true);
    await call(harness.client, 'devices_create_from_yaml', { yaml: yaml(config) });

    const started = await call<RuntimeStatusOutput>(harness.client, 'runtime_start', { id: config.id });
    expect(started.status.endpoints).toHaveLength(2);
    const device = await call<DeviceOutput>(harness.client, 'devices_get', { id: config.id });
    expect(device.device.status.endpoints).toEqual(started.status.endpoints);

    await call(harness.client, 'runtime_stop', { id: config.id });
    const stopped = await call<DeviceOutput>(harness.client, 'devices_get', { id: config.id });
    expect(stopped.device.status.state).toBe('stopped');
    expect(stopped.device.status.endpoints).toEqual([]);
  });

  it('经真实 MCP Client 调用 Modbus TCP 主站读写，并查询状态、流量和录制', async () => {
    const harness = await createHarness();
    const config = {
      id: 'mcp-modbus-tcp-roundtrip',
      name: 'MCP Modbus TCP roundtrip',
      transport: {
        type: 'modbus-tcp', host: '127.0.0.1', port: 0, unitId: 9,
        tables: {
          coils: { '0': false, '1': true },
          discreteInputs: { '0': true },
          holdingRegisters: { '0': 12, '1': 34 },
          inputRegisters: { '0': 56 },
        },
      },
    };
    const yamlConfig = yaml(config);
    expect((await call<{ valid: boolean }>(harness.client, 'devices_validate_config', { yaml: yamlConfig })).valid)
      .toBe(true);
    await call(harness.client, 'devices_create_from_yaml', { yaml: yamlConfig });
    const started = await call<RuntimeStatusOutput>(harness.client, 'runtime_start', { id: config.id });
    expect(started.status.state).toBe('running');

    const recording = await call<{ session: { id: string } }>(harness.client, 'recordings_start', { id: config.id });
    const readCoils = await call<{
      mode: string; functionCode: number; values: boolean[]; responseHex: string;
    }>(harness.client, 'modbus_read', {
      id: config.id, table: 'coils', address: 0, quantity: 2,
    });
    expect(readCoils).toMatchObject({ mode: 'tcp', functionCode: 1, values: [false, true] });
    expect(readCoils.responseHex).toBeDefined();

    const write = await call<{ functionCode: number; values: number[] }>(harness.client, 'modbus_write', {
      id: config.id, table: 'holdingRegisters', address: 0, values: [321, 654],
    });
    expect(write).toMatchObject({ functionCode: 16, values: [321, 654] });
    const readBack = await call<{ values: number[] }>(harness.client, 'modbus_read', {
      id: config.id, table: 'holdingRegisters', address: 0, quantity: 2,
    });
    expect(readBack.values).toEqual([321, 654]);

    const exception = await call<{ exceptionCode?: number; values: unknown[] }>(harness.client, 'modbus_read', {
      id: config.id, table: 'inputRegisters', address: 1, quantity: 1,
    });
    expect(exception).toMatchObject({ exceptionCode: 2, values: [] });
    await expectToolError(harness.client, 'runtime_send', {
      id: config.id, message: { hex: '010300000001' }, target: 'last',
    });
    await expectToolError(harness.client, 'modbus_read', {
      id: config.id, table: 'holdingRegisters', address: 0, quantity: 1, host: '127.0.0.1', port: 502,
    });
    await expectToolError(harness.client, 'modbus_write', {
      id: config.id, table: 'coils', address: 0, values: [true], broadcast: true,
    });

    const device = await call<DeviceOutput>(harness.client, 'devices_get', { id: config.id });
    expect(device.state.modbus).toMatchObject({ holdingRegisters: { '0': 321, '1': 654 } });
    const traffic = await queryTraffic(harness.client, config.id);
    expect(traffic.events.some((event) => event.modbus?.functionCode === 16 && event.direction === 'in')).toBe(true);
    expect(traffic.events.some((event) => event.modbus?.exceptionCode === 2)).toBe(true);

    await call(harness.client, 'recordings_stop', { id: config.id, recordingId: recording.session.id });
    const recorded = await call<{ total: number; events: Array<{ event: TrafficEvent }> }>(
      harness.client, 'recordings_read_events', { id: config.id, recordingId: recording.session.id },
    );
    expect(recorded.total).toBeGreaterThanOrEqual(5);
    expect(recorded.events.some((event) => event.event.modbus?.table === 'holdingRegisters')).toBe(true);
    await call(harness.client, 'runtime_stop', { id: config.id });
  });

  it.skipIf(!socatAvailable)('经真实 MCP Client 通过虚拟 RTU PTY 执行协议读写', async () => {
    const harness = await createHarness();
    const config = {
      id: 'mcp-modbus-rtu-roundtrip',
      name: 'MCP Modbus RTU roundtrip',
      transport: {
        type: 'modbus-rtu', unitId: 7,
        serial: { type: 'virtual-serial', baudRate: 9_600, dataBits: 8, stopBits: 1, parity: 'none' },
        tables: { coils: { '0': false }, holdingRegisters: { '0': 23, '1': 24 } },
      },
    };
    await call(harness.client, 'devices_create_from_yaml', { yaml: yaml(config) });
    const started = await call<RuntimeStatusOutput>(harness.client, 'runtime_start', { id: config.id });
    expect(started.status.endpoints).toHaveLength(2);
    const read = await call<{ mode: string; functionCode: number; values: number[] }>(
      harness.client, 'modbus_read', { id: config.id, table: 'holdingRegisters', address: 0, quantity: 2 },
    );
    expect(read).toMatchObject({ mode: 'rtu', functionCode: 3, values: [23, 24] });
    const write = await call<{ functionCode: number }>(harness.client, 'modbus_write', {
      id: config.id, table: 'coils', address: 0, values: [true],
    });
    expect(write.functionCode).toBe(5);
    const updated = await call<{ values: boolean[] }>(harness.client, 'modbus_read', {
      id: config.id, table: 'coils', address: 0, quantity: 1,
    });
    expect(updated.values).toEqual([true]);
    const broadcast = await call<{ broadcast?: boolean; unitId: number; responseHex?: string }>(harness.client, 'modbus_write', {
      id: config.id, table: 'holdingRegisters', address: 1, values: [99], broadcast: true,
    });
    expect(broadcast).toMatchObject({ broadcast: true, unitId: 0 });
    expect(broadcast.responseHex).toBeUndefined();
    const broadcastUpdated = await call<{ values: number[] }>(harness.client, 'modbus_read', {
      id: config.id, table: 'holdingRegisters', address: 1, quantity: 1,
    });
    expect(broadcastUpdated.values).toEqual([99]);
    await call(harness.client, 'runtime_stop', { id: config.id });
  });
});
