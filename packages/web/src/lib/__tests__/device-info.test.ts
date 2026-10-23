import type { DeviceConfig } from '@deviceforge/core';
import { describe, expect, it } from 'vitest';
import {
  deviceInfoHeaderValues,
  deviceInfoHint,
  deviceInfoValues,
  updateDeviceInfoField,
} from '../device-info';

const base: DeviceConfig = {
  id: 'sensor-1',
  name: '测试传感器',
  transport: { type: 'tcp-server', host: '127.0.0.1', port: 19001 },
  framing: { type: 'raw' },
  codec: { type: 'raw', display: 'hex' },
  state: {},
  rules: [],
  faultInjection: { segmentSizeBytes: 256, rules: [] },
  autoStart: false,
};

describe('updateDeviceInfoField', () => {
  it('creates the block lazily and preserves existing fields', () => {
    const first = updateDeviceInfoField(base, 'serialNumber', 'SN-0001');
    expect(first.deviceInfo).toEqual({ serialNumber: 'SN-0001' });

    const second = updateDeviceInfoField(first, 'model', 'TH-100');
    expect(second.deviceInfo).toEqual({
      model: 'TH-100',
      serialNumber: 'SN-0001',
    });
    expect(base.deviceInfo).toBeUndefined();
  });

  it('preserves field order from the field definitions', () => {
    const first = updateDeviceInfoField(base, 'tnsImei', 'DEMO-TNS-0001');
    const second = updateDeviceInfoField(first, 'serialNumber', 'SN-0001');
    expect(Object.keys(second.deviceInfo ?? {})).toEqual([
      'serialNumber',
      'tnsImei',
    ]);
  });

  it('removes a field when its value is blank', () => {
    const config: DeviceConfig = {
      ...base,
      deviceInfo: { serialNumber: 'SN-0001', model: 'TH-100' },
    };
    expect(
      updateDeviceInfoField(config, 'model', '   ').deviceInfo,
    ).toEqual({ serialNumber: 'SN-0001' });
  });

  it('removes the whole block when the last field is cleared', () => {
    const config: DeviceConfig = {
      ...base,
      deviceInfo: { serialNumber: 'SN-0001' },
    };
    const next = updateDeviceInfoField(config, 'serialNumber', '');
    expect(next.deviceInfo).toBeUndefined();
    expect('deviceInfo' in next).toBe(false);
  });

  it('cleans blank fields already present in hand-written configs', () => {
    const config: DeviceConfig = {
      ...base,
      deviceInfo: { serialNumber: 'SN-0001', model: '  ' },
    };
    expect(
      updateDeviceInfoField(config, 'manufacturer', 'Acme').deviceInfo,
    ).toEqual({ manufacturer: 'Acme', serialNumber: 'SN-0001' });
  });

  it('keeps opaque TNS/IMEI values without trimming non-empty input', () => {
    const next = updateDeviceInfoField(base, 'tnsImei', ' TNS/IMEI:0001 ');
    expect(next.deviceInfo?.tnsImei).toBe(' TNS/IMEI:0001 ');
  });
});

describe('deviceInfoValues', () => {
  it('returns non-empty values in field order', () => {
    const values = deviceInfoValues({
      manufacturer: 'Acme',
      serialNumber: 'SN-0001',
      model: '   ',
      tnsImei: 'DEMO-TNS-0001',
    });
    expect(values.map((item) => item.key)).toEqual([
      'manufacturer',
      'serialNumber',
      'tnsImei',
    ]);
  });
});

describe('deviceInfoHeaderValues', () => {
  it('returns S/N, model and TNS/IMEI only, in that order', () => {
    const values = deviceInfoHeaderValues({
      manufacturer: 'Acme',
      serialNumber: 'SN-0001',
      model: 'TH-100',
      hardwareVersion: 'HW-1.0',
      tnsImei: 'DEMO-TNS-0001',
    });
    expect(values.map((item) => item.label)).toEqual([
      'S/N',
      '型号',
      'TNS/IMEI',
    ]);
  });
});

describe('deviceInfoHint', () => {
  it('falls back from S/N to model, manufacturer, and empty state', () => {
    expect(deviceInfoHint(undefined)).toBe('未填写');
    expect(deviceInfoHint({ serialNumber: '  ' })).toBe('未填写');
    expect(deviceInfoHint({ serialNumber: 'SN-0001', model: 'TH-100' })).toBe(
      'S/N SN-0001',
    );
    expect(deviceInfoHint({ model: 'TH-100' })).toBe('TH-100');
    expect(deviceInfoHint({ manufacturer: 'Acme' })).toBe('Acme');
    expect(deviceInfoHint({ serialNumber: '  ', model: 'TH-100' })).toBe(
      'TH-100',
    );
  });
});
