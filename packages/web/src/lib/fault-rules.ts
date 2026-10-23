import type { FaultRule } from '@deviceforge/core';

export type FaultRuleStatusFilter = 'all' | 'enabled' | 'disabled';

export interface IndexedFaultRule {
  rule: FaultRule;
  index: number;
}

export function filterFaultRules(
  rules: FaultRule[],
  query: string,
  status: FaultRuleStatusFilter,
): IndexedFaultRule[] {
  const normalizedQuery = query.trim().toLowerCase();

  return rules.flatMap((rule, index) => {
    if (normalizedQuery && !rule.name.toLowerCase().includes(normalizedQuery)) return [];
    if (status === 'enabled' && !rule.enabled) return [];
    if (status === 'disabled' && rule.enabled) return [];
    return [{ rule, index }];
  });
}

export function visibleFaultRuleSelection(
  selectedId: string | null,
  visibleRules: IndexedFaultRule[],
): string | null {
  if (selectedId && visibleRules.some(({ rule }) => rule.id === selectedId)) {
    return selectedId;
  }
  return visibleRules[0]?.rule.id ?? null;
}

export function selectionAfterFaultRuleDelete(
  visibleIds: string[],
  deletedId: string,
): string | null {
  const deletedIndex = visibleIds.indexOf(deletedId);
  const remaining = visibleIds.filter((id) => id !== deletedId);
  if (remaining.length === 0) return null;
  return remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)] ?? null;
}

export function moveFaultRule(
  rules: FaultRule[],
  id: string,
  offset: -1 | 1,
): FaultRule[] {
  const currentIndex = rules.findIndex((rule) => rule.id === id);
  const targetIndex = currentIndex + offset;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= rules.length) return rules;

  const next = [...rules];
  [next[currentIndex], next[targetIndex]] = [next[targetIndex]!, next[currentIndex]!];
  return next;
}
