import type { MatchValue } from '../schema/device';

function equalValues(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left === 'string' && typeof right === 'string') {
    const leftLooksHex = left.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(left);
    const rightLooksHex = right.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(right);
    if (leftLooksHex && rightLooksHex) return left.toLowerCase() === right.toLowerCase();
  }
  return false;
}

export function matchesFields(
  fields: Record<string, unknown>,
  match: Record<string, MatchValue> | undefined,
): boolean {
  if (!match) return true;

  for (const [key, expected] of Object.entries(match)) {
    const actual = fields[key];

    if (expected === null) {
      if (actual !== null) return false;
      continue;
    }

    if (typeof expected === 'object' && !Array.isArray(expected)) {
      const expression = expected as Record<string, unknown>;

      if ('$exists' in expression) {
        if ((actual !== undefined) !== expression.$exists) return false;
        continue;
      }
      if ('$in' in expression) {
        if (!Array.isArray(expression.$in) || !expression.$in.some((item) => equalValues(item, actual))) {
          return false;
        }
        continue;
      }
      if ('$ne' in expression) {
        if (equalValues(expression.$ne, actual)) return false;
        continue;
      }
      if ('$regex' in expression) {
        if (typeof actual !== 'string' || !new RegExp(String(expression.$regex)).test(actual)) {
          return false;
        }
        continue;
      }
      return false;
    }

    if (!equalValues(actual, expected)) return false;
  }

  return true;
}
