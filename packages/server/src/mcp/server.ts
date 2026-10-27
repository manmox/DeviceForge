import { McpServer } from '@modelcontextprotocol/server';
import type { McpCapabilities } from './capabilities';
import { registerDeviceTools } from './tools/device-tools';
import { registerFaultInjectionTools } from './tools/fault-injection-tools';
import { registerProjectTools } from './tools/project-tools';
import { registerRecordingTools } from './tools/recording-tools';
import { registerRuntimeTools } from './tools/runtime-tools';
import { registerTrafficTools } from './tools/traffic-tools';
import { registerModbusTools } from './tools/modbus-tools';

export function createDeviceForgeMcpServer(capabilities: McpCapabilities): McpServer {
  const server = new McpServer({
    name: 'deviceforge',
    version: '0.1.0',
  });

  registerProjectTools(server, capabilities.projectFiles);
  registerDeviceTools(server, capabilities.devices);
  registerRuntimeTools(server, capabilities.runtime);
  registerTrafficTools(server, capabilities.traffic);
  registerFaultInjectionTools(server, capabilities.faultInjection);
  registerRecordingTools(server, capabilities.recordings);
  registerModbusTools(server, capabilities.modbus);

  return server;
}
