import {
  evaluateBarePath,
  evaluateExpression,
  type TemplateContext,
} from './expression';

export type { TemplateContext } from './expression';
export { TEMPLATE_FUNCTIONS } from './expression';
export type { TemplateFunctionInfo } from './expression';

const PATH_PATTERN = /^\$([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/;
const MAX_INTERPOLATIONS = 128;

export type TemplatePart =
  | { kind: 'text'; text: string; start: number; end: number }
  | { kind: 'expression'; source: string; start: number; end: number };

/**
 * 把字符串拆成字面文本和 `${...}` 表达式。扫描会识别引号，
 * 因此 `"a}b"` 不会提前结束表达式。未闭合和只含空白的插值
 * 仍按字面量处理，与旧正则行为一致。
 */
export function scanTemplateParts(value: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf('${', cursor);
    if (start === -1) {
      if (cursor < value.length) {
        parts.push({
          kind: 'text',
          text: value.slice(cursor),
          start: cursor,
          end: value.length,
        });
      }
      break;
    }

    if (start > cursor) {
      parts.push({
        kind: 'text',
        text: value.slice(cursor, start),
        start: cursor,
        end: start,
      });
    }

    let index = start + 2;
    let quote: '"' | "'" | null = null;
    let escaped = false;
    let close = -1;

    while (index < value.length) {
      const char = value[index]!;
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '}') {
        close = index;
        break;
      }
      index += 1;
    }

    if (close === -1) {
      parts.push({
        kind: 'text',
        text: value.slice(start),
        start,
        end: value.length,
      });
      break;
    }

    const source = value.slice(start + 2, close);
    if (source.trim() === '') {
      parts.push({
        kind: 'text',
        text: value.slice(start, close + 1),
        start,
        end: close + 1,
      });
    } else {
      parts.push({
        kind: 'expression',
        source,
        start,
        end: close + 1,
      });
    }
    cursor = close + 1;
  }

  return parts;
}

function evaluateString(value: string, ctx: TemplateContext): unknown {
  const pathMatch = PATH_PATTERN.exec(value);
  if (pathMatch) return evaluateBarePath(pathMatch[1]!, ctx);

  const parts = scanTemplateParts(value);
  const expressions = parts.filter((part) => part.kind === 'expression');
  if (expressions.length === 0) return value;
  if (expressions.length > MAX_INTERPOLATIONS) {
    throw new Error(`模板插值过多（最多 ${MAX_INTERPOLATIONS} 个）`);
  }

  if (parts.length === 1 && parts[0]!.kind === 'expression') {
    return evaluateExpression(parts[0]!.source, ctx);
  }

  let result = '';
  for (const part of parts) {
    if (part.kind === 'text') {
      result += part.text;
      continue;
    }
    const resolved = evaluateExpression(part.source, ctx);
    result += resolved === undefined ? '' : String(resolved);
  }
  return result;
}

export function evaluate(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') return evaluateString(value, ctx);
  if (Array.isArray(value)) return value.map((item) => evaluate(item, ctx));
  // Buffer 作为叶子节点处理；递归会把字节展开成数字键属性。
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
