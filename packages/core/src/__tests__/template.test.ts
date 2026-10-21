import { describe, expect, it } from 'vitest';
import { matchesFields } from '../rules/matcher';
import { evaluate, evaluateFields, type TemplateContext } from '../rules/template';

const context: TemplateContext = {
  req: { seq: 7, cmd: 3 },
  state: { temp: 25.5, nested: { online: true } },
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
