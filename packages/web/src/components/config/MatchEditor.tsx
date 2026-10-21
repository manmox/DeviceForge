import type { MatchValue } from '@deviceforge/core';
import { Plus, Trash2 } from 'lucide-react';
import { jsonValueType, uniqueKey } from '../../lib/json-value';
import {
  isScalarMatchValue,
  makeMatchValue,
  matchOperand,
  matchOperator,
  matchValueHasComplexOperand,
  type MatchOperator,
} from '../../lib/rule-shape';
import { useIssueText } from '../form/ConfigIssuesContext';
import {
  IconButton,
  InlineWarning,
  NumberInput,
  SelectInput,
  TextInput,
  type SelectOption,
} from '../form/FormControls';
import { KeyInput, type JsonSuggestion } from '../form/VisualJsonEditor';

type LiteralType = 'string' | 'number' | 'boolean' | 'null';

const LITERAL_TYPE_OPTIONS: SelectOption<LiteralType>[] = [
  { value: 'string', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'null', label: 'null' },
];

const OPERATOR_OPTIONS: SelectOption<MatchOperator>[] = [
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'in', label: '属于' },
  { value: 'exists', label: '存在' },
  { value: 'regex', label: '正则' },
];

function defaultLiteralValue(type: LiteralType): unknown {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
  }
}

function literalTypeOf(value: unknown): LiteralType {
  const type = jsonValueType(value);
  if (type === 'number' || type === 'boolean' || type === 'null') return type;
  return 'string';
}

function defaultOperandForOperator(operator: MatchOperator, operand: unknown): unknown {
  switch (operator) {
    case 'exists':
      return typeof operand === 'boolean' ? operand : true;
    case 'in':
      if (Array.isArray(operand)) return operand;
      return isScalarMatchValue(operand) ? [operand] : [];
    case 'regex':
      return typeof operand === 'string' ? operand : '';
    case 'ne':
      return operand;
    case 'eq':
      return isScalarMatchValue(operand) ? operand : '';
  }
}

export function MatchEditor({
  match,
  onChange,
  suggestions,
  disabled = false,
  path,
}: {
  match: Record<string, MatchValue> | undefined;
  onChange: (next: Record<string, MatchValue> | undefined) => void;
  suggestions?: string[];
  disabled?: boolean;
  path: string;
}) {
  const issueText = useIssueText(path);
  const rows = Object.entries(match ?? {});
  const keySuggestions: JsonSuggestion[] | undefined = suggestions?.map((name) => ({ name }));

  function updateMatch(next: Record<string, MatchValue>) {
    onChange(Object.keys(next).length > 0 ? next : undefined);
  }

  function renameKey(oldKey: string, nextKey: string): boolean {
    if (nextKey === oldKey) return true;
    if (Object.prototype.hasOwnProperty.call(match ?? {}, nextKey)) return false;
    const next = Object.fromEntries(
      Object.entries(match ?? {}).map(([key, value]) => [
        key === oldKey ? nextKey : key,
        value,
      ]),
    ) as Record<string, MatchValue>;
    updateMatch(next);
    return true;
  }

  function updateValue(key: string, value: MatchValue) {
    onChange({ ...(match ?? {}), [key]: value });
  }

  function removeValue(key: string) {
    const next = { ...(match ?? {}) };
    delete next[key];
    updateMatch(next);
  }

  function addCondition() {
    const key = uniqueKey(match ?? {}, 'field');
    onChange({ ...(match ?? {}), [key]: '' });
  }

  function changeOperator(key: string, operator: MatchOperator) {
    const operand = matchOperand(match?.[key] ?? '');
    updateValue(key, makeMatchValue(operator, defaultOperandForOperator(operator, operand)));
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-mist-500">
        不添加条件时匹配所有帧。匹配值不会解析模板；hex 字符串比较不区分大小写。
      </div>

      {issueText && <p className="text-[10.5px] leading-4 text-rose-300">{issueText}</p>}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center">
          <p className="text-xs text-mist-500">没有匹配条件</p>
          <button
            className="btn btn-outline btn-sm mt-3"
            onClick={addCondition}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" />
            添加匹配条件
          </button>
        </div>
      ) : (
        <>
          {rows.map(([key, value]) => {
            const operator = matchOperator(value);
            const operand = matchOperand(value);
            const complex = matchValueHasComplexOperand(value);
            return (
              <div
                key={key}
                className="rounded-lg border border-white/5 bg-white/[0.015] p-2"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <div className="w-36 shrink-0">
                    <KeyInput
                      value={key}
                      suggestions={keySuggestions}
                      placeholder="字段名"
                      disabled={disabled}
                      onCommit={(nextKey) => renameKey(key, nextKey)}
                    />
                  </div>
                  <SelectInput<MatchOperator>
                    value={operator}
                    options={OPERATOR_OPTIONS}
                    onChange={(nextOperator) => changeOperator(key, nextOperator)}
                    disabled={disabled}
                    className="w-24 shrink-0"
                    ariaLabel="匹配操作符"
                  />
                  <div className="min-w-0 flex-1">
                    <MatchOperandEditor
                      operator={operator}
                      operand={operand}
                      disabled={disabled}
                      onChange={(nextOperand) =>
                        updateValue(key, makeMatchValue(operator, nextOperand))
                      }
                    />
                  </div>
                  <IconButton
                    label={`删除匹配条件 ${key}`}
                    danger
                    disabled={disabled}
                    onClick={() => removeValue(key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
                {complex && (
                  <div className="mt-2">
                    <InlineWarning>
                      该条件包含非标量值；可视化只展示，请切换到源码模式编辑。
                    </InlineWarning>
                  </div>
                )}
              </div>
            );
          })}
          <button
            className="btn btn-ghost btn-sm"
            onClick={addCondition}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" />
            添加匹配条件
          </button>
        </>
      )}
    </div>
  );
}

function MatchOperandEditor({
  operator,
  operand,
  onChange,
  disabled = false,
}: {
  operator: MatchOperator;
  operand: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
}) {
  if (operator === 'exists') {
    return (
      <SelectInput<'true' | 'false'>
        value={operand === false ? 'false' : 'true'}
        options={[
          { value: 'true', label: '存在' },
          { value: 'false', label: '不存在' },
        ]}
        onChange={(next) => onChange(next === 'true')}
        disabled={disabled}
        className="w-24"
        ariaLabel="存在条件"
      />
    );
  }

  if (operator === 'regex') {
    const pattern = typeof operand === 'string' ? operand : '';
    let regexWarning: string | null = null;
    if (pattern) {
      try {
        new RegExp(pattern);
      } catch (error) {
        regexWarning = error instanceof Error ? error.message : String(error);
      }
    }
    return (
      <div>
        <TextInput
          value={pattern}
          onChange={(next) => onChange(next)}
          disabled={disabled}
          monospace
          placeholder="^sensor-"
          ariaLabel="正则表达式"
        />
        {regexWarning && <InlineWarning>正则无效：{regexWarning}</InlineWarning>}
      </div>
    );
  }

  if (operator === 'in') {
    const items = Array.isArray(operand) ? operand : [];
    return (
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-1.5">
            <span className="mt-2 w-5 shrink-0 text-right font-mono text-[10px] text-mist-500">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              {isScalarMatchValue(item) ? (
                <LiteralValueInput
                  value={item}
                  onChange={(next) => {
                    const copy = [...items];
                    copy[index] = next;
                    onChange(copy);
                  }}
                  disabled={disabled}
                />
              ) : (
                <ComplexValue
                  value={item}
                  disabled={disabled}
                  onReset={() => {
                    const copy = [...items];
                    copy[index] = '';
                    onChange(copy);
                  }}
                />
              )}
            </div>
            <IconButton
              label={`删除第 ${index + 1} 项`}
              danger
              disabled={disabled}
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onChange([...items, ''])}
          disabled={disabled}
        >
          <Plus className="h-3.5 w-3.5" />
          添加值
        </button>
      </div>
    );
  }

  if (!isScalarMatchValue(operand)) {
    return (
      <ComplexValue
        value={operand}
        disabled={disabled}
        onReset={() => onChange('')}
      />
    );
  }

  return (
    <LiteralValueInput value={operand} onChange={onChange} disabled={disabled} />
  );
}

function LiteralValueInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string | number | boolean | null;
  onChange: (next: unknown) => void;
  disabled?: boolean;
}) {
  const type = literalTypeOf(value);

  return (
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      <SelectInput<LiteralType>
        value={type}
        options={LITERAL_TYPE_OPTIONS}
        onChange={(next) => onChange(defaultLiteralValue(next))}
        disabled={disabled}
        className="w-20 shrink-0"
        ariaLabel="匹配值类型"
      />
      <div className="min-w-0 flex-1">
        {type === 'string' && (
          <TextInput
            value={value as string}
            onChange={(next) => onChange(next)}
            disabled={disabled}
            monospace
            placeholder="值"
            ariaLabel="匹配值"
          />
        )}
        {type === 'number' && (
          <NumberInput
            value={value as number}
            onChange={(next) => onChange(next ?? 0)}
            disabled={disabled}
            ariaLabel="匹配值"
          />
        )}
        {type === 'boolean' && (
          <SelectInput<'true' | 'false'>
            value={value ? 'true' : 'false'}
            options={[
              { value: 'true', label: '真' },
              { value: 'false', label: '假' },
            ]}
            onChange={(next) => onChange(next === 'true')}
            disabled={disabled}
            className="w-20"
            ariaLabel="匹配值"
          />
        )}
        {type === 'null' && (
          <div className="field flex h-8 items-center px-3 font-mono text-xs text-mist-500">
            null
          </div>
        )}
      </div>
    </div>
  );
}

function ComplexValue({
  value,
  onReset,
  disabled = false,
}: {
  value: unknown;
  onReset: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-2">
      <p className="text-[10.5px] text-amber-200">
        复杂值请在源码模式编辑；这里只展示当前内容。
      </p>
      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-mist-400">
        {JSON.stringify(value, null, 2) ?? 'undefined'}
      </pre>
      <button
        className="btn btn-ghost btn-sm mt-1"
        onClick={onReset}
        disabled={disabled}
      >
        重置为文本
      </button>
    </div>
  );
}
