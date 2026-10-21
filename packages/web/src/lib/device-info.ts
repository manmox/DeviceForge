import type { DeviceConfig, DeviceInfo } from '@deviceforge/core';

export type DeviceInfoField = {
  key: keyof DeviceInfo;
  label: string;
  placeholder: string;
  hint?: string;
  wide?: boolean;
  monospace?: boolean;
};

export const DEVICE_INFO_FIELDS: DeviceInfoField[] = [
  {
    key: 'manufacturer',
    label: '制造商',
    placeholder: '例如：Acme Sensors',
  },
  {
    key: 'model',
    label: '型号',
    placeholder: '例如：TH-100',
  },
  {
    key: 'serialNumber',
    label: '序列号（S/N）',
    placeholder: '例如：SN-2026-0001',
    hint: '厂商序列号，用于资产/供应链追踪；不是认证凭据。',
    wide: true,
    monospace: true,
  },
  {
    key: 'hardwareVersion',
    label: '硬件版本',
    placeholder: '例如：HW-1.0',
    monospace: true,
  },
  {
    key: 'firmwareVersion',
    label: '固件版本',
    placeholder: '例如：FW-1.0.3',
    monospace: true,
  },
  {
    key: 'tnsImei',
    label: 'TNS/IMEI（厂商自定义）',
    placeholder: '例如：DEMO-TNS-0001',
    hint: '非标准字段；当前仅保存和展示，不校验格式，不参与协议处理。',
    wide: true,
    monospace: true,
  },
];

export type DeviceInfoValue = {
  key: keyof DeviceInfo;
  label: string;
  value: string;
};

function hasValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * Updates one metadata field, drops blank values, and removes the whole
 * `deviceInfo` block when nothing remains.
 */
export function updateDeviceInfoField(
  config: DeviceConfig,
  key: keyof DeviceInfo,
  rawValue: string,
): DeviceConfig {
  const values: Record<string, string> = {};
  for (const [fieldKey, value] of Object.entries(config.deviceInfo ?? {})) {
    if (typeof value === 'string' && hasValue(value)) values[fieldKey] = value;
  }

  if (hasValue(rawValue)) values[key] = rawValue;
  else delete values[key];

  const ordered: Record<string, string> = {};
  for (const field of DEVICE_INFO_FIELDS) {
    const value = values[field.key];
    if (value !== undefined) ordered[field.key] = value;
  }

  if (Object.keys(ordered).length === 0) {
    const { deviceInfo: _deviceInfo, ...rest } = config;
    return rest;
  }

  return { ...config, deviceInfo: ordered as DeviceInfo };
}

export function deviceInfoValues(info: DeviceInfo | undefined): DeviceInfoValue[] {
  return DEVICE_INFO_FIELDS.flatMap((field) => {
    const value = info?.[field.key];
    return hasValue(value)
      ? [{ key: field.key, label: field.label, value }]
      : [];
  });
}

const HEADER_FIELDS: { key: keyof DeviceInfo; label: string }[] = [
  { key: 'serialNumber', label: 'S/N' },
  { key: 'model', label: '型号' },
  { key: 'tnsImei', label: 'TNS/IMEI' },
];

export function deviceInfoHeaderValues(
  info: DeviceInfo | undefined,
): DeviceInfoValue[] {
  return HEADER_FIELDS.flatMap((field) => {
    const value = info?.[field.key];
    return hasValue(value)
      ? [{ key: field.key, label: field.label, value }]
      : [];
  });
}

export function deviceInfoHint(info: DeviceInfo | undefined): string {
  const serialNumber = info?.serialNumber;
  if (hasValue(serialNumber)) return `S/N ${serialNumber}`;
  const model = info?.model;
  if (hasValue(model)) return model;
  const manufacturer = info?.manufacturer;
  if (hasValue(manufacturer)) return manufacturer;
  return '未填写';
}
