import { describe, expect, it } from 'vitest';
import type { FaultRule } from '@deviceforge/core';
import {
  filterFaultRules,
  moveFaultRule,
  selectionAfterFaultRuleDelete,
  visibleFaultRuleSelection,
} from '../fault-rules';

function rule(id: string, name: string, enabled = true): FaultRule {
  return {
    id,
    name,
    enabled,
    direction: 'both',
    trigger: { type: 'probability', percent: 50 },
    action: { type: 'drop' },
  };
}

describe('故障规则列表交互', () => {
  const rules = [rule('a', '首条丢弃'), rule('b', '延迟数据', false), rule('c', '断开连接')];

  it('按名称忽略大小写搜索，并保留配置中的原始顺序', () => {
    expect(filterFaultRules(rules, '延迟', 'all')).toEqual([{ rule: rules[1], index: 1 }]);
    expect(filterFaultRules(rules, '首条', 'all')[0]?.index).toBe(0);
  });

  it('按启用状态筛选，当前选择隐藏时回退到首条可见规则', () => {
    const visible = filterFaultRules(rules, '', 'disabled');
    expect(visible.map(({ rule: item }) => item.id)).toEqual(['b']);
    expect(visibleFaultRuleSelection('a', visible)).toBe('b');
    expect(visibleFaultRuleSelection('b', visible)).toBe('b');
    expect(visibleFaultRuleSelection('b', [])).toBeNull();
  });

  it('删除当前规则后选中同一位置的下一条，末尾删除时选中前一条', () => {
    expect(selectionAfterFaultRuleDelete(['a', 'b', 'c'], 'b')).toBe('c');
    expect(selectionAfterFaultRuleDelete(['a', 'b', 'c'], 'c')).toBe('b');
    expect(selectionAfterFaultRuleDelete(['a'], 'a')).toBeNull();
  });

  it('按完整规则顺序移动并保留边界行为', () => {
    expect(moveFaultRule(rules, 'b', -1).map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(moveFaultRule(rules, 'b', 1).map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(moveFaultRule(rules, 'a', -1)).toBe(rules);
    expect(moveFaultRule(rules, 'missing', 1)).toBe(rules);
  });
});
