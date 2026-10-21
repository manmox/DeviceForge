import type { FieldDef } from '@deviceforge/core';
import { ArrowDown, ArrowUp, ChevronRight, Copy, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { fieldNeedsLength, isMultiByteFieldType, isNumericFieldType } from '../../lib/codec-fields';
import { fieldSummary } from '../../lib/config-summary';
import { changeFieldType } from '../../lib/config-defaults';
import { useIssues } from '../form/ConfigIssuesContext';
import {
  FormField,
  IconButton,
  InlineWarning,
  NumberInput,
  SelectInput,
  SwitchInput,
  TextInput,
  type SelectOption,
} from '../form/FormControls';

const FIELD_TYPE_OPTIONS: SelectOption<FieldDef['type']>[] = [
  { value: 'u8', label: 'u8 · 无符号 8 位' },
  { value: 'i8', label: 'i8 · 有符号 8 位' },
  { value: 'u16', label: 'u16 · 无符号 16 位' },
  { value: 'i16', label: 'i16 · 有符号 16 位' },
  { value: 'u24', label: 'u24 · 无符号 24 位' },
  { value: 'i24', label: 'i24 · 有符号 24 位' },
  { value: 'u32', label: 'u32 · 无符号 32 位' },
  { value: 'i32', label: 'i32 · 有符号 32 位' },
  { value: 'f32', label: 'f32 · 单精度浮点' },
  { value: 'f64', label: 'f64 · 双精度浮点' },
  { value: 'bytes', label: 'bytes · 原始字节' },
  { value: 'string', label: 'string · 字符串' },
  { value: 'bcd', label: 'bcd · BCD 数字' },
];

type OptionalFieldKey = Exclude<keyof FieldDef, 'name' | 'type'>;

export function FieldDefCard({
  field,
  index,
  fields,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  open,
  onToggle,
  disabled = false,
}: {
  field: FieldDef;
  index: number;
  fields: FieldDef[];
  onChange: (next: FieldDef) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const issues = useIssues(`codec.fields.${index}`);
  const fromFieldListId = useId();
  const bodyId = useId();
  const summary = fieldSummary(field);
  const priorNumericFields = fields
    .slice(0, index)
    .filter((item) => isNumericFieldType(item.type));

  const lengthMode: 'fixed' | 'remaining' | 'fromField' =
    field.length === 'remaining'
      ? 'remaining'
      : typeof field.length === 'object'
        ? 'fromField'
        : 'fixed';
  const fixedLength = typeof field.length === 'number' ? field.length : 1;
  const fromFieldValue =
    typeof field.length === 'object' ? field.length.fromField : '';

  const duplicateName = fields.filter((item) => item.name === field.name).length > 1;
  const fromFieldWarning = (() => {
    if (lengthMode !== 'fromField') return null;
    if (!fromFieldValue) return 'fromField 不能为空。';
    const targetIndex = fields.findIndex((item) => item.name === fromFieldValue);
    if (targetIndex === -1) return `未找到字段「${fromFieldValue}」。`;
    if (targetIndex >= index) return 'fromField 必须引用当前字段之前的字段。';
    if (!isNumericFieldType(fields[targetIndex]!.type)) {
      return 'fromField 必须引用数值字段。';
    }
    return null;
  })();
  const remainingWarning =
    lengthMode === 'remaining' && index < fields.length - 1;
  const scaleWarning = field.scale === 0;
  const normalizedConst =
    typeof field.const === 'string' ? field.const.replace(/\s+/g, '') : '';
  const hexConstWarning =
    field.type === 'bytes' &&
    typeof field.const === 'string' &&
    !/^(?:[0-9a-fA-F]{2})*$/.test(normalizedConst);
  const bcdConstWarning =
    field.type === 'bcd' &&
    typeof field.const === 'string' &&
    !/^\d*$/.test(field.const);

  const hiddenNotes: string[] = [];
  if (field.length !== undefined && !fieldNeedsLength(field.type)) {
    hiddenNotes.push('该字段带有 length，但当前类型会忽略它；可在源码模式查看。');
  }
  if (field.endian !== undefined && !isMultiByteFieldType(field.type)) {
    hiddenNotes.push('该字段带有 endian，但当前类型不使用它；可在源码模式查看。');
  }
  if (field.encoding !== undefined && field.type !== 'string') {
    hiddenNotes.push('该字段带有 encoding，但只有 string 使用它；可在源码模式查看。');
  }

  function patch(partial: Partial<FieldDef>) {
    onChange({ ...field, ...partial });
  }

  function unset(key: OptionalFieldKey) {
    const next = { ...field };
    delete next[key];
    onChange(next);
  }

  function changeLengthMode(next: 'fixed' | 'remaining' | 'fromField') {
    if (next === 'fixed') {
      patch({ length: fixedLength });
      return;
    }
    if (next === 'remaining') {
      patch({ length: 'remaining' });
      return;
    }
    patch({ length: { fromField: priorNumericFields[0]?.name ?? '' } });
  }

  function changeCalc(next: 'none' | 'totalLength' | 'remainingLength') {
    if (next === 'none') {
      unset('calc');
      return;
    }
    const copy = { ...field, calc: next };
    delete copy.length;
    onChange(copy);
  }

  function toggleConst(enabled: boolean) {
    if (!enabled) {
      unset('const');
      return;
    }
    if (field.type === 'bcd') patch({ const: '0' });
    else if (field.type === 'bytes' || field.type === 'string') patch({ const: '' });
    else patch({ const: 0 });
  }

  return (
    <div
      className="rounded-lg border border-white/10 bg-ink-900/40"
      data-field-index={index}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-2.5 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-mist-500 transition-transform ${
              open ? 'rotate-90' : ''
            }`}
          />
          <span className="chip shrink-0 font-mono text-[10px]">#{index + 1}</span>
          <span className="min-w-0 truncate font-mono text-xs text-mist-200">
            {field.name || '(未命名)'}
          </span>
          <span className="chip shrink-0 text-[10px]">{field.type}</span>
          {issues.length > 0 && (
            <span className="shrink-0 rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-1.5 py-0.5 text-[10px] text-rose-300">
              {issues.length} 个问题
            </span>
          )}
          {summary && (
            <span
              className="hidden min-w-0 truncate text-[10.5px] text-mist-500 md:block"
              title={summary}
            >
              {summary}
            </span>
          )}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton
            label="上移字段"
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="下移字段"
            onClick={() => onMove(1)}
            disabled={disabled || index === fields.length - 1}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="复制字段" onClick={onDuplicate} disabled={disabled}>
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="删除字段"
            danger
            onClick={onDelete}
            disabled={disabled || fields.length <= 1}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="border-b border-rose-500/10 bg-rose-500/[0.04] px-2.5 py-1.5 text-[10.5px] leading-4 text-rose-200">
          {issues.map((issue) => issue.message).join('；')}
        </div>
      )}

      <div
        id={bodyId}
        className={`grid gap-2.5 p-2.5 sm:grid-cols-2 ${open ? '' : 'hidden'}`}
      >
        <FormField label="字段名" required>
          <TextInput
            value={field.name}
            onChange={(name) => patch({ name })}
            disabled={disabled}
            monospace
            placeholder="field"
          />
        </FormField>

        <FormField label="类型" required>
          <SelectInput<FieldDef['type']>
            value={field.type}
            options={FIELD_TYPE_OPTIONS}
            onChange={(type) => onChange(changeFieldType(field, type))}
            disabled={disabled}
            ariaLabel="字段类型"
          />
        </FormField>

        {isMultiByteFieldType(field.type) && (
          <FormField label="字节序" hint="默认使用大端（be）。">
            <SelectInput<'auto' | 'be' | 'le'>
              value={field.endian ?? 'auto'}
              options={[
                { value: 'auto', label: '默认（be）' },
                { value: 'be', label: '大端（be）' },
                { value: 'le', label: '小端（le）' },
              ]}
              onChange={(endian) =>
                endian === 'auto' ? unset('endian') : patch({ endian })
              }
              disabled={disabled}
              ariaLabel="字节序"
            />
          </FormField>
        )}

        {fieldNeedsLength(field.type) && (
          <>
            <FormField label="长度模式">
              <SelectInput<'fixed' | 'remaining' | 'fromField'>
                value={lengthMode}
                options={[
                  { value: 'fixed', label: '固定字节数' },
                  { value: 'remaining', label: '剩余全部' },
                  { value: 'fromField', label: '跟随字段' },
                ]}
                onChange={changeLengthMode}
                disabled={disabled}
                ariaLabel="长度模式"
              />
            </FormField>

            {lengthMode === 'fixed' && (
              <FormField label="长度（字节）" required>
                <NumberInput
                  value={fixedLength}
                  onChange={(length) => patch({ length: length ?? 1 })}
                  min={1}
                  step={1}
                  disabled={disabled}
                  ariaLabel="字段长度"
                />
              </FormField>
            )}

            {lengthMode === 'fromField' && (
              <FormField
                label="引用字段"
                hint="引用前面某个数值字段的值作为长度。"
              >
                <TextInput
                  value={fromFieldValue}
                  onChange={(fromField) => patch({ length: { fromField } })}
                  disabled={disabled}
                  monospace
                  placeholder="len"
                  list={fromFieldListId}
                />
                <datalist id={fromFieldListId}>
                  {priorNumericFields.map((item) => (
                    <option key={item.name} value={item.name} />
                  ))}
                </datalist>
              </FormField>
            )}
          </>
        )}

        {field.type === 'string' && (
          <FormField label="字符串编码" hint="默认 utf8。">
            <SelectInput<'auto' | 'ascii' | 'utf8' | 'hex'>
              value={field.encoding ?? 'auto'}
              options={[
                { value: 'auto', label: '默认（utf8）' },
                { value: 'ascii', label: 'ascii' },
                { value: 'utf8', label: 'utf8' },
                { value: 'hex', label: 'hex' },
              ]}
              onChange={(encoding) =>
                encoding === 'auto' ? unset('encoding') : patch({ encoding })
              }
              disabled={disabled}
              ariaLabel="字符串编码"
            />
          </FormField>
        )}

        {isNumericFieldType(field.type) && (
          <FormField label="自动计算长度">
            <SelectInput<'none' | 'totalLength' | 'remainingLength'>
              value={field.calc ?? 'none'}
              options={[
                { value: 'none', label: '不自动计算' },
                { value: 'totalLength', label: '整帧长度（totalLength）' },
                { value: 'remainingLength', label: '剩余长度（remainingLength）' },
              ]}
              onChange={changeCalc}
              disabled={disabled}
              ariaLabel="自动计算长度"
            />
          </FormField>
        )}

        <div className="sm:col-span-2 rounded-lg border border-white/5 bg-white/[0.015] p-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-mist-300">固定值 const</div>
              <div className="mt-0.5 text-[10.5px] leading-4 text-mist-500">
                编码时未提供该字段就使用此值；解码不一致只会产生警告。
              </div>
            </div>
            <SwitchInput
              checked={field.const !== undefined}
              onChange={toggleConst}
              label="启用固定值"
              disabled={disabled}
            />
          </div>

          {field.const !== undefined && (
            <div className="mt-2">
              {isNumericFieldType(field.type) && (
                <NumberInput
                  value={typeof field.const === 'number' ? field.const : 0}
                  onChange={(next) => patch({ const: next ?? 0 })}
                  disabled={disabled}
                  ariaLabel="固定值"
                />
              )}
              {field.type === 'bytes' && (
                <TextInput
                  value={typeof field.const === 'string' ? field.const : ''}
                  onChange={(constValue) =>
                    patch({ const: constValue.replace(/\s+/g, '') })
                  }
                  disabled={disabled}
                  monospace
                  placeholder="AA55"
                  ariaLabel="固定值（hex）"
                />
              )}
              {field.type === 'string' && (
                <TextInput
                  value={typeof field.const === 'string' ? field.const : ''}
                  onChange={(constValue) => patch({ const: constValue })}
                  disabled={disabled}
                  placeholder="固定文本"
                  ariaLabel="固定值"
                />
              )}
              {field.type === 'bcd' && (
                <TextInput
                  value={typeof field.const === 'string' ? field.const : ''}
                  onChange={(constValue) =>
                    patch({ const: constValue.replace(/\D+/g, '') })
                  }
                  disabled={disabled}
                  monospace
                  placeholder="1234"
                  ariaLabel="固定值（BCD）"
                />
              )}
              {field.calc !== undefined && (
                <p className="mt-1 text-[10.5px] leading-4 text-amber-300">
                  calc 字段通常不需要固定值；编码时计算值会覆盖它。
                </p>
              )}
            </div>
          )}
        </div>

        {isNumericFieldType(field.type) && (
          <>
            <FormField
              label="缩放 scale"
              hint="业务值 = 原始值 × scale；留空表示不缩放。"
            >
              <NumberInput
                value={field.scale}
                onChange={(scale) =>
                  scale === undefined ? unset('scale') : patch({ scale })
                }
                allowEmpty
                disabled={disabled}
                ariaLabel="缩放比例"
              />
            </FormField>
            <FormField label="单位">
              <TextInput
                value={field.unit ?? ''}
                onChange={(unit) =>
                  unit.trim() === '' ? unset('unit') : patch({ unit })
                }
                disabled={disabled}
                placeholder="℃"
              />
            </FormField>
          </>
        )}

        <FormField label="描述" className="sm:col-span-2">
          <TextInput
            value={field.description ?? ''}
            onChange={(description) =>
              description.trim() === ''
                ? unset('description')
                : patch({ description })
            }
            disabled={disabled}
            placeholder="仅用于展示"
          />
        </FormField>

        {(duplicateName ||
          fromFieldWarning ||
          remainingWarning ||
          scaleWarning ||
          hexConstWarning ||
          bcdConstWarning ||
          hiddenNotes.length > 0) && (
          <div className="sm:col-span-2 space-y-1">
            {duplicateName && <InlineWarning>字段名重复，解码时可能互相覆盖。</InlineWarning>}
            {fromFieldWarning && <InlineWarning>{fromFieldWarning}</InlineWarning>}
            {remainingWarning && (
              <InlineWarning>remaining 后面还有字段，可能导致解码结果不符合预期。</InlineWarning>
            )}
            {scaleWarning && <InlineWarning>scale 为 0 时编码会报错。</InlineWarning>}
            {hexConstWarning && (
              <InlineWarning>bytes 固定值必须是偶数位十六进制。</InlineWarning>
            )}
            {bcdConstWarning && (
              <InlineWarning>BCD 固定值应只包含数字；编码时会去掉非数字字符。</InlineWarning>
            )}
            {hiddenNotes.map((note) => (
              <InlineWarning key={note}>{note}</InlineWarning>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
