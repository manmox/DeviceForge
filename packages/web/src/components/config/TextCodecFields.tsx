import type {
  TextCodecConfig,
  TextDictionaryEntry,
  TextField,
  TextMatch,
  TextMessage,
  TextRepeat,
  TextSession,
  TextSlot,
} from '@deviceforge/core';
import { TEXT_DEVICE_INFO_KEYS } from '@deviceforge/core/schema';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useIssues, useIssueText } from '../form/ConfigIssuesContext';
import {
  FormField,
  IconButton,
  InlineWarning,
  NumberInput,
  SelectInput,
  SwitchRow,
  TextArea,
  TextInput,
  type SelectOption,
} from '../form/FormControls';
import {
  newTextMessage,
  newTextRepeat,
  newTextField,
} from '../../lib/text-codec-model';
import {
  escapeDelimiterText,
  parseDelimiterText,
} from '../../lib/delimiter';

const FIELD_TYPE_OPTIONS: SelectOption<TextField['type']>[] = [
  { value: 'string', label: 'string · 文本' },
  { value: 'int', label: 'int · 整数' },
  { value: 'decimal', label: 'decimal · 数值文本' },
  { value: 'timestamp', label: 'timestamp · 时间文本' },
  { value: 'stringList', label: 'stringList · 分隔列表' },
  { value: 'int16Array', label: 'int16Array · 波形（字典驱动）' },
];

const DEVICE_INFO_LABELS: Record<(typeof TEXT_DEVICE_INFO_KEYS)[number], string> = {
  manufacturer: '厂商',
  model: '型号',
  serialNumber: '序列号',
  hardwareVersion: '硬件版本',
  firmwareVersion: '固件版本',
  tnsImei: 'TNS/IMEI',
};

function uniqueName(names: string[], base: string): string {
  if (!names.includes(base)) return base;
  let index = 2;
  while (names.includes(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}

function messageFieldNames(message: TextMessage): string[] {
  return message.slots.flatMap((slot) =>
    slot.kind === 'literal' ? [] : [slot.name],
  );
}

function matchMode(match: TextMatch): 'equals' | 'oneOf' | 'regex' | 'notEquals' {
  if (match.oneOf !== undefined) return 'oneOf';
  if (match.regex !== undefined) return 'regex';
  if (match.notEquals !== undefined) return 'notEquals';
  return 'equals';
}

function patchMatch(match: TextMatch, next: TextMatch): TextMatch {
  const clean: TextMatch = { index: next.index };
  if (next.equals !== undefined) clean.equals = next.equals;
  if (next.oneOf !== undefined) clean.oneOf = next.oneOf;
  if (next.regex !== undefined) clean.regex = next.regex;
  if (next.notEquals !== undefined) clean.notEquals = next.notEquals;
  return clean;
}

function EscapedTextInput({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled: boolean;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(() => escapeDelimiterText(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!focused) setDraft(escapeDelimiterText(value));
  }, [value, focused]);

  return (
    <div>
      <TextInput
        value={draft}
        onChange={(next) => {
          setDraft(next);
          const parsed = parseDelimiterText(next);
          if (parsed.ok) {
            setError(null);
            onChange(parsed.text);
          } else {
            setError(parsed.error);
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        monospace
        ariaLabel={ariaLabel}
      />
      {error && <p className="mt-0.5 text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

function FieldEditor({
  field,
  onChange,
  path,
  disabled,
  allowOptional = true,
  allowAuto = true,
}: {
  field: TextField;
  onChange: (next: TextField) => void;
  path: string;
  disabled: boolean;
  allowOptional?: boolean;
  allowAuto?: boolean;
}) {
  const nameError = useIssueText(`${path}.name`);
  const typeError = useIssueText(`${path}.type`);
  const widthError = useIssueText(`${path}.width`);
  const autoError = useIssueText(`${path}.auto`);
  const formatError = useIssueText(`${path}.format`);
  const patternError = useIssueText(`${path}.pattern`);

  const supportsWidth =
    field.type === 'string' ||
    field.type === 'int' ||
    field.type === 'decimal' ||
    field.type === 'timestamp';

  function patch(partial: Partial<TextField>) {
    onChange({ ...field, ...partial });
  }

  function changeType(next: TextField['type']) {
    const updated: TextField = { ...field, type: next };
    if (
      next !== 'string' &&
      next !== 'int' &&
      next !== 'decimal' &&
      next !== 'timestamp'
    ) {
      delete updated.width;
      delete updated.pad;
    }
    if (next !== 'stringList') delete updated.valueSeparator;
    else updated.valueSeparator ??= '|';
    if (next !== 'timestamp') delete updated.format;
    else updated.format ??= 'YYYY-MM-DD HH-mm-ss';
    if (
      !allowAuto ||
      (updated.auto === 'timestamp' && next !== 'timestamp') ||
      (updated.auto === 'sequence' && next !== 'int')
    ) {
      delete updated.auto;
    }
    onChange(updated);
  }

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <FormField label="字段名" required error={nameError}>
        <TextInput
          value={field.name}
          onChange={(name) => patch({ name })}
          disabled={disabled}
          monospace
          placeholder="field"
        />
      </FormField>

      <FormField label="类型" required error={typeError}>
        <SelectInput<TextField['type']>
          value={field.type}
          options={FIELD_TYPE_OPTIONS}
          onChange={changeType}
          disabled={disabled}
          ariaLabel="文本字段类型"
        />
      </FormField>

      {supportsWidth && (
        <FormField label="宽度" hint="可选；解码时要求完全匹配。" error={widthError}>
          <NumberInput
            value={field.width}
            onChange={(width) =>
              width === undefined ? patch({ width: undefined }) : patch({ width })
            }
            min={1}
            allowEmpty
            disabled={disabled}
            ariaLabel="字段宽度"
          />
        </FormField>
      )}

      {supportsWidth && field.width !== undefined && (
        <>
          <FormField label="补位方向">
            <SelectInput<'left' | 'right'>
              value={field.pad ?? 'left'}
              options={[
                { value: 'left', label: '左侧补位' },
                { value: 'right', label: '右侧补位' },
              ]}
              onChange={(pad) => patch({ pad })}
              disabled={disabled}
              ariaLabel="补位方向"
            />
          </FormField>
          <FormField label="补位字符">
            <TextInput
              value={field.padChar}
              onChange={(padChar) => patch({ padChar: padChar.slice(0, 1) || '0' })}
              disabled={disabled}
              monospace
              placeholder="0"
            />
          </FormField>
        </>
      )}

      {allowOptional && (
        <div className="sm:col-span-2">
          <SwitchRow
            label="optional"
            hint="每条报文最多一个；编码时缺省为 undefined 或 null 都会省略。"
            checked={field.optional}
            onChange={(optional) => patch({ optional })}
            disabled={disabled}
          />
        </div>
      )}

      {allowAuto && (
        <FormField label="自动字段" error={autoError}>
          <SelectInput<'none' | 'timestamp' | 'sequence'>
            value={field.auto ?? 'none'}
            options={[
              { value: 'none', label: '不自动生成' },
              { value: 'timestamp', label: 'timestamp · 当前时间' },
              { value: 'sequence', label: 'sequence · 递增流水号' },
            ]}
            onChange={(auto) => {
              if (auto === 'none') {
                const next = { ...field };
                delete next.auto;
                onChange(next);
                return;
              }
              if (auto === 'timestamp' && field.type !== 'timestamp') {
                onChange({ ...field, type: 'timestamp', auto, format: field.format ?? 'YYYY-MM-DD HH-mm-ss' });
                return;
              }
              if (auto === 'sequence' && field.type !== 'int') {
                onChange({ ...field, type: 'int', auto });
                return;
              }
              patch({ auto });
            }}
            disabled={disabled}
            ariaLabel="自动字段"
          />
        </FormField>
      )}

      {field.type === 'timestamp' && (
        <FormField label="时间格式" required error={formatError} hint="YYYY / MM / DD / HH / mm / ss">
          <TextInput
            value={field.format ?? ''}
            onChange={(format) => patch({ format: format || undefined })}
            disabled={disabled}
            monospace
            placeholder="YYYY-MM-DD HH-mm-ss"
          />
        </FormField>
      )}

      {field.auto === 'sequence' && (
        <FormField label="起始流水号">
          <NumberInput
            value={field.sequenceStart}
            onChange={(sequenceStart) => patch({ sequenceStart: sequenceStart ?? 1 })}
            min={0}
            disabled={disabled}
            ariaLabel="起始流水号"
          />
        </FormField>
      )}

      {field.type === 'stringList' && (
        <FormField label="列表分隔符" hint="默认 |；repeat item 内会优先使用字段值。">
          <TextInput
            value={field.valueSeparator ?? ''}
            onChange={(valueSeparator) =>
              patch({ valueSeparator: valueSeparator || undefined })
            }
            disabled={disabled}
            monospace
            placeholder="|"
          />
        </FormField>
      )}

      <FormField label="缺省值" hint="编码缺省时使用；optional 字段不会自动套用。">
        <TextInput
          value={field.default ?? ''}
          onChange={(value) =>
            patch({ default: value === '' ? undefined : value })
          }
          disabled={disabled}
          monospace
          placeholder="可选"
        />
      </FormField>

      <FormField label="设备信息回退" hint="编码缺省时从 $device.* 取设备码等值。">
        <SelectInput<string>
          value={field.defaultFrom ?? 'none'}
          options={[
            { value: 'none', label: '不使用' },
            ...TEXT_DEVICE_INFO_KEYS.map((key) => ({
              value: key,
              label: DEVICE_INFO_LABELS[key],
            })),
          ]}
          onChange={(key) => {
            if (key === 'none') {
              const next = { ...field };
              delete next.defaultFrom;
              onChange(next);
              return;
            }
            patch({ defaultFrom: key as (typeof TEXT_DEVICE_INFO_KEYS)[number] });
          }}
          disabled={disabled}
          ariaLabel="设备信息回退"
        />
      </FormField>

      <FormField label="格式校验" hint="解码时校验；warning 只提示，error 会判为无效。" error={patternError}>
        <TextInput
          value={field.pattern ?? ''}
          onChange={(pattern) => patch({ pattern: pattern === '' ? undefined : pattern })}
          disabled={disabled}
          monospace
          placeholder="^\d{15}$"
        />
      </FormField>

      <FormField label="校验失败级别">
        <SelectInput<'error' | 'warning'>
          value={field.patternSeverity}
          options={[
            { value: 'error', label: 'error · 判为无效' },
            { value: 'warning', label: 'warning · 仅提示' },
          ]}
          onChange={(patternSeverity) => patch({ patternSeverity })}
          disabled={disabled}
          ariaLabel="格式校验级别"
        />
      </FormField>

      <div className="sm:col-span-2">
        <SwitchRow
          label="允许空值"
          hint="关闭时空字符串会让解码/编码报错。"
          checked={field.allowEmpty}
          onChange={(allowEmpty) => patch({ allowEmpty })}
          disabled={disabled}
        />
      </div>

      <FormField label="描述" className="sm:col-span-2">
        <TextInput
          value={field.description ?? ''}
          onChange={(description) =>
            patch({ description: description === '' ? undefined : description })
          }
          disabled={disabled}
          placeholder="仅用于展示和模板提示"
        />
      </FormField>
    </div>
  );
}

function RepeatEditor({
  repeat,
  onChange,
  path,
  countFields,
  dictionaryNames,
  disabled,
}: {
  repeat: TextRepeat;
  onChange: (next: TextRepeat) => void;
  path: string;
  countFields: string[];
  dictionaryNames: string[];
  disabled: boolean;
}) {
  const keyFieldId = useId();
  const valueFieldId = useId();
  const nameError = useIssueText(`${path}.name`);
  const countError = useIssueText(`${path}.countField`);
  const valueFieldError = useIssueText(`${path}.valueField`);
  const keyFieldError = useIssueText(`${path}.keyField`);
  const mapFieldError = useIssueText(`${path}.mapField`);

  function patch(partial: Partial<TextRepeat>) {
    onChange({ ...repeat, ...partial });
  }

  function updateItemField(index: number, next: TextField) {
    const previous = repeat.fields[index];
    const updated: TextRepeat = {
      ...repeat,
      fields: repeat.fields.map((field, itemIndex) =>
        itemIndex === index ? next : field,
      ),
    };
    if (previous && repeat.valueField === previous.name) {
      updated.valueField = next.name;
    }
    if (previous && repeat.keyField === previous.name) {
      updated.keyField = next.name;
    }
    onChange(updated);
  }

  function addItemField() {
    const name = uniqueName(repeat.fields.map((field) => field.name), 'field');
    patch({ fields: [...repeat.fields, newTextField(name)] });
  }

  function removeItemField(index: number) {
    if (repeat.fields.length <= 1) return;
    patch({ fields: repeat.fields.filter((_, itemIndex) => itemIndex !== index) });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <FormField label="组名" required error={nameError}>
          <TextInput
            value={repeat.name}
            onChange={(name) => patch({ name })}
            disabled={disabled}
            monospace
          />
        </FormField>

        <FormField label="数量字段" required error={countError}>
          {countFields.length > 0 ? (
            <SelectInput<string>
              value={repeat.countField}
              options={countFields.map((name) => ({ value: name, label: name }))}
              onChange={(countField) => patch({ countField })}
              disabled={disabled}
              ariaLabel="repeat 数量字段"
            />
          ) : (
            <TextInput
              value={repeat.countField}
              onChange={(countField) => patch({ countField })}
              disabled={disabled}
              monospace
            />
          )}
        </FormField>

        <FormField label="item 内部分隔符" required>
          <EscapedTextInput
            value={repeat.itemSeparator}
            onChange={(itemSeparator) => patch({ itemSeparator })}
            disabled={disabled}
            placeholder="*"
            ariaLabel="item 内部分隔符"
          />
        </FormField>

        <FormField label="默认列表分隔符" hint="stringList 字段可单独覆盖。">
          <EscapedTextInput
            value={repeat.valueSeparator}
            onChange={(valueSeparator) => patch({ valueSeparator })}
            disabled={disabled}
            placeholder="|"
            ariaLabel="默认列表分隔符"
          />
        </FormField>

        <FormField label="值字段" required error={valueFieldError}>
          <TextInput
            value={repeat.valueField}
            onChange={(valueField) => patch({ valueField })}
            disabled={disabled}
            monospace
            list={valueFieldId}
          />
          <datalist id={valueFieldId}>
            {repeat.fields.map((field) => (
              <option key={field.name} value={field.name} />
            ))}
          </datalist>
        </FormField>

        <FormField label="数据字典">
          <SelectInput<string>
            value={repeat.dictionary ?? 'none'}
            options={[
              { value: 'none', label: '不使用' },
              ...dictionaryNames.map((name) => ({ value: name, label: name })),
            ]}
            onChange={(dictionary) => {
              if (dictionary === 'none') {
                const next = { ...repeat };
                delete next.dictionary;
                onChange(next);
                return;
              }
              patch({ dictionary });
            }}
            disabled={disabled}
            ariaLabel="repeat 数据字典"
          />
        </FormField>

        <FormField label="字典键字段" hint="用哪个 item 字段查字典。" error={keyFieldError}>
          <TextInput
            value={repeat.keyField ?? ''}
            onChange={(keyField) =>
              patch({ keyField: keyField === '' ? undefined : keyField })
            }
            disabled={disabled}
            monospace
            list={keyFieldId}
          />
          <datalist id={keyFieldId}>
            {repeat.fields.map((field) => (
              <option key={field.name} value={field.name} />
            ))}
          </datalist>
        </FormField>

        <FormField label="索引字段 mapField" hint="生成 decoded[mapField].item101 这类路径。" error={mapFieldError}>
          <TextInput
            value={repeat.mapField ?? ''}
            onChange={(mapField) =>
              patch({ mapField: mapField === '' ? undefined : mapField })
            }
            disabled={disabled}
            monospace
            placeholder="data"
          />
        </FormField>

        <FormField label="索引键前缀">
          <TextInput
            value={repeat.mapKeyPrefix ?? ''}
            onChange={(mapKeyPrefix) =>
              patch({ mapKeyPrefix: mapKeyPrefix === '' ? undefined : mapKeyPrefix })
            }
            disabled={disabled}
            monospace
            placeholder="c"
          />
        </FormField>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-medium text-mist-400">item 字段（顺序即 item 内顺序）</div>
        {repeat.fields.map((field, index) => (
          <div key={index} className="rounded-lg border border-white/10 bg-ink-950/30 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-mist-300">
                #{index + 1} {field.name || '(未命名)'}
              </span>
              <IconButton
                label="删除 item 字段"
                danger
                disabled={disabled || repeat.fields.length <= 1}
                onClick={() => removeItemField(index)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
            <FieldEditor
              field={field}
              onChange={(next) => updateItemField(index, next)}
              path={`${path}.fields.${index}`}
              disabled={disabled}
              allowOptional={false}
              allowAuto={false}
            />
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={addItemField}
          disabled={disabled}
        >
          <Plus className="h-3.5 w-3.5" />
          添加 item 字段
        </button>
      </div>
    </div>
  );
}

function SlotCard({
  slot,
  index,
  message,
  messageIndex,
  countFields,
  dictionaryNames,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  disabled,
}: {
  slot: TextSlot;
  index: number;
  message: TextMessage;
  messageIndex: number;
  countFields: string[];
  dictionaryNames: string[];
  onChange: (next: TextSlot) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(slot.kind === 'field');
  const path = `codec.messages.${messageIndex}.slots.${index}`;
  const issues = useIssues(path);
  useEffect(() => {
    if (issues.length > 0) setOpen(true);
  }, [issues.length]);
  const title =
    slot.kind === 'literal'
      ? slot.value || '(空 literal)'
      : slot.name || '(未命名)';
  const subtitle =
    slot.kind === 'literal'
      ? 'literal'
      : slot.kind === 'repeat'
        ? `repeat × ${slot.countField}`
        : slot.type;

  return (
    <div className="rounded-lg border border-white/10 bg-ink-950/30" data-slot-index={index}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-2.5 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-mist-500 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="chip shrink-0 font-mono text-[10px]">#{index + 1}</span>
          <span className="min-w-0 truncate font-mono text-xs text-mist-200">{title}</span>
          <span className="chip shrink-0 text-[10px]">{subtitle}</span>
          {issues.length > 0 && (
            <span className="rounded border border-rose-500/20 bg-rose-500/[0.07] px-1.5 py-0.5 text-[10px] text-rose-300">
              {issues.length} 个问题
            </span>
          )}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton label="上移槽位" onClick={() => onMove(-1)} disabled={disabled || index === 0}>
            <ArrowUp className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="下移槽位" onClick={() => onMove(1)} disabled={disabled || index === message.slots.length - 1}>
            <ArrowDown className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="复制槽位" onClick={onDuplicate} disabled={disabled}>
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="删除槽位" danger onClick={onDelete} disabled={disabled || message.slots.length <= 1}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="border-b border-rose-500/10 bg-rose-500/[0.04] px-2.5 py-1.5 text-[10.5px] leading-4 text-rose-200">
          {issues.map((issue) => issue.message).join('；')}
        </div>
      )}

      <div className={`p-2.5 ${open ? '' : 'hidden'}`}>
        {slot.kind === 'literal' && (
          <FormField label="literal 值" required>
            <TextInput
              value={slot.value}
              onChange={(value) => onChange({ ...slot, value })}
              disabled={disabled}
              monospace
              placeholder="END"
            />
          </FormField>
        )}
        {slot.kind === 'field' && (
          <FieldEditor
            field={slot}
            onChange={onChange}
            path={path}
            disabled={disabled}
          />
        )}
        {slot.kind === 'repeat' && (
          <RepeatEditor
            repeat={slot}
            onChange={onChange}
            path={path}
            countFields={countFields}
            dictionaryNames={dictionaryNames}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

function MatchRows({
  message,
  onChange,
  disabled,
}: {
  message: TextMessage;
  onChange: (next: TextMessage) => void;
  disabled: boolean;
}) {
  const matches = message.match ?? [];

  function update(index: number, next: TextMatch) {
    onChange({
      ...message,
      match: matches.map((match, matchIndex) =>
        matchIndex === index ? patchMatch(match, next) : match,
      ),
    });
  }

  function remove(index: number) {
    const next = matches.filter((_, matchIndex) => matchIndex !== index);
    onChange({ ...message, match: next.length > 0 ? next : undefined });
  }

  function add() {
    onChange({
      ...message,
      match: [...matches, { index: 0, equals: '' }],
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-mist-400">匹配条件（完整 token 下标）</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={add} disabled={disabled}>
          <Plus className="h-3.5 w-3.5" />
          添加条件
        </button>
      </div>
      {matches.length === 0 && (
        <p className="text-[10.5px] text-mist-500">没有额外匹配条件；prefix/suffix 已能区分报文。</p>
      )}
      {matches.map((match, index) => {
        const mode = matchMode(match);
        return (
          <div key={index} className="grid gap-2 rounded-lg border border-white/10 bg-ink-950/30 p-2 sm:grid-cols-[90px_130px_1fr_auto]">
            <FormField label="下标">
              <NumberInput
                value={match.index}
                onChange={(next) =>
                  update(index, { ...match, index: next ?? 0 })
                }
                min={0}
                disabled={disabled}
                ariaLabel="match 下标"
              />
            </FormField>
            <FormField label="条件">
              <SelectInput<'equals' | 'oneOf' | 'regex' | 'notEquals'>
                value={mode}
                options={[
                  { value: 'equals', label: '等于' },
                  { value: 'oneOf', label: '其中之一' },
                  { value: 'regex', label: '正则' },
                  { value: 'notEquals', label: '不等于' },
                ]}
                onChange={(nextMode) => {
                  const next: TextMatch = { index: match.index };
                  if (nextMode === 'equals') next.equals = '';
                  else if (nextMode === 'oneOf') next.oneOf = [''];
                  else if (nextMode === 'regex') next.regex = '';
                  else next.notEquals = '';
                  update(index, next);
                }}
                disabled={disabled}
                ariaLabel="match 条件类型"
              />
            </FormField>
            <FormField label="值">
              <TextInput
                value={
                  mode === 'oneOf'
                    ? (match.oneOf ?? []).join(', ')
                    : (match[mode] as string | undefined) ?? ''
                }
                onChange={(value) => {
                  if (mode === 'oneOf') {
                    update(index, {
                      ...match,
                      oneOf: value.split(',').map((part) => part.trim()).filter(Boolean),
                    });
                  } else {
                    update(index, { ...match, [mode]: value });
                  }
                }}
                disabled={disabled}
                monospace
                placeholder={mode === 'regex' ? '^\\d+$' : 'C'}
              />
            </FormField>
            <IconButton
              label="删除匹配条件"
              danger
              disabled={disabled}
              onClick={() => remove(index)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}

function MessageCard({
  message,
  index,
  messages,
  dictionaryNames,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  disabled,
  defaultOpen,
}: {
  message: TextMessage;
  index: number;
  messages: TextMessage[];
  dictionaryNames: string[];
  onChange: (next: TextMessage) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  disabled: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const path = `codec.messages.${index}`;
  const issues = useIssues(path);
  useEffect(() => {
    if (issues.length > 0) setOpen(true);
  }, [issues.length]);

  function patch(partial: Partial<TextMessage>) {
    onChange({ ...message, ...partial });
  }

  function updateSlot(slotIndex: number, next: TextSlot) {
    const previous = message.slots[slotIndex];
    let slots = message.slots.map((slot, itemIndex) =>
      itemIndex === slotIndex ? next : slot,
    );
    if (
      previous?.kind === 'field' &&
      next.kind === 'field' &&
      previous.name !== next.name
    ) {
      slots = slots.map((slot) =>
        slot.kind === 'repeat' && slot.countField === previous.name
          ? { ...slot, countField: next.name }
          : slot,
      );
    }
    patch({ slots });
  }

  function moveSlot(slotIndex: number, direction: -1 | 1) {
    const target = slotIndex + direction;
    if (target < 0 || target >= message.slots.length) return;
    const slots = [...message.slots];
    const [slot] = slots.splice(slotIndex, 1);
    slots.splice(target, 0, slot!);
    patch({ slots });
  }

  function addSlot(kind: 'literal' | 'field' | 'repeat') {
    const names = messageFieldNames(message);
    let slot: TextSlot;
    if (kind === 'literal') {
      slot = { kind: 'literal', value: 'VALUE' };
    } else if (kind === 'field') {
      slot = newTextField(uniqueName(names, 'field'));
    } else {
      const repeatName = uniqueName(names, 'items');
      const priorInt = message.slots.flatMap((item) =>
        item.kind === 'field' && item.type === 'int' ? [item.name] : [],
      );
      const countField = priorInt[priorInt.length - 1] ?? uniqueName(names, 'count');
      slot = { ...newTextRepeat(repeatName), countField };
      if (priorInt.length === 0) {
        patch({
          slots: [
            ...message.slots,
            newTextField(countField, 'int'),
            slot,
          ],
        });
        return;
      }
    }
    patch({ slots: [...message.slots, slot] });
  }

  function duplicateSlot(slotIndex: number) {
    const slot = message.slots[slotIndex];
    if (!slot) return;
    const copy = structuredClone(slot);
    if (copy.kind !== 'literal') {
      copy.name = uniqueName(messageFieldNames(message), `${copy.name}_copy`);
    }
    patch({
      slots: [
        ...message.slots.slice(0, slotIndex + 1),
        copy,
        ...message.slots.slice(slotIndex + 1),
      ],
    });
  }

  function removeSlot(slotIndex: number) {
    if (message.slots.length <= 1) return;
    patch({ slots: message.slots.filter((_, itemIndex) => itemIndex !== slotIndex) });
  }

  const priorFields = (slotIndex: number) =>
    message.slots
      .slice(0, slotIndex)
      .flatMap((slot) =>
        slot.kind === 'field' && slot.type === 'int' ? [slot.name] : [],
      );

  return (
    <div className="rounded-lg border border-white/10 bg-ink-900/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-2.5 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-mist-500 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="min-w-0 truncate font-mono text-xs text-mist-200">
            {message.name || '(未命名报文)'}
          </span>
          {message.label && (
            <span className="chip shrink-0 text-[10px]">{message.label}</span>
          )}
          <span className="text-[10.5px] text-mist-500">{message.slots.length} 槽位</span>
          {issues.length > 0 && (
            <span className="rounded border border-rose-500/20 bg-rose-500/[0.07] px-1.5 py-0.5 text-[10px] text-rose-300">
              {issues.length} 个问题
            </span>
          )}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton label="上移报文" onClick={() => onMove(-1)} disabled={disabled || index === 0}>
            <ArrowUp className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="下移报文" onClick={() => onMove(1)} disabled={disabled || index === messages.length - 1}>
            <ArrowDown className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="复制报文" onClick={onDuplicate} disabled={disabled}>
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="删除报文" danger onClick={onDelete} disabled={disabled || messages.length <= 1}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="border-b border-rose-500/10 bg-rose-500/[0.04] px-2.5 py-1.5 text-[10.5px] leading-4 text-rose-200">
          {issues.map((issue) => issue.message).join('；')}
        </div>
      )}

      <div className={`space-y-3 p-2.5 ${open ? '' : 'hidden'}`}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <FormField label="报文名" required hint="出站 fields.kind 使用这个名字。">
            <TextInput
              value={message.name}
              onChange={(name) => patch({ name })}
              disabled={disabled}
              monospace
            />
          </FormField>
          <FormField label="展示名称">
            <TextInput
              value={message.label ?? ''}
              onChange={(label) => patch({ label: label || undefined })}
              disabled={disabled}
              placeholder="数据上报"
            />
          </FormField>
          <FormField label="prefix" hint="第一个完整 token。">
            <TextInput
              value={message.prefix ?? ''}
              onChange={(prefix) => patch({ prefix: prefix || undefined })}
              disabled={disabled}
              monospace
            />
          </FormField>
          <FormField label="suffix" hint="最后一个完整 token。">
            <TextInput
              value={message.suffix ?? ''}
              onChange={(suffix) => patch({ suffix: suffix || undefined })}
              disabled={disabled}
              monospace
            />
          </FormField>
          <FormField label="描述" className="sm:col-span-2">
            <TextInput
              value={message.description ?? ''}
              onChange={(description) => patch({ description: description || undefined })}
              disabled={disabled}
            />
          </FormField>
          <FormField label="摘要字段" className="sm:col-span-2" hint="逗号分隔；用于流量列表摘要。">
            <TextInput
              value={(message.display?.summary ?? []).join(', ')}
              onChange={(value) =>
                patch({
                  display:
                    value.trim() === ''
                      ? undefined
                      : {
                          summary: value
                            .split(',')
                            .map((part) => part.trim())
                            .filter(Boolean),
                        },
                })
              }
              disabled={disabled}
              monospace
              placeholder="dataCount, sequence"
            />
          </FormField>
        </div>

        <MatchRows message={message} onChange={onChange} disabled={disabled} />

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-mist-400">槽位</span>
            <div className="flex flex-wrap gap-1">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addSlot('literal')} disabled={disabled}>
                <Plus className="h-3.5 w-3.5" /> literal
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addSlot('field')} disabled={disabled}>
                <Plus className="h-3.5 w-3.5" /> field
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addSlot('repeat')} disabled={disabled}>
                <Plus className="h-3.5 w-3.5" /> repeat
              </button>
            </div>
          </div>
          {message.slots.map((slot, slotIndex) => (
            <SlotCard
              key={slotIndex}
              slot={slot}
              index={slotIndex}
              message={message}
              messageIndex={index}
              countFields={priorFields(slotIndex)}
              dictionaryNames={dictionaryNames}
              onChange={(next) => updateSlot(slotIndex, next)}
              onMove={(direction) => moveSlot(slotIndex, direction)}
              onDuplicate={() => duplicateSlot(slotIndex)}
              onDelete={() => removeSlot(slotIndex)}
              disabled={disabled}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DictionaryEditor({
  codec,
  onChange,
  disabled,
}: {
  codec: TextCodecConfig;
  onChange: (next: TextCodecConfig) => void;
  disabled: boolean;
}) {
  const serialized = JSON.stringify(codec.dictionaries ?? {}, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(serialized);
  }, [serialized, dirty]);

  function apply() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'JSON 解析失败');
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError('字典必须是“字典名 → 数据码 → 条目”的对象');
      return;
    }
    const dictionaries = parsed as Record<string, Record<string, TextDictionaryEntry>>;
    onChange({
      ...codec,
      dictionaries: Object.keys(dictionaries).length > 0 ? dictionaries : undefined,
    });
    setDirty(false);
    setError(null);
  }

  return (
    <div className="rounded-lg border border-white/10 bg-ink-950/30 p-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-mist-200">数据字典</div>
          <div className="mt-0.5 text-[10.5px] text-mist-500">
            字典名 → 数据码 → name/unit/multi/valueFormat；大字典用 JSON 编辑。
          </div>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={apply} disabled={disabled}>
          应用字典
        </button>
      </div>
      <TextArea
        value={draft}
        onChange={(value) => {
          setDraft(value);
          setDirty(true);
          setError(null);
        }}
        rows={8}
        className="font-mono"
        placeholder='{\n  "codes": {\n    "000": { "name": "电压", "unit": "V" }\n  }\n}'
        disabled={disabled}
        ariaLabel="数据字典 JSON"
      />
      {error && <InlineWarning>{error}</InlineWarning>}
    </div>
  );
}

function SessionEditor({
  codec,
  onChange,
  disabled,
}: {
  codec: TextCodecConfig;
  onChange: (next: TextCodecConfig) => void;
  disabled: boolean;
}) {
  const session = codec.session;
  const ackError = useIssueText('codec.session.ackMessage');
  const trackError = useIssueText('codec.session.trackMessages');
  const sequenceError = useIssueText('codec.session.sequenceField');
  const statusError = useIssueText('codec.session.statusField');
  const timeoutError = useIssueText('codec.session.timeoutMs');
  const retriesError = useIssueText('codec.session.maxRetries');
  const messageOptions = codec.messages.map((message) => ({
    value: message.name,
    label: message.name,
  }));
  const firstMessage = codec.messages[0];
  const firstFields = firstMessage
    ? firstMessage.slots.flatMap((slot) => (slot.kind === 'field' ? [slot.name] : []))
    : [];
  const sequenceField =
    firstFields.find((name) => name.toLowerCase().includes('seq')) ??
    firstFields[0] ??
    '';
  const statusField =
    firstFields.find((name) => name.toLowerCase().includes('status')) ??
    firstFields[0] ??
    '';

  function enable(enabled: boolean) {
    if (!enabled) {
      onChange({ ...codec, session: undefined });
      return;
    }
    const next: TextSession = {
      ackMessage: firstMessage?.name ?? '',
      trackMessages: firstMessage ? [firstMessage.name] : [],
      sequenceField,
      statusField,
      successValues: ['OK'],
      timeoutMs: 5_000,
      maxRetries: 3,
    };
    onChange({ ...codec, session: next });
  }

  function patch(partial: Partial<TextSession>) {
    if (!session) return;
    onChange({ ...codec, session: { ...session, ...partial } });
  }

  return (
    <div className="rounded-lg border border-white/10 bg-ink-950/30 p-2.5">
      <SwitchRow
        label="启用 ACK / 重传"
        hint="配置后 codec 会返回 track，并识别 ACK 报文；不配置则完全跳过会话逻辑。"
        checked={session !== undefined}
        onChange={enable}
        disabled={disabled}
      />
      {session && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <FormField label="ACK 报文" required error={ackError}>
            <SelectInput<string>
              value={session.ackMessage}
              options={messageOptions}
              onChange={(ackMessage) => patch({ ackMessage })}
              disabled={disabled}
              ariaLabel="ACK 报文"
            />
          </FormField>
          <FormField label="跟踪报文" hint="逗号分隔；这些报文发送后会等待 ACK。" error={trackError}>
            <TextInput
              value={session.trackMessages.join(', ')}
              onChange={(value) =>
                patch({
                  trackMessages: value
                    .split(',')
                    .map((part) => part.trim())
                    .filter(Boolean),
                })
              }
              disabled={disabled}
              monospace
              placeholder="report"
            />
          </FormField>
          <FormField label="流水号字段" required error={sequenceError}>
            <TextInput
              value={session.sequenceField}
              onChange={(sequenceField) => patch({ sequenceField })}
              disabled={disabled}
              monospace
              placeholder="sequence"
            />
          </FormField>
          <FormField label="状态字段" required error={statusError}>
            <TextInput
              value={session.statusField}
              onChange={(statusField) => patch({ statusField })}
              disabled={disabled}
              monospace
              placeholder="status"
            />
          </FormField>
          <FormField label="成功状态值" hint="逗号分隔。">
            <TextInput
              value={session.successValues.join(', ')}
              onChange={(value) =>
                patch({
                  successValues: value
                    .split(',')
                    .map((part) => part.trim())
                    .filter(Boolean),
                })
              }
              disabled={disabled}
              monospace
              placeholder="OK"
            />
          </FormField>
          <FormField label="ACK 超时（ms）" error={timeoutError}>
            <NumberInput
              value={session.timeoutMs}
              onChange={(timeoutMs) => patch({ timeoutMs: timeoutMs ?? 5_000 })}
              min={100}
              disabled={disabled}
              ariaLabel="ACK 超时"
            />
          </FormField>
          <FormField label="最大重试次数" error={retriesError}>
            <NumberInput
              value={session.maxRetries}
              onChange={(maxRetries) => patch({ maxRetries: maxRetries ?? 0 })}
              min={0}
              disabled={disabled}
              ariaLabel="最大重试次数"
            />
          </FormField>
        </div>
      )}
    </div>
  );
}

export function TextCodecFields({
  codec,
  onChange,
  disabled = false,
}: {
  codec: TextCodecConfig;
  onChange: (next: TextCodecConfig) => void;
  disabled?: boolean;
}) {
  const separatorError = useIssueText('codec.separator');
  const terminatorError = useIssueText('codec.terminator');
  const timezoneError = useIssueText('codec.timezone');
  const dictionaryNames = Object.keys(codec.dictionaries ?? {});

  function patch(partial: Partial<TextCodecConfig>) {
    onChange({ ...codec, ...partial });
  }

  function updateMessage(index: number, next: TextMessage) {
    const previous = codec.messages[index];
    const updated: TextCodecConfig = {
      ...codec,
      messages: codec.messages.map((message, messageIndex) =>
        messageIndex === index ? next : message,
      ),
    };
    if (codec.session && previous && previous.name !== next.name) {
      updated.session = {
        ...codec.session,
        ackMessage:
          codec.session.ackMessage === previous.name
            ? next.name
            : codec.session.ackMessage,
        trackMessages: codec.session.trackMessages.map((name) =>
          name === previous.name ? next.name : name,
        ),
      };
    }
    onChange(updated);
  }

  function addMessage() {
    const name = uniqueName(
      codec.messages.map((message) => message.name),
      'message',
    );
    patch({ messages: [...codec.messages, newTextMessage(name)] });
  }

  function duplicateMessage(index: number) {
    const message = codec.messages[index];
    if (!message) return;
    const copy = structuredClone(message);
    copy.name = uniqueName(
      codec.messages.map((item) => item.name),
      `${message.name}_copy`,
    );
    copy.label = message.label ? `${message.label} 副本` : undefined;
    patch({
      messages: [
        ...codec.messages.slice(0, index + 1),
        copy,
        ...codec.messages.slice(index + 1),
      ],
    });
  }

  function moveMessage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= codec.messages.length) return;
    const messages = [...codec.messages];
    const [message] = messages.splice(index, 1);
    messages.splice(target, 0, message!);
    patch({ messages });
  }

  function removeMessage(index: number) {
    if (codec.messages.length <= 1) return;
    patch({
      messages: codec.messages.filter((_, messageIndex) => messageIndex !== index),
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2.5 sm:grid-cols-3">
        <FormField label="顶层分隔符" required error={separatorError} hint={'支持 \\r、\\n、\\t、\\xNN 等转义。'}>
          <EscapedTextInput
            value={codec.separator}
            onChange={(separator) => patch({ separator })}
            disabled={disabled}
            placeholder=":"
            ariaLabel="顶层分隔符"
          />
        </FormField>
        <FormField label="结束符" required error={terminatorError} hint={'支持 \\r、\\n、\\t、\\xNN 等转义。'}>
          <EscapedTextInput
            value={codec.terminator}
            onChange={(terminator) => patch({ terminator })}
            disabled={disabled}
            placeholder="\r\n"
            ariaLabel="结束符"
          />
        </FormField>
        <FormField label="时区" error={timezoneError} hint="auto timestamp 使用；local 表示本机时区。">
          <TextInput
            value={codec.timezone}
            onChange={(timezone) => patch({ timezone })}
            disabled={disabled}
            monospace
            placeholder="local / Asia/Shanghai"
          />
        </FormField>
      </div>

      <SwitchRow
        label="trim token"
        hint="关闭后保留 token 两侧空格；数字/时间字段仍会使用原文校验。"
        checked={codec.trim}
        onChange={(trim) => patch({ trim })}
        disabled={disabled}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-mist-400">报文定义</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={addMessage} disabled={disabled}>
          <Plus className="h-3.5 w-3.5" />
          添加报文
        </button>
      </div>

      <div className="space-y-2">
        {codec.messages.map((message, index) => (
          <MessageCard
            key={index}
            message={message}
            index={index}
            messages={codec.messages}
            dictionaryNames={dictionaryNames}
            onChange={(next) => updateMessage(index, next)}
            onMove={(direction) => moveMessage(index, direction)}
            onDuplicate={() => duplicateMessage(index)}
            onDelete={() => removeMessage(index)}
            disabled={disabled}
            defaultOpen={index === 0}
          />
        ))}
      </div>

      <DictionaryEditor codec={codec} onChange={onChange} disabled={disabled} />
      <SessionEditor codec={codec} onChange={onChange} disabled={disabled} />

      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[10.5px] leading-4 text-mist-500">
        <p>编码顺序：prefix → slots（repeat 展开为多个 token）→ suffix；top-level 用 separator 连接，repeat item 内用 itemSeparator。</p>
        <p className="mt-1">每条报文最多一个 optional 字段；repeat 的 countField 必须引用前面的 int 字段。复杂布局用多条带 match 的报文表达。</p>
      </div>
    </div>
  );
}
