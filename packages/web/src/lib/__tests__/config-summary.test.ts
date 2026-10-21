import type { FieldDef, Rule } from '@deviceforge/core';
import { describe, expect, it } from 'vitest';
import {
  fieldSummary,
  fieldSummaryParts,
  ruleSummary,
  ruleSummaryParts,
} from '../config-summary';

function field(value: Partial<FieldDef> & Pick<FieldDef, 'type'>): FieldDef {
  return { ...value, name: value.name ?? 'field' } as FieldDef;
}

function rule(value: Partial<Rule>): Rule {
  return {
    enabled: true,
    jitter: 0,
    target: 'all',
    disconnect: false,
    ...value,
  };
}

describe('fieldSummary', () => {
  it('summarizes fixed length and const bytes', () => {
    expect(fieldSummary(field({ type: 'bytes', length: 2, const: 'AA55' }))).toBe(
      '长度 2 · 常量 AA55',
    );
  });

  it('summarizes endian, calc, scale and unit', () => {
    expect(
      fieldSummary(field({ type: 'u16', endian: 'be', calc: 'totalLength' })),
    ).toBe('大端 · 自动整帧长');
    expect(fieldSummary(field({ type: 'i16', scale: 0.1, unit: '℃' }))).toBe(
      '×0.1 ℃',
    );
  });

  it('summarizes remaining, fromField and string encoding', () => {
    expect(
      fieldSummary(field({ type: 'string', length: 'remaining', encoding: 'utf8' })),
    ).toBe('剩余全部 · utf8');
    expect(
      fieldSummary(field({ type: 'bytes', length: { fromField: 'len' } })),
    ).toBe('长度←len');
  });

  it('truncates long constants', () => {
    const parts = fieldSummaryParts(
      field({ type: 'string', length: 20, const: 'a'.repeat(30) }),
    );
    expect(parts.at(-1)).toMatch(/…$/);
  });
});

describe('ruleSummary', () => {
  it('summarizes simple triggers', () => {
    expect(ruleSummary(rule({ on: 'start' }))).toBe('启动时');
    expect(ruleSummary(rule({ on: 'connect' }))).toBe('连接时');
    expect(ruleSummary(rule({ on: 'frame' }))).toBe('收到帧');
  });

  it('summarizes interval rules with jitter and counts', () => {
    const parts = ruleSummaryParts(
      rule({
        every: 5000,
        jitter: 200,
        target: 'last',
        set: { temp: 1, humidity: 2 },
        send: { fields: { cmd: 2 } },
      }),
    );
    expect(parts).toContain('周期 5000ms');
    expect(parts).toContain('±200ms');
    expect(parts).toContain('仅最近连接');
    expect(parts).toContain('状态 2 项');
    expect(parts).toContain('发送 1 条');
  });

  it('includes match, disconnect and disabled marks', () => {
    const parts = ruleSummaryParts(
      rule({
        on: 'frame',
        match: { cmd: 3, seq: { $ne: 0 } },
        disconnect: true,
        enabled: false,
      }),
    );
    expect(parts).toContain('匹配 2 项');
    expect(parts).toContain('发送后断开');
    expect(parts).toContain('已禁用');
  });
});
