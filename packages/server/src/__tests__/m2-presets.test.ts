import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PresetApplicationService } from '../application/preset-service';

describe('M3 Modbus 传输预设', () => {
  it('加载所有传输类型的示例预设', () => {
    const presetsDir = fileURLToPath(new URL('../../../../presets/', import.meta.url));
    const presets = new PresetApplicationService(presetsDir, { has: () => true }).list();
    const transportTypes = new Set(presets.map((preset) => preset.config.transport.type));

    expect(presets).toHaveLength(14);
    expect(transportTypes).toEqual(new Set([
      'tcp-server',
      'tcp-client',
      'mqtt-client',
      'mqtt-broker',
      'udp-server',
      'udp-client',
      'serial',
      'virtual-serial',
      'http-server',
      'websocket-server',
      'modbus-tcp',
      'modbus-rtu',
    ]));
  });
});
