import type { FieldDef, Rule } from '@deviceforge/core';
import { ruleSendMessages, ruleTrigger, RULE_TRIGGER_LABELS } from './rule-shape';

function clip(value: string, maxLength = 18): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}…`
    : value;
}

export function fieldSummaryParts(field: FieldDef): string[] {
  const parts: string[] = [];

  if (field.endian !== undefined) {
    parts.push(field.endian === 'le' ? '小端' : '大端');
  }

  if (typeof field.length === 'number') {
    parts.push(`长度 ${field.length}`);
  } else if (field.length === 'remaining') {
    parts.push('剩余全部');
  } else if (field.length !== undefined) {
    parts.push(`长度←${field.length.fromField}`);
  }

  if (field.encoding !== undefined) {
    parts.push(field.encoding);
  }

  if (field.calc === 'totalLength') {
    parts.push('自动整帧长');
  } else if (field.calc === 'remainingLength') {
    parts.push('自动剩余长');
  }

  if (field.const !== undefined) {
    const value =
      typeof field.const === 'string' ? field.const : String(field.const);
    parts.push(`常量 ${clip(value || '(空)')}`);
  }

  if (field.scale !== undefined || field.unit !== undefined) {
    const scale = field.scale !== undefined ? `×${field.scale}` : '';
    const unit = field.unit ? ` ${field.unit}` : '';
    parts.push(`${scale}${unit}`.trim());
  }

  return parts;
}

export function fieldSummary(field: FieldDef): string {
  return fieldSummaryParts(field).join(' · ');
}

export function ruleSummaryParts(rule: Rule): string[] {
  const trigger = ruleTrigger(rule);
  const parts: string[] = [];
  parts.push(RULE_TRIGGER_LABELS[trigger]);

  if (trigger === 'interval') {
    parts[0] = `周期 ${rule.every ?? 5000}ms`;
    if (rule.jitter > 0) parts.push(`±${rule.jitter}ms`);
    if (rule.target === 'last') parts.push('仅最近连接');
  }

  if (rule.match) {
    const count = Object.keys(rule.match).length;
    if (count > 0) parts.push(`匹配 ${count} 项`);
  }

  if (rule.set) {
    const count = Object.keys(rule.set).length;
    parts.push(count > 0 ? `状态 ${count} 项` : '状态更新');
  }

  const messageCount = ruleSendMessages(rule).length;
  if (messageCount > 0) {
    parts.push(`发送 ${messageCount} 条`);
  }

  if (rule.disconnect) parts.push('发送后断开');
  if (!rule.enabled) parts.push('已禁用');

  return parts;
}

export function ruleSummary(rule: Rule): string {
  return ruleSummaryParts(rule).join(' · ');
}
