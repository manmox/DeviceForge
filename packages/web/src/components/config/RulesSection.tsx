import type { DeviceConfig, Rule } from '@deviceforge/core';
import { Plus, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { issueItemIndex } from '../../lib/config-sections';
import { defaultRule } from '../../lib/config-defaults';
import { useIssues } from '../form/ConfigIssuesContext';
import { FormSection } from '../form/FormSection';
import { RuleCard } from './RuleCard';

export function RulesSection({
  config,
  onChange,
  disabled = false,
  active = false,
}: {
  config: DeviceConfig;
  onChange: (next: DeviceConfig) => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const rules = config.rules;
  const ruleIssues = useIssues('rules');
  const [expandedRules, setExpandedRules] = useState<Set<number>>(new Set());
  const [revealIndex, setRevealIndex] = useState<number | null>(null);
  const rulesListRef = useRef<HTMLDivElement | null>(null);

  const firstIssueRule =
    ruleIssues
      .map((issue) => issueItemIndex(issue.path, 'rules'))
      .find((index) => index !== null) ?? null;

  useEffect(() => {
    if (revealIndex === null) return;
    rulesListRef.current
      ?.querySelector<HTMLElement>(`[data-rule-index="${revealIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
    setRevealIndex(null);
  }, [revealIndex]);

  useEffect(() => {
    setExpandedRules((previous) => {
      let changed = false;
      const next = new Set<number>();
      for (const index of previous) {
        if (index < rules.length) next.add(index);
        else changed = true;
      }
      return changed ? next : previous;
    });
  }, [rules.length]);

  useEffect(() => {
    if (!active || firstIssueRule === null || firstIssueRule >= rules.length) return;
    setExpandedRules((previous) =>
      previous.has(firstIssueRule)
        ? previous
        : new Set(previous).add(firstIssueRule),
    );
    setRevealIndex(firstIssueRule);
  }, [active, firstIssueRule, rules.length]);

  function revealRule(index: number) {
    setExpandedRules((previous) =>
      previous.has(index) ? previous : new Set(previous).add(index),
    );
    setRevealIndex(index);
  }

  function toggleRule(index: number) {
    setExpandedRules((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function updateRule(index: number, rule: Rule) {
    onChange({
      ...config,
      rules: rules.map((item, itemIndex) => (itemIndex === index ? rule : item)),
    });
  }

  function addRule() {
    const newIndex = rules.length;
    onChange({ ...config, rules: [...rules, defaultRule('frame')] });
    revealRule(newIndex);
  }

  function moveRule(index: number, direction: -1 | 1) {
    const target = index + direction;
    const next = [...rules];
    const item = next[index];
    if (!item || !next[target]) return;
    setExpandedRules((previous) => {
      const sourceOpen = previous.has(index);
      const targetOpen = previous.has(target);
      if (sourceOpen === targetOpen) return previous;
      const updated = new Set(previous);
      updated.delete(index);
      updated.delete(target);
      if (sourceOpen) updated.add(target);
      if (targetOpen) updated.add(index);
      return updated;
    });
    next.splice(index, 1);
    next.splice(target, 0, item);
    onChange({ ...config, rules: next });
  }

  function duplicateRule(index: number) {
    const rule = rules[index];
    if (!rule) return;
    const copy = structuredClone(rule);
    copy.name = rule.name ? `${rule.name} 副本` : '规则副本';
    delete copy.id;
    const newIndex = index + 1;
    setExpandedRules((previous) => {
      const next = new Set<number>();
      for (const itemIndex of previous) {
        next.add(itemIndex >= newIndex ? itemIndex + 1 : itemIndex);
      }
      next.add(newIndex);
      return next;
    });
    setRevealIndex(newIndex);
    onChange({
      ...config,
      rules: [...rules.slice(0, newIndex), copy, ...rules.slice(newIndex)],
    });
  }

  function removeRule(index: number) {
    setExpandedRules((previous) => {
      const next = new Set<number>();
      for (const itemIndex of previous) {
        if (itemIndex < index) next.add(itemIndex);
        else if (itemIndex > index) next.add(itemIndex - 1);
      }
      return next;
    });
    onChange({ ...config, rules: rules.filter((_, itemIndex) => itemIndex !== index) });
  }

  return (
    <FormSection
      title="规则"
      description="规则按数组顺序执行；一帧可以命中多条规则。"
      icon={<Workflow className="h-4 w-4 text-amber-400" />}
      path="rules"
      actions={
        <button className="btn btn-outline btn-sm" onClick={addRule} disabled={disabled}>
          <Plus className="h-3.5 w-3.5" />
          添加规则
        </button>
      }
    >
      {rules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center">
          <p className="text-xs text-mist-500">还没有规则。设备会保持静默，直到收到匹配帧或添加周期规则。</p>
          <button className="btn btn-outline btn-sm mt-3" onClick={addRule} disabled={disabled}>
            <Plus className="h-3.5 w-3.5" />
            添加第一条规则
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-2" ref={rulesListRef}>
            {rules.map((rule, index) => (
              <RuleCard
                key={index}
                rule={rule}
                index={index}
                total={rules.length}
                codec={config.codec}
                state={config.state}
                onChange={(next) => updateRule(index, next)}
                onMove={(direction) => moveRule(index, direction)}
                onDuplicate={() => duplicateRule(index)}
                onDelete={() => removeRule(index)}
                open={expandedRules.has(index)}
                onToggle={() => toggleRule(index)}
                disabled={disabled}
              />
            ))}
          </div>
          <button
            className="btn btn-ghost btn-sm w-full"
            onClick={addRule}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" />
            添加规则
          </button>
        </div>
      )}
    </FormSection>
  );
}
