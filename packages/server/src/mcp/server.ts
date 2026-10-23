import { McpServer } from '@modelcontextprotocol/server';
import type { McpCapabilities } from './capabilities';
import { registerDeviceTools } from './tools/device-tools';
import { registerProjectTools } from './tools/project-tools';
import { registerRuntimeTools } from './tools/runtime-tools';
import { registerTrafficTools } from './tools/traffic-tools';

export function createDeviceForgeMcpServer(capabilities: McpCapabilities): McpServer {
  const server = new McpServer({
    name: 'deviceforge',
    version: '0.1.0',
  });

  registerProjectTools(server, capabilities.projectFiles);
  registerDeviceTools(server, capabilities.devices);
  registerRuntimeTools(server, capabilities.runtime);
  registerTrafficTools(server, capabilities.traffic);

  return server;
}
