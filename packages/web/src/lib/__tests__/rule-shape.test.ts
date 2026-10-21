import type { Rule } from '@deviceforge/core';
import { describe, expect, it } from 'vitest';
import {
  isScalarMatchValue,
  makeMatchValue,
  matchOperand,
  matchOperator,
  matchValueHasComplexOperand,
  messageKind,
  ruleSendMessages,
  ruleTrigger,
  setRuleSend,
  withMessageKind,
  withRuleTrigger,
} from '../rule-shape';

const base: Rule = {
  name: '规则',
  enabled: true,
  jitter: 0,
  target: 'all',
  disconnect: false,
};

describe('ruleTrigger', () => {
  it('infers every, on and frame triggers', () => {
    expect(ruleTrigger({ ...base, every: 100 })).toBe('interval');
    expect(ruleTrigger({ ...base, on: 'start' })).toBe('start');
    expect(ruleTrigger({ ...base, on: 'connect' })).toBe('connect');
    expect(ruleTrigger({ ...base, on: 'frame' })).toBe('frame');
    expect(ruleTrigger({ ...base, match: { cmd: 1 } })).toBe('frame');
    expect(ruleTrigger(base)).toBe('frame');
  });
});

describe('withRuleTrigger', () => {
  it('removes conflicting trigger fields and preserves actions', () => {
    const rule: Rule = {
      ...base,
      on: 'frame',
      match: { cmd: 1 },
      every: 100,
      set: { a: 1 },
      send: { fields: {} },
    };

    expect(withRuleTrigger(rule, 'interval')).toMatchObject({
      every: 100,
      set: { a: 1 },
      send: { fields: {} },
    });
    expect(withRuleTrigger(rule, 'interval').on).toBeUndefined();
    expect(withRuleTrigger(rule, 'interval').match).toBeUndefined();

    const start = withRuleTrigger(rule, 'start');
    expect(start.on).toBe('start');
    expect(start.every).toBeUndefined();
    expect(start.match).toBeUndefined();

    const frame = withRuleTrigger({ ...base, every: 50 }, 'frame');
    expect(frame.on).toBe('frame');
    expect(frame.every).toBeUndefined();
  });
});

describe('send shape helpers', () => {
  it('normalizes single and array messages', () => {
    expect(ruleSendMessages(base)).toEqual([]);
    expect(ruleSendMessages({ ...base, send: { hex: '' } })).toEqual([{ hex: '' }]);
    expect(ruleSendMessages({ ...base, send: [{ hex: '' }, { fields: {} }] })).toHaveLength(2);
  });

  it('preserves object shape for one message and removes send for none', () => {
    const one = setRuleSend(base, [{ hex: 'AA' }]);
    expect(one.send).toEqual({ hex: 'AA' });

    const many = setRuleSend(base, [{ hex: 'AA' }, { fields: { a: 1 } }]);
    expect(Array.isArray(many.send)).toBe(true);

    expect(setRuleSend({ ...base, send: { hex: 'AA' } }, []).send).toBeUndefined();
  });

  it('switches message kind and keeps exactly one payload key', () => {
    expect(messageKind({ fields: {} })).toBe('fields');
    expect(messageKind({ hex: '' })).toBe('hex');
    expect(withMessageKind({ hex: 'AA' }, 'fields')).toEqual({ fields: {} });
    expect(withMessageKind({ fields: { a: 1 } }, 'hex')).toEqual({ hex: '' });
  });
});

describe('match helpers', () => {
  it('detects operators and operands', () => {
    expect(matchOperator(3)).toBe('eq');
    expect(matchOperator(null)).toBe('eq');
    expect(matchOperator({ $in: [1, 2] })).toBe('in');
    expect(matchOperator({ $ne: 0 })).toBe('ne');
    expect(matchOperator({ $exists: true })).toBe('exists');
    expect(matchOperator({ $regex: '^a' })).toBe('regex');

    expect(matchOperand({ $in: [1, 2] })).toEqual([1, 2]);
    expect(matchOperand({ $ne: 0 })).toBe(0);
    expect(matchOperand({ $exists: false })).toBe(false);
    expect(matchOperand({ $regex: '^a' })).toBe('^a');
    expect(matchOperand('x')).toBe('x');
  });

  it('builds values for each operator', () => {
    expect(makeMatchValue('eq', 1)).toBe(1);
    expect(makeMatchValue('eq', null)).toBeNull();
    expect(makeMatchValue('ne', 2)).toEqual({ $ne: 2 });
    expect(makeMatchValue('in', [1, 2])).toEqual({ $in: [1, 2] });
    expect(makeMatchValue('in', 1)).toEqual({ $in: [] });
    expect(makeMatchValue('exists', false)).toEqual({ $exists: false });
    expect(makeMatchValue('regex', '^a')).toEqual({ $regex: '^a' });
  });

  it('classifies scalar and complex values', () => {
    expect(isScalarMatchValue('x')).toBe(true);
    expect(isScalarMatchValue(null)).toBe(true);
    expect(isScalarMatchValue({})).toBe(false);
    expect(matchValueHasComplexOperand({ $in: [1, 'x'] })).toBe(false);
    expect(matchValueHasComplexOperand({ $in: [{ a: 1 }] })).toBe(true);
    expect(matchValueHasComplexOperand({ $ne: { a: 1 } })).toBe(true);
  });
});
