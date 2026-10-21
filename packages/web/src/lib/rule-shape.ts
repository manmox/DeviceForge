import type { MatchValue, OutgoingMessage, Rule } from '@deviceforge/core';

export type RuleTrigger = 'start' | 'connect' | 'frame' | 'interval';

export const RULE_TRIGGER_LABELS: Record<RuleTrigger, string> = {
  start: '启动时',
  connect: '连接时',
  frame: '收到帧',
  interval: '周期',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function ruleTrigger(rule: Rule): RuleTrigger {
  if (rule.every !== undefined) return 'interval';
  if (rule.on !== undefined) return rule.on;
  return 'frame';
}

export function withRuleTrigger(rule: Rule, trigger: RuleTrigger): Rule {
  const { on: _on, every: _every, match: _match, ...base } = rule;
  if (trigger === 'interval') {
    return { ...base, every: rule.every ?? 5000 };
  }
  return { ...base, on: trigger };
}

export function ruleSendMessages(rule: Rule): OutgoingMessage[] {
  if (!rule.send) return [];
  return Array.isArray(rule.send) ? rule.send : [rule.send];
}

export function setRuleSend(rule: Rule, messages: OutgoingMessage[]): Rule {
  if (messages.length === 0) {
    const { send: _send, ...base } = rule;
    return base;
  }
  return { ...rule, send: messages.length === 1 ? messages[0]! : messages };
}

export function messageKind(message: OutgoingMessage): 'fields' | 'hex' {
  return message.hex !== undefined ? 'hex' : 'fields';
}

export function withMessageKind(
  message: OutgoingMessage,
  kind: 'fields' | 'hex',
): OutgoingMessage {
  if (kind === 'hex') return { hex: message.hex ?? '' };
  return { fields: message.fields ?? {} };
}

export type MatchOperator = 'eq' | 'ne' | 'in' | 'exists' | 'regex';

export function matchOperator(value: MatchValue): MatchOperator {
  if (isRecord(value)) {
    if ('$in' in value) return 'in';
    if ('$ne' in value) return 'ne';
    if ('$exists' in value) return 'exists';
    if ('$regex' in value) return 'regex';
  }
  return 'eq';
}

export function matchOperand(value: MatchValue): unknown {
  if (!isRecord(value)) return value;
  if ('$in' in value) return value.$in;
  if ('$ne' in value) return value.$ne;
  if ('$exists' in value) return value.$exists;
  if ('$regex' in value) return value.$regex;
  return value;
}

export function makeMatchValue(operator: MatchOperator, operand: unknown): MatchValue {
  switch (operator) {
    case 'in':
      return { $in: Array.isArray(operand) ? operand : [] };
    case 'ne':
      return { $ne: operand };
    case 'exists':
      return { $exists: operand !== false };
    case 'regex':
      return { $regex: typeof operand === 'string' ? operand : '' };
    case 'eq':
      if (
        operand === null ||
        typeof operand === 'string' ||
        typeof operand === 'number' ||
        typeof operand === 'boolean'
      ) {
        return operand;
      }
      return String(operand ?? '');
  }
}

export function isScalarMatchValue(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

export function matchValueHasComplexOperand(value: MatchValue): boolean {
  if (!isRecord(value)) return false;
  if ('$in' in value) {
    return Array.isArray(value.$in) && value.$in.some((item) => !isScalarMatchValue(item));
  }
  if ('$ne' in value) return !isScalarMatchValue(value.$ne);
  return false;
}
