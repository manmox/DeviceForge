export type JsonValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export function jsonValueType(value: unknown): JsonValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

export function defaultValueForType(type: JsonValueType): unknown {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'object':
      return {};
    case 'array':
      return [];
  }
}

export function isTemplateString(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (value.includes('${') ||
      /^\$(?:req|state|counter|conn|now)(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value))
  );
}

export function parseNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function uniqueKey(existing: Record<string, unknown>, base: string): string {
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(existing, key);
  if (!hasOwn(base)) return base;
  let index = 2;
  while (hasOwn(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}
