import { describe, expect, it } from 'vitest';
import { matchesFields } from '../rules/matcher';
import { evaluate, evaluateFields, type TemplateContext } from '../rules/template';

const context: TemplateContext = {
  req: { seq: 7, cmd: 3 },
  state: {
    temp: 25.5,
    nested: { online: true },
    name: 'sensor-1',
    mode: 'auto',
    zero: 0,
    list: [1, 2],
  },
  counters: { tx: 2, rx: 1 },
  conn: {
    id: 'conn-1',
    remoteAddress: '127.0.0.1',
    remotePort: 4321,
    connectedAt: 0,
    rxBytes: 0,
    txBytes: 0,
  },
  now: 1_700_000_000_000,
};

describe('template evaluation', () => {
  it('resolves whole-value paths without converting types', () => {
    expect(evaluate('$req.seq', context)).toBe(7);
    expect(evaluate('$state.temp', context)).toBe(25.5);
    expect(evaluate('$state.nested.online', context)).toBe(true);
    expect(evaluate('$counter.tx', context)).toBe(2);
    expect(evaluate('$conn.remoteAddress', context)).toBe('127.0.0.1');
    expect(evaluate('$now', context)).toBe(1_700_000_000_000);
  });

  it('evaluates expressions and interpolation', () => {
    expect(evaluate('${random(5,5)}', context)).toBe(5);
    expect(evaluate('${randomFloat(25,25)}', context)).toBe(25);
    expect(evaluate('seq=${$req.seq}', context)).toBe('seq=7');
    expect(evaluate('${now}', context)).toBe(1_700_000_000_000);
    expect(evaluate('remote=${conn.remoteAddress}:${req.cmd}', context)).toBe(
      'remote=127.0.0.1:3',
    );
  });

  it('evaluates nested objects and arrays', () => {
    expect(
      evaluate({ seq: '$req.seq', list: ['$state.temp', { online: '$state.nested.online' }] }, context),
    ).toEqual({ seq: 7, list: [25.5, { online: true }] });
  });

  it('throws on unknown variables', () => {
    expect(() => evaluate('$unknown.value', context)).toThrow('未知模板变量');
    expect(() => evaluate('${unknown(1)}', context)).toThrow('未知模板表达式');
  });

  it('evaluates field maps', () => {
    expect(evaluateFields({ a: '$req.cmd', b: '$state.temp' }, context)).toEqual({
      a: 3,
      b: 25.5,
    });
  });
});

describe('template expression language', () => {
  it('honors precedence and associativity', () => {
    expect(evaluate('${1 + 2 * 3}', context)).toBe(7);
    expect(evaluate('${(1 + 2) * 3}', context)).toBe(9);
    expect(evaluate('${10 - 3 - 2}', context)).toBe(5);
    expect(evaluate('${2 * 3 % 4}', context)).toBe(2);
    expect(evaluate('${-3 + 1}', context)).toBe(-2);
    expect(evaluate('${true || false && false}', context)).toBe(true);
  });

  it('evaluates boolean operators and functions', () => {
    expect(evaluate('${not(false) && 1 < 2}', context)).toBe(true);
    expect(evaluate('${and(state.temp > 20, state.nested.online)}', context)).toBe(true);
    expect(evaluate('${or(false, req.cmd == 3)}', context)).toBe(true);
    expect(evaluate("${not('')}", context)).toBe(true);
    expect(evaluate("${and('a', 1, true)}", context)).toBe(true);
    expect(evaluate("${or(0, '', false)}", context)).toBe(false);
    expect(evaluate('${!state.nested.online}', context)).toBe(false);
    expect(evaluate('${random(state.zero, state.zero)}', context)).toBe(0);
    expect(evaluate('${randomFloat(state.temp, state.temp)}', context)).toBe(25.5);
  });

  it('short-circuits && and || and the boolean functions', () => {
    expect(evaluate('${false && (1 / 0)}', context)).toBe(false);
    expect(evaluate('${true || unknownValue}', context)).toBe(true);
    expect(evaluate('${and(false, 1 / 0)}', context)).toBe(false);
    expect(evaluate('${or(true, unknownValue)}', context)).toBe(true);
  });

  it('supports comparisons with strict equality', () => {
    expect(evaluate('${state.mode == "auto"}', context)).toBe(true);
    expect(evaluate('${state.mode != "manual"}', context)).toBe(true);
    expect(evaluate('${1 == "1"}', context)).toBe(false);
    expect(evaluate('${state.temp >= 25.5}', context)).toBe(true);
    expect(evaluate('${"b" > "a"}', context)).toBe(true);
  });

  it('preserves values for whole expressions', () => {
    expect(evaluate('${state.temp + 1}', context)).toBe(26.5);
    expect(evaluate('${$state.temp + 1}', context)).toBe(26.5);
    expect(evaluate('${and(1, 1)}', context)).toBe(true);
    expect(evaluate('${state.temp}', context)).toBe(25.5);
    expect(evaluate('${$req.seq}', context)).toBe(7);
    expect(evaluate('temp=${state.temp}', context)).toBe('temp=25.5');
    expect(evaluate({ a: '${1 + 2}', b: ['${true && false}'] }, context)).toEqual({
      a: 3,
      b: [false],
    });
  });

  it('scans interpolations without being confused by braces in strings', () => {
    expect(evaluate('${"a}b" == "a}b"}', context)).toBe(true);
    expect(evaluate('x${"a}b"}y', context)).toBe('xa}by');
    expect(evaluate('${1}${2}', context)).toBe('12');
    expect(evaluate('x${1+2', context)).toBe('x${1+2');
    expect(evaluate('${}', context)).toBe('${}');
    expect(evaluate('${   }', context)).toBe('${   }');
  });

  it('reads own properties only and blocks prototype members', () => {
    expect(evaluate('${state.list.length}', context)).toBe(2);
    expect(evaluate('${state.constructor}', context)).toBeUndefined();
    expect(evaluate('${state.__proto__}', context)).toBeUndefined();
    expect(() => evaluate('${$now.x}', context)).toThrow('未知模板变量');
  });

  it('reports arithmetic and type errors', () => {
    expect(() => evaluate('${1 / 0}', context)).toThrow('除以零');
    expect(() => evaluate('${1 % 0}', context)).toThrow('取模零');
    expect(() => evaluate('${"x" - 1}', context)).toThrow('模板类型错误');
    expect(() => evaluate('${"a" > 1}', context)).toThrow('模板类型错误');
    expect(() => evaluate('${state == state}', context)).toThrow('不支持对象比较');
  });

  it('reports function and syntax errors', () => {
    expect(() => evaluate('${random(1)}', context)).toThrow('至少 2 个参数');
    expect(() => evaluate('${not(1, 2)}', context)).toThrow('至多 1 个参数');
    expect(() => evaluate('${and(1)}', context)).toThrow('至少 2 个参数');
    expect(() => evaluate('${unknown(1)}', context)).toThrow('未知模板表达式');
    expect(() => evaluate('${$random(1, 2)}', context)).toThrow('不能以 $ 开头');
    expect(() => evaluate('${state.temp + }', context)).toThrow('语法错误');
    expect(() => evaluate('${random(1, 2}', context)).toThrow('右括号');
  });

  it('enforces expression limits', () => {
    expect(() => evaluate(`\${${'1'.repeat(2049)}}`, context)).toThrow('过长');
    expect(() => evaluate(`\${${'('.repeat(65)}1${')'.repeat(65)}}`, context)).toThrow(
      '嵌套过深',
    );
    expect(() => evaluate('${1}'.repeat(129), context)).toThrow('插值过多');
  });
});

describe('field matching', () => {
  it('matches literals, hex strings, and operators', () => {
    expect(matchesFields({ cmd: 3 }, { cmd: 3 })).toBe(true);
    expect(matchesFields({ cmd: 4 }, { cmd: 3 })).toBe(false);
    expect(matchesFields({ magic: 'aa55' }, { magic: 'AA55' })).toBe(true);
    expect(matchesFields({ cmd: 3 }, { cmd: { $in: [1, 3] } })).toBe(true);
    expect(matchesFields({ cmd: 3 }, { cmd: { $ne: 3 } })).toBe(false);
    expect(matchesFields({ cmd: 3 }, { other: { $exists: false } })).toBe(true);
    expect(matchesFields({ name: 'sensor-1' }, { name: { $regex: '^sensor-' } })).toBe(true);
  });
});
