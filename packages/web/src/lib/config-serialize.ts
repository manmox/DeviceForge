import type { DeviceConfig } from '@deviceforge/core';
import YAML from 'yaml';

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) result[key] = stripUndefined(entry);
    }
    return result as T;
  }
  return value;
}

export function stringifyDeviceConfig(config: DeviceConfig): string {
  return YAML.stringify(stripUndefined(config), { indent: 2, lineWidth: 0 });
}

export function stringifyJsonValue(value: unknown): string {
  return JSON.stringify(stripUndefined(value), null, 2) ?? 'null';
}

export function parseJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error('JSON 必须是对象');
  }
  return parsed;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
