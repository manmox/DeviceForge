import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  defaultValueForType,
  isTemplateString,
  jsonValueType,
  uniqueKey,
  type JsonValueType,
} from '../../lib/json-value';
import type { TemplateCompletionContext } from '../../lib/template-suggestions';
import {
  IconButton,
  NumberInput,
  SelectInput,
  TextInput,
  type SelectOption,
} from './FormControls';
import { TemplateInput, type TemplateFocusRequest } from './TemplateInput';

export type JsonSuggestion = {
  name: string;
  type?: string;
};

const TYPE_OPTIONS: SelectOption<JsonValueType>[] = [
  { value: 'string', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'null', label: 'null' },
  { value: 'object', label: '对象' },
  { value: 'array', label: '数组' },
];

const FALLBACK_COMPLETION: TemplateCompletionContext = {
  roots: ['state', 'counter', 'now'],
};

type SharedProps = {
  templates?: boolean;
  completion?: TemplateCompletionContext;
  suggestions?: JsonSuggestion[];
  disabled?: boolean;
};

export function VisualJsonEditor({
  value,
  onChange,
  keyPlaceholder = '键名',
  addLabel = '添加字段',
  emptyText = '暂无字段',
  templates = false,
  completion,
  suggestions,
  disabled = false,
  className = '',
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
} & SharedProps & {
    keyPlaceholder?: string;
    addLabel?: string;
    emptyText?: string;
    className?: string;
  }) {
  return (
    <div className={className}>
      <ObjectEditor
        value={value}
        onChange={onChange}
        depth={0}
        keyPlaceholder={keyPlaceholder}
        addLabel={addLabel}
        emptyText={emptyText}
        templates={templates}
        completion={completion}
        suggestions={suggestions}
        disabled={disabled}
      />
      {templates && (
        <p className="mt-2 text-[10.5px] leading-4 text-mist-500">
          输入 <code className="kbd">$</code> 或 <code className="kbd">{'${'}</code>{' '}
          打开模板建议（Ctrl+Space 重新打开）。整值{' '}
          <code className="kbd">$state.temp</code> 保留类型；
          <code className="kbd">{'${...}'}</code>{' '}
          支持 + - * / %、比较、&amp;&amp; || !、括号和
          random/randomFloat/and/or/not。数字字段输入 $ 会转为表达式；布尔/null
          可用 fx 按钮。
        </p>
      )}
    </div>
  );
}

function ObjectEditor({
  value,
  onChange,
  depth,
  keyPlaceholder,
  addLabel,
  emptyText,
  templates,
  completion,
  suggestions,
  disabled,
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  depth: number;
  keyPlaceholder: string;
  addLabel: string;
  emptyText: string;
} & SharedProps) {
  const entries = Object.entries(value);
  const rootSuggestions = depth === 0 ? suggestions : undefined;

  function renameKey(oldKey: string, nextKey: string): boolean {
    if (nextKey === oldKey) return true;
    if (Object.prototype.hasOwnProperty.call(value, nextKey)) return false;
    onChange(
      Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey === oldKey ? nextKey : entryKey,
          entryValue,
        ]),
      ),
    );
    return true;
  }

  function updateValue(key: string, nextValue: unknown) {
    onChange({ ...value, [key]: nextValue });
  }

  function removeKey(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }

  function addField() {
    const key = uniqueKey(value, 'key');
    onChange({ ...value, [key]: '' });
  }

  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center">
          <p className="text-xs text-mist-500">{emptyText}</p>
          <button
            type="button"
            className="btn btn-outline btn-sm mt-3"
            onClick={addField}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </button>
        </div>
      ) : (
        <>
          {entries.map(([key, entryValue]) => {
            const suggestion = rootSuggestions?.find((item) => item.name === key);
            return (
              <div
                key={key}
                className="rounded-lg border border-white/5 bg-white/[0.015] p-2"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <div className="w-36 shrink-0">
                    <KeyInput
                      value={key}
                      suggestions={rootSuggestions}
                      placeholder={keyPlaceholder}
                      disabled={disabled}
                      onCommit={(nextKey) => renameKey(key, nextKey)}
                    />
                    {suggestion?.type && (
                      <div className="mt-0.5 text-[10px] text-mist-500">{suggestion.type}</div>
                    )}
                  </div>
                  <JsonTypeValueEditor
                    value={entryValue}
                    onChange={(nextValue) => updateValue(key, nextValue)}
                    depth={depth}
                    templates={templates}
                    completion={completion}
                    disabled={disabled}
                  />
                  <IconButton
                    label={`删除 ${key}`}
                    danger
                    disabled={disabled}
                    onClick={() => removeKey(key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={addField}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </button>
        </>
      )}
    </div>
  );
}

function ArrayEditor({
  value,
  onChange,
  depth,
  templates,
  completion,
  disabled,
}: {
  value: unknown[];
  onChange: (next: unknown[]) => void;
  depth: number;
  templates?: boolean;
  completion?: TemplateCompletionContext;
  disabled?: boolean;
}) {
  function updateItem(index: number, nextValue: unknown) {
    const next = [...value];
    next[index] = nextValue;
    onChange(next);
  }

  function removeItem(index: number) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }

  function addItem() {
    onChange([...value, '']);
  }

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-center text-xs text-mist-500">
          暂无数组项
        </div>
      ) : (
        value.map((item, index) => (
          <div
            key={index}
            className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.015] p-2"
          >
            <span className="mt-2 w-6 shrink-0 text-right font-mono text-[10px] text-mist-500">
              [{index}]
            </span>
            <JsonTypeValueEditor
              value={item}
              onChange={(nextValue) => updateItem(index, nextValue)}
              depth={depth}
              templates={templates}
              completion={completion}
              disabled={disabled}
            />
            <IconButton
              label={`删除第 ${index + 1} 项`}
              danger
              disabled={disabled}
              onClick={() => removeItem(index)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={addItem}
        disabled={disabled}
      >
        <Plus className="h-3.5 w-3.5" />
        添加项
      </button>
    </div>
  );
}

function JsonTypeValueEditor({
  value,
  onChange,
  depth,
  templates,
  completion,
  disabled,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  depth: number;
  templates?: boolean;
  completion?: TemplateCompletionContext;
  disabled?: boolean;
}) {
  const type = jsonValueType(value);
  const focusIdRef = useRef(0);
  const [focusRequest, setFocusRequest] = useState<TemplateFocusRequest | undefined>();

  useEffect(() => {
    if (focusRequest && type === 'string') setFocusRequest(undefined);
  }, [focusRequest, type]);

  function switchToExpression(seed: string, caret: number) {
    focusIdRef.current += 1;
    setFocusRequest({ id: focusIdRef.current, caret, open: true });
    onChange(seed);
  }

  function changeType(nextType: JsonValueType) {
    if (nextType === type) return;
    setFocusRequest(undefined);
    onChange(defaultValueForType(nextType));
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
      <SelectInput<JsonValueType>
        value={type}
        options={TYPE_OPTIONS}
        onChange={changeType}
        disabled={disabled}
        className="w-20 shrink-0"
        ariaLabel="值类型"
      />
      <div className="min-w-0 flex-1">
        {type === 'string' && (
          <div className="flex min-w-0 items-center gap-1.5">
            {templates ? (
              <TemplateInput
                value={value as string}
                onChange={onChange}
                context={completion ?? FALLBACK_COMPLETION}
                placeholder="$state.temp 或 ${...}"
                disabled={disabled}
                className="min-w-0 flex-1"
                ariaLabel="字符串值"
                focusRequest={focusRequest}
              />
            ) : (
              <TextInput
                value={value as string}
                onChange={onChange}
                placeholder="值"
                disabled={disabled}
                monospace
                className="min-w-0 flex-1"
                ariaLabel="字符串值"
              />
            )}
            {templates && isTemplateString(value) && (
              <span className="chip shrink-0 border-accent-500/20 text-accent-300">fx</span>
            )}
          </div>
        )}
        {type === 'number' && (
          <div
            className="min-w-0 flex-1"
            onKeyDownCapture={(event) => {
              if (!templates || disabled || event.nativeEvent.isComposing) return;
              if (event.key !== '$' || event.ctrlKey || event.metaKey || event.altKey) {
                return;
              }
              if (!(event.target instanceof HTMLInputElement)) return;
              event.preventDefault();
              event.stopPropagation();
              switchToExpression('$', 1);
            }}
            onPasteCapture={(event) => {
              if (!templates || disabled) return;
              const text = event.clipboardData.getData('text');
              if (!text.includes('$')) return;
              event.preventDefault();
              event.stopPropagation();
              switchToExpression(text, text.length);
            }}
          >
            <NumberInput
              value={value as number}
              onChange={(next) => onChange(next ?? 0)}
              disabled={disabled}
              ariaLabel="数字值"
            />
          </div>
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
            ariaLabel="布尔值"
          />
        )}
        {type === 'null' && (
          <div className="field flex h-8 items-center px-3 font-mono text-xs text-mist-500">
            null
          </div>
        )}
        {type === 'object' && (
          <div className="mt-1 rounded-lg border border-white/10 bg-ink-950/40 p-2">
            <ObjectEditor
              value={value as Record<string, unknown>}
              onChange={onChange}
              depth={depth + 1}
              keyPlaceholder="键名"
              addLabel="添加字段"
              emptyText="暂无字段"
              templates={templates}
              completion={completion}
              disabled={disabled}
            />
          </div>
        )}
        {type === 'array' && (
          <div className="mt-1 rounded-lg border border-white/10 bg-ink-950/40 p-2">
            <ArrayEditor
              value={value as unknown[]}
              onChange={onChange}
              depth={depth + 1}
              templates={templates}
              completion={completion}
              disabled={disabled}
            />
          </div>
        )}
      </div>
      {templates &&
        completion &&
        (type === 'number' || type === 'boolean' || type === 'null') && (
          <IconButton
            label="转为模板表达式"
            disabled={disabled}
            onClick={() =>
              switchToExpression(type === 'number' ? '$' : '${}', type === 'number' ? 1 : 2)
            }
          >
            <span className="font-mono text-[10px]">fx</span>
          </IconButton>
        )}
    </div>
  );
}

export function KeyInput({
  value,
  onCommit,
  suggestions,
  placeholder,
  disabled = false,
}: {
  value: string;
  onCommit: (nextKey: string) => boolean;
  suggestions?: JsonSuggestion[];
  placeholder: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  function commit() {
    const next = draft.trim();
    if (next === value) {
      setDraft(value);
      setError(null);
      return;
    }
    if (!next) {
      setDraft(value);
      setError('键不能为空');
      return;
    }
    if (!onCommit(next)) {
      setDraft(value);
      setError('键已存在');
      return;
    }
    setError(null);
  }

  return (
    <div>
      <input
        className={`field h-8 w-full py-0 font-mono text-xs ${
          error ? 'border-rose-500/40' : ''
        }`}
        value={draft}
        list={suggestions && suggestions.length > 0 ? listId : undefined}
        placeholder={placeholder}
        disabled={disabled}
        aria-label="键名"
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(value);
            setError(null);
            event.currentTarget.blur();
          }
        }}
      />
      {suggestions && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion.name} value={suggestion.name} />
          ))}
        </datalist>
      )}
      {error && <p className="mt-0.5 text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}
