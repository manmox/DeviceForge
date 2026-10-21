import type { ConnectionInfo } from '../types';

export interface TemplateContext {
  req?: Record<string, unknown>;
  state: Record<string, unknown>;
  counters: Record<string, number>;
  conn?: ConnectionInfo;
  now: number;
}

const PATH_PATTERN = /^\$([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/;
const WHOLE_EXPRESSION_PATTERN = /^\$\{([^}]+)\}$/;
const EXPRESSION_PATTERN = /\$\{([^}]+)\}/g;

function resolvePath(path: string, ctx: TemplateContext): unknown {
  const parts = path.split('.');
  const root = parts[0];
  let current: unknown;

  switch (root) {
    case 'req':
      current = ctx.req;
      break;
    case 'state':
      current = ctx.state;
      break;
    case 'counter':
      current = ctx.counters;
      break;
    case 'conn':
      current = ctx.conn;
      break;
    case 'now':
      return ctx.now;
    default:
      throw new Error(`未知模板变量 $${path}`);
  }

  for (const part of parts.slice(1)) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateExpression(expression: string, ctx: TemplateContext): unknown {
  const source = expression.trim();
  const normalized = source.startsWith('$') ? source.slice(1) : source;

  const randomMatch = /^random\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/.exec(source);
  if (randomMatch) {
    const first = Number(randomMatch[1]);
    const second = Number(randomMatch[2]);
    const min = Math.ceil(Math.min(first, second));
    const max = Math.floor(Math.max(first, second));
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      throw new Error(`random 参数无效：${source}`);
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  const randomFloatMatch = /^randomFloat\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/.exec(source);
  if (randomFloatMatch) {
    const first = Number(randomFloatMatch[1]);
    const second = Number(randomFloatMatch[2]);
    const min = Math.min(first, second);
    const max = Math.max(first, second);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error(`randomFloat 参数无效：${source}`);
    }
    return Math.round((min + Math.random() * (max - min)) * 100) / 100;
  }

  if (normalized === 'now') return ctx.now;
  if (/^(req|state|counter|conn)(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(normalized)) {
    return resolvePath(normalized, ctx);
  }

  throw new Error(`未知模板表达式：\${${expression}}`);
}

function evaluateString(value: string, ctx: TemplateContext): unknown {
  const pathMatch = PATH_PATTERN.exec(value);
  if (pathMatch) return resolvePath(pathMatch[1]!, ctx);

  const wholeMatch = WHOLE_EXPRESSION_PATTERN.exec(value);
  if (wholeMatch) return evaluateExpression(wholeMatch[1]!, ctx);

  if (!value.includes('${')) return value;

  return value.replace(EXPRESSION_PATTERN, (_match, expression: string) => {
    const resolved = evaluateExpression(expression, ctx);
    return resolved === undefined ? '' : String(resolved);
  });
}

export function evaluate(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') return evaluateString(value, ctx);
  if (Array.isArray(value)) return value.map((item) => evaluate(item, ctx));
  if (value !== null && typeof value === 'object' && !Buffer.isBuffer(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = evaluate(item, ctx);
    }
    return result;
  }
  return value;
}

export function evaluateFields(
  fields: Record<string, unknown>,
  ctx: TemplateContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = evaluate(value, ctx);
  }
  return result;
}
