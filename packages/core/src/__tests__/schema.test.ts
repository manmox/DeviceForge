import { describe, expect, it } from 'vitest';
import { DeviceConfigSchema } from '../schema/device';

function baseConfig() {
  return {
    id: 'device-1',
    name: '测试设备',
    transport: { type: 'tcp-server', host: '127.0.0.1', port: 19001 },
  };
}

describe('DeviceConfigSchema deviceInfo', () => {
  it('keeps deviceInfo optional for old configurations', () => {
    const parsed = DeviceConfigSchema.parse(baseConfig());
    expect(parsed.deviceInfo).toBeUndefined();
    expect(parsed.framing).toEqual({ type: 'raw' });
    expect(parsed.codec).toEqual({ type: 'raw', display: 'hex' });
    expect(parsed.state).toEqual({});
    expect(parsed.rules).toEqual([]);
    expect(parsed.autoStart).toBe(false);
  });

  it('accepts full and partial deviceInfo blocks', () => {
    const parsed = DeviceConfigSchema.parse({
      ...baseConfig(),
      deviceInfo: {
        manufacturer: 'Acme',
        model: 'TH-100',
        serialNumber: 'SN-0001',
        hardwareVersion: 'HW-1.0',
        firmwareVersion: 'FW-1.0.3',
        tnsImei: 'TNS/IMEI:DEMO 0001',
      },
    });
    expect(parsed.deviceInfo).toEqual({
      manufacturer: 'Acme',
      model: 'TH-100',
      serialNumber: 'SN-0001',
      hardwareVersion: 'HW-1.0',
      firmwareVersion: 'FW-1.0.3',
      tnsImei: 'TNS/IMEI:DEMO 0001',
    });

    const partial = DeviceConfigSchema.parse({
      ...baseConfig(),
      deviceInfo: { serialNumber: 'SN-0002' },
    });
    expect(partial.deviceInfo).toEqual({ serialNumber: 'SN-0002' });
  });

  it('accepts an empty deviceInfo object and empty strings', () => {
    expect(
      DeviceConfigSchema.parse({ ...baseConfig(), deviceInfo: {} }).deviceInfo,
    ).toEqual({});
    expect(
      DeviceConfigSchema.parse({
        ...baseConfig(),
        deviceInfo: { model: '' },
      }).deviceInfo,
    ).toEqual({ model: '' });
  });

  it('strips unknown deviceInfo keys', () => {
    const parsed = DeviceConfigSchema.parse({
      ...baseConfig(),
      deviceInfo: { serialNumber: 'SN-0001', vendorFoo: 'keep out' },
    });
    expect(parsed.deviceInfo).toEqual({ serialNumber: 'SN-0001' });
    expect('vendorFoo' in (parsed.deviceInfo ?? {})).toBe(false);
  });

  it('rejects wrong field types with a deviceInfo issue path', () => {
    const result = DeviceConfigSchema.safeParse({
      ...baseConfig(),
      deviceInfo: { serialNumber: 123 },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['deviceInfo', 'serialNumber']);
  });
});
