import type { DeviceInfo } from '../schema/device';
import type { ConnectionInfo } from '../types';
import { TEMPLATE_FUNCTIONS } from './template-functions';

export type { TemplateFunctionInfo } from './template-functions';
export { TEMPLATE_FUNCTIONS } from './template-functions';

export interface TemplateContext {
  req?: Record<string, unknown>;
  state: Record<string, unknown>;
  counters: Record<string, number>;
  conn?: ConnectionInfo;
  device?: DeviceInfo;
  now: number;
}

const FUNCTION_MAP = new Map(TEMPLATE_FUNCTIONS.map((fn) => [fn.name, fn]));
const ROOTS = new Set(['req', 'state', 'counter', 'conn', 'device', 'now']);
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_EXPRESSION_LENGTH = 2048;
const MAX_EXPRESSION_DEPTH = 64;
const MAX_FUNCTION_ARGS = 32;

type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'dot'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
  dollar?: boolean;
}

type ExprNode =
  | { type: 'literal'; value: unknown }
  | { type: 'path'; parts: string[] }
  | { type: 'unary'; op: '!' | '+' | '-'; operand: ExprNode }
  | { type: 'binary'; op: string; left: ExprNode; right: ExprNode }
  | { type: 'call'; name: string; args: ExprNode[] };

class ExpressionError extends Error {}

function fail(message: string, position?: number): never {
  throw new ExpressionError(position === undefined ? message : `${message}（位置 ${position}）`);
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

function tokenize(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_LENGTH) {
    fail(`模板表达式过长（最多 ${MAX_EXPRESSION_LENGTH} 字符）`);
  }

  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      let value = '';
      index += 1;
      let closed = false;
      while (index < source.length) {
        const current = source[index]!;
        if (current === '\\') {
          const escaped = source[index + 1];
          if (escaped === undefined) fail('字符串转义不完整', index);
          switch (escaped) {
            case 'n':
              value += '\n';
              break;
            case 'r':
              value += '\r';
              break;
            case 't':
              value += '\t';
              break;
            case 'u': {
              const hex = source.slice(index + 2, index + 6);
              if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('字符串 Unicode 转义无效', index);
              value += String.fromCharCode(Number.parseInt(hex, 16));
              index += 4;
              break;
            }
            default:
              value += escaped;
              break;
          }
          index += 2;
          continue;
        }
        if (current === quote) {
          closed = true;
          index += 1;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) fail('字符串未闭合', start);
      tokens.push({ type: 'string', value, start, end: index });
      continue;
    }

    if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] ?? ''))) {
      const start = index;
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(index));
      if (!match) fail('数字格式无效', index);
      index += match[0].length;
      tokens.push({ type: 'number', value: match[0], start, end: index });
      continue;
    }

    if (char === '$') {
      const start = index;
      const next = source[index + 1];
      if (!next || !isIdentifierStart(next)) fail('模板变量必须以 $ 后接标识符开头', index);
      index += 1;
      const wordStart = index;
      while (index < source.length && isIdentifierPart(source[index]!)) index += 1;
      tokens.push({
        type: 'identifier',
        value: source.slice(wordStart, index),
        start,
        end: index,
        dollar: true,
      });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      while (index < source.length && isIdentifierPart(source[index]!)) index += 1;
      tokens.push({
        type: 'identifier',
        value: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'lparen', value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen', value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma', value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (char === '.') {
      tokens.push({ type: 'dot', value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    const two = source.slice(index, index + 2);
    if (two === '&&' || two === '||' || two === '==' || two === '!=' || two === '>=' || two === '<=') {
      tokens.push({ type: 'operator', value: two, start: index, end: index + 2 });
      index += 2;
      continue;
    }
    if ('!+-*/%<>'.includes(char)) {
      tokens.push({ type: 'operator', value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    fail(`无法识别的字符 "${char}"`, index);
  }

  tokens.push({ type: 'eof', value: '', start: source.length, end: source.length });
  return tokens;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ExprNode {
    const expression = this.parseOr();
    const token = this.peek();
    if (token.type !== 'eof') this.syntaxError(token);
    return expression;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private advance(): Token {
    const token = this.tokens[this.index]!;
    this.index += 1;
    return token;
  }

  private matchOperator(...operators: string[]): string | null {
    const token = this.peek();
    if (token.type !== 'operator' || !operators.includes(token.value)) return null;
    this.index += 1;
    return token.value;
  }

  private match(type: TokenType): Token | null {
    const token = this.peek();
    if (token.type !== type) return null;
    this.index += 1;
    return token;
  }

  private expect(type: TokenType, message: string): Token {
    const token = this.match(type);
    if (!token) fail(message, this.peek().start);
    return token;
  }

  private enterDepth(token: Token) {
    this.depth += 1;
    if (this.depth > MAX_EXPRESSION_DEPTH) {
      fail(`模板表达式嵌套过深（最多 ${MAX_EXPRESSION_DEPTH} 层）`, token.start);
    }
  }

  private exitDepth() {
    this.depth -= 1;
  }

  private syntaxError(token: Token): never {
    fail(`模板表达式语法错误：意外的 "${token.value || '结束'}"`, token.start);
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.matchOperator('||')) {
      left = { type: 'binary', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseEquality();
    while (this.matchOperator('&&')) {
      left = { type: 'binary', op: '&&', left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): ExprNode {
    let left = this.parseComparison();
    while (true) {
      const op = this.matchOperator('==', '!=');
      if (!op) break;
      left = { type: 'binary', op, left, right: this.parseComparison() };
    }
    return left;
  }

  private parseComparison(): ExprNode {
    let left = this.parseAdditive();
    while (true) {
      const op = this.matchOperator('<', '<=', '>', '>=');
      if (!op) break;
      left = { type: 'binary', op, left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    while (true) {
      const op = this.matchOperator('+', '-');
      if (!op) break;
      left = { type: 'binary', op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    while (true) {
      const op = this.matchOperator('*', '/', '%');
      if (!op) break;
      left = { type: 'binary', op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): ExprNode {
    const token = this.peek();
    if (token.type === 'operator' && (token.value === '!' || token.value === '+' || token.value === '-')) {
      this.advance();
      this.enterDepth(token);
      const operand = this.parseUnary();
      this.exitDepth();
      return { type: 'unary', op: token.value, operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const token = this.peek();

    if (token.type === 'number') {
      this.advance();
      const value = Number(token.value);
      if (!Number.isFinite(value)) fail(`数字超出范围：${token.value}`, token.start);
      return { type: 'literal', value };
    }

    if (token.type === 'string') {
      this.advance();
      return { type: 'literal', value: token.value };
    }

    if (token.type === 'lparen') {
      this.advance();
      this.enterDepth(token);
      const expression = this.parseOr();
      this.exitDepth();
      this.expect('rparen', '括号未闭合');
      return expression;
    }

    if (token.type === 'identifier') {
      this.advance();

      if (token.dollar !== true) {
        if (token.value === 'true') return { type: 'literal', value: true };
        if (token.value === 'false') return { type: 'literal', value: false };
        if (token.value === 'null') return { type: 'literal', value: null };
      }

      if (this.peek().type === 'lparen') {
        if (token.dollar) fail(`模板函数不能以 $ 开头：${token.value}`, token.start);
        return this.parseCall(token);
      }

      const parts = [token.value];
      while (true) {
        const dot = this.match('dot');
        if (!dot) break;
        const segment = this.expect('identifier', '路径点号后必须是属性名');
        if (segment.dollar) fail('路径属性不能以 $ 开头', segment.start);
        parts.push(segment.value);
      }
      return { type: 'path', parts };
    }

    this.syntaxError(token);
  }

  private parseCall(nameToken: Token): ExprNode {
    const fn = FUNCTION_MAP.get(nameToken.value);
    if (!fn) {
      fail(`未知模板表达式：未知函数 ${nameToken.value}`, nameToken.start);
    }

    this.expect('lparen', '函数参数缺少左括号');
    this.enterDepth(nameToken);
    const args: ExprNode[] = [];
    if (this.peek().type !== 'rparen') {
      while (true) {
        if (args.length >= MAX_FUNCTION_ARGS) {
          fail(`模板函数 ${fn.name} 参数过多（最多 ${MAX_FUNCTION_ARGS} 个）`, nameToken.start);
        }
        args.push(this.parseOr());
        if (!this.match('comma')) break;
        if (this.peek().type === 'rparen') {
          fail('函数参数列表不能以逗号结尾', this.peek().start);
        }
      }
    }
    this.expect('rparen', '函数参数缺少右括号');
    this.exitDepth();

    if (args.length < fn.minArgs) {
      fail(`模板函数 ${fn.name} 需要至少 ${fn.minArgs} 个参数`, nameToken.start);
    }
    if (args.length > fn.maxArgs) {
      fail(`模板函数 ${fn.name} 需要至多 ${fn.maxArgs} 个参数`, nameToken.start);
    }

    return { type: 'call', name: fn.name, args };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function truthy(value: unknown): boolean {
  return Boolean(value);
}

function requireNumber(value: unknown, operation: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`模板类型错误：${operation}需要有限数字`);
  }
  return value;
}

function compareValues(
  left: unknown,
  right: unknown,
  operator: '<' | '<=' | '>' | '>=',
): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      fail('模板类型错误：比较运算需要有限数字');
    }
    switch (operator) {
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
    }
  }
  if (typeof left === 'string' && typeof right === 'string') {
    switch (operator) {
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
    }
  }
  fail('模板类型错误：比较运算需要两个数字或两个字符串');
}

function requireComparableEquality(left: unknown, right: unknown): void {
  if (isPlainObject(left) || isPlainObject(right)) {
    fail('模板类型错误：== 不支持对象比较');
  }
}

// 模板路径只读取自有属性，并屏蔽原型键。未知根会报错，但嵌套路径缺失时
// 返回 undefined；$now 是叶子，不能再继续取成员。
function resolvePath(parts: string[], context: TemplateContext): unknown {
  const root = parts[0]!;
  if (!ROOTS.has(root)) {
    fail(`未知模板变量：$${parts.join('.')}`);
  }

  if (root === 'now') {
    if (parts.length > 1) fail(`未知模板变量：$${parts.join('.')}`);
    return context.now;
  }

  let current: unknown;
  switch (root) {
    case 'req':
      current = context.req;
      break;
    case 'state':
      current = context.state;
      break;
    case 'counter':
      current = context.counters;
      break;
    case 'conn':
      current = context.conn;
      break;
    case 'device':
      current = context.device;
      break;
  }

  for (const part of parts.slice(1)) {
    if (BLOCKED_KEYS.has(part)) return undefined;
    if (!isPlainObject(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function evaluateNode(node: ExprNode, context: TemplateContext): unknown {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'path':
      return resolvePath(node.parts, context);
    case 'unary': {
      const operand = evaluateNode(node.operand, context);
      if (node.op === '!') return !truthy(operand);
      const number = requireNumber(operand, '一元运算');
      return node.op === '-' ? -number : number;
    }
    case 'binary': {
      // 与 JS 不同，&& 和 || 会短路并统一返回布尔值；左侧已决定结果时
      // 不计算右侧。
      if (node.op === '&&') {
        if (!truthy(evaluateNode(node.left, context))) return false;
        return truthy(evaluateNode(node.right, context));
      }
      if (node.op === '||') {
        if (truthy(evaluateNode(node.left, context))) return true;
        return truthy(evaluateNode(node.right, context));
      }

      const left = evaluateNode(node.left, context);
      const right = evaluateNode(node.right, context);

      if (node.op === '==' || node.op === '!=') {
        requireComparableEquality(left, right);
        const equal = left === right;
        return node.op === '==' ? equal : !equal;
      }

      if (node.op === '<' || node.op === '<=' || node.op === '>' || node.op === '>=') {
        return compareValues(left, right, node.op);
      }

      const leftNumber = requireNumber(left, `运算符 ${node.op} `);
      const rightNumber = requireNumber(right, `运算符 ${node.op} `);
      let result: number;
      switch (node.op) {
        case '+':
          result = leftNumber + rightNumber;
          break;
        case '-':
          result = leftNumber - rightNumber;
          break;
        case '*':
          result = leftNumber * rightNumber;
          break;
        case '/':
          if (rightNumber === 0) fail('模板表达式错误：除以零');
          result = leftNumber / rightNumber;
          break;
        case '%':
          if (rightNumber === 0) fail('模板表达式错误：取模零');
          result = leftNumber % rightNumber;
          break;
        default:
          fail(`未知模板运算符：${node.op}`);
      }
      if (!Number.isFinite(result)) {
        fail('模板表达式错误：算术结果不是有限数值');
      }
      return result;
    }
    case 'call':
      return evaluateCall(node, context);
  }
}

function evaluateCall(node: Extract<ExprNode, { type: 'call' }>, context: TemplateContext): unknown {
  if (node.name === 'and') {
    for (const arg of node.args) {
      if (!truthy(evaluateNode(arg, context))) return false;
    }
    return true;
  }
  if (node.name === 'or') {
    for (const arg of node.args) {
      if (truthy(evaluateNode(arg, context))) return true;
    }
    return false;
  }
  if (node.name === 'not') {
    return !truthy(evaluateNode(node.args[0]!, context));
  }

  const args = node.args.map((arg) => evaluateNode(arg, context));
  if (node.name === 'random') {
    const first = requireNumber(args[0], 'random 参数');
    const second = requireNumber(args[1], 'random 参数');
    const min = Math.ceil(Math.min(first, second));
    const max = Math.floor(Math.max(first, second));
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      fail(`random 参数无效：${first}, ${second}`);
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  }
  if (node.name === 'randomFloat') {
    const first = requireNumber(args[0], 'randomFloat 参数');
    const second = requireNumber(args[1], 'randomFloat 参数');
    const min = Math.min(first, second);
    const max = Math.max(first, second);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      fail(`randomFloat 参数无效：${first}, ${second}`);
    }
    return Math.round((min + Math.random() * (max - min)) * 100) / 100;
  }

  fail(`未知模板表达式：未知函数 ${node.name}`);
}

export function evaluateExpression(source: string, context: TemplateContext): unknown {
  if (source.trim() === '') fail('模板表达式语法错误：表达式不能为空');
  const tokens = tokenize(source);
  const ast = new Parser(tokens).parse();
  return evaluateNode(ast, context);
}

export function evaluateBarePath(path: string, context: TemplateContext): unknown {
  return resolvePath(path.split('.'), context);
}
