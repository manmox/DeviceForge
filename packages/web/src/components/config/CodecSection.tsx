import type { ChecksumConfig, CodecConfig, DeviceConfig, FieldDef } from '@deviceforge/core';
import { Braces, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { uniqueFieldName } from '../../lib/codec-fields';
import { issueItemIndex } from '../../lib/config-sections';
import {
  defaultChecksum,
  defaultCodec,
  defaultField,
} from '../../lib/config-defaults';
import { useIssues, useIssueText } from '../form/ConfigIssuesContext';
import {
  FormField,
  InlineWarning,
  SelectInput,
  SwitchRow,
  type SelectOption,
} from '../form/FormControls';
import { FormSection } from '../form/FormSection';
import { FieldDefCard } from './FieldDefCard';

const CODEC_OPTIONS: SelectOption<CodecConfig['type']>[] = [
  { value: 'raw', label: 'raw · 原始字节' },
  { value: 'fields', label: 'fields · 声明式字段' },
];

const CHECKSUM_OPTIONS: SelectOption<ChecksumConfig['algo']>[] = [
  { value: 'sum8', label: 'sum8 · 累加和（1B）' },
  { value: 'xor8', label: 'xor8 · 异或（1B）' },
  { value: 'crc8', label: 'crc8 · CRC-8（1B）' },
  { value: 'crc16-modbus', label: 'crc16-modbus · CRC-16/MODBUS（2B）' },
  { value: 'crc16-ccitt', label: 'crc16-ccitt · CRC-16/CCITT（2B）' },
  { value: 'crc32', label: 'crc32 · CRC-32（4B）' },
  { value: 'lrc', label: 'lrc · LRC（1B）' },
];

export function CodecSection({
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
  const codec = config.codec;
  const lastFieldsCodec = useRef<Extract<CodecConfig, { type: 'fields' }> | null>(null);
  const displayError = useIssueText('codec.display');
  const checksumError = useIssueText('codec.checksum');
  const fieldIssues = useIssues('codec.fields');
  const [expandedFields, setExpandedFields] = useState<Set<number>>(new Set());
  const [revealIndex, setRevealIndex] = useState<number | null>(null);
  const fieldsListRef = useRef<HTMLDivElement | null>(null);

  const fieldCount = codec.type === 'fields' ? codec.fields.length : 0;
  const firstIssueField =
    fieldIssues
      .map((issue) => issueItemIndex(issue.path, 'codec.fields'))
      .find((index) => index !== null) ?? null;

  useEffect(() => {
    if (revealIndex === null) return;
    fieldsListRef.current
      ?.querySelector<HTMLElement>(`[data-field-index="${revealIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
    setRevealIndex(null);
  }, [revealIndex]);

  useEffect(() => {
    setExpandedFields((previous) => {
      if (codec.type !== 'fields') {
        return previous.size === 0 ? previous : new Set();
      }
      let changed = false;
      const next = new Set<number>();
      for (const index of previous) {
        if (index < fieldCount) next.add(index);
        else changed = true;
      }
      return changed ? next : previous;
    });
  }, [codec.type, fieldCount]);

  useEffect(() => {
    if (!active || codec.type !== 'fields' || firstIssueField === null) return;
    if (firstIssueField >= fieldCount) return;
    setExpandedFields((previous) =>
      previous.has(firstIssueField)
        ? previous
        : new Set(previous).add(firstIssueField),
    );
    setRevealIndex(firstIssueField);
  }, [active, codec.type, fieldCount, firstIssueField]);

  function revealField(index: number) {
    setExpandedFields((previous) =>
      previous.has(index) ? previous : new Set(previous).add(index),
    );
    setRevealIndex(index);
  }

  function toggleField(index: number) {
    setExpandedFields((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function changeType(type: CodecConfig['type']) {
    if (type === codec.type) return;
    if (codec.type === 'fields') lastFieldsCodec.current = codec;
    if (type === 'raw') {
      onChange({ ...config, codec: defaultCodec('raw') });
      return;
    }
    const fallback = defaultCodec('fields');
    const stored = lastFieldsCodec.current;
    const next: Extract<CodecConfig, { type: 'fields' }> =
      stored ??
      (fallback.type === 'fields'
        ? fallback
        : { type: 'fields', fields: [defaultField('u8', 'payload')] });
    onChange({ ...config, codec: next });
  }

  function updateFields(fields: FieldDef[]) {
    if (codec.type !== 'fields') return;
    onChange({ ...config, codec: { ...codec, fields } });
  }

  function addField() {
    if (codec.type !== 'fields') return;
    const name = uniqueFieldName(codec.fields, 'field');
    const newIndex = codec.fields.length;
    updateFields([...codec.fields, defaultField('u8', name)]);
    revealField(newIndex);
  }

  function updateField(index: number, field: FieldDef) {
    if (codec.type !== 'fields') return;
    updateFields(codec.fields.map((item, itemIndex) => (itemIndex === index ? field : item)));
  }

  function moveField(index: number, direction: -1 | 1) {
    if (codec.type !== 'fields') return;
    const target = index + direction;
    const next = [...codec.fields];
    const item = next[index];
    if (!item || !next[target]) return;
    setExpandedFields((previous) => {
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
    updateFields(next);
  }

  function duplicateField(index: number) {
    if (codec.type !== 'fields') return;
    const field = codec.fields[index];
    if (!field) return;
    const copy = structuredClone(field);
    copy.name = uniqueFieldName(codec.fields, `${field.name}_copy`);
    const newIndex = index + 1;
    setExpandedFields((previous) => {
      const next = new Set<number>();
      for (const itemIndex of previous) {
        next.add(itemIndex >= newIndex ? itemIndex + 1 : itemIndex);
      }
      next.add(newIndex);
      return next;
    });
    setRevealIndex(newIndex);
    updateFields([
      ...codec.fields.slice(0, newIndex),
      copy,
      ...codec.fields.slice(newIndex),
    ]);
  }

  function removeField(index: number) {
    if (codec.type !== 'fields' || codec.fields.length <= 1) return;
    setExpandedFields((previous) => {
      const next = new Set<number>();
      for (const itemIndex of previous) {
        if (itemIndex < index) next.add(itemIndex);
        else if (itemIndex > index) next.add(itemIndex - 1);
      }
      return next;
    });
    updateFields(codec.fields.filter((_, itemIndex) => itemIndex !== index));
  }

  function setChecksumEnabled(enabled: boolean) {
    if (codec.type !== 'fields') return;
    if (!enabled) {
      onChange({ ...config, codec: { type: 'fields', fields: codec.fields } });
      return;
    }
    onChange({ ...config, codec: { ...codec, checksum: defaultChecksum() } });
  }

  return (
    <FormSection
      title="编解码"
      description="字段顺序就是线上字节顺序；常量、长度和校验由 codec 自动补齐。"
      icon={<Braces className="h-4 w-4 text-accent-400" />}
      path="codec"
      actions={
        codec.type === 'fields' ? (
          <button className="btn btn-outline btn-sm" onClick={addField} disabled={disabled}>
            <Plus className="h-3.5 w-3.5" />
            添加字段
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <FormField label="编解码方式">
          <SelectInput<CodecConfig['type']>
            value={codec.type}
            options={CODEC_OPTIONS}
            onChange={changeType}
            disabled={disabled}
            ariaLabel="编解码方式"
          />
        </FormField>

        {codec.type === 'raw' && (
          <>
            <FormField
              label="流量展示格式"
              error={displayError}
              hint="仅影响流量页的展示，不影响实际编解码。"
            >
              <SelectInput<'hex' | 'ascii'>
                value={codec.display}
                options={[
                  { value: 'hex', label: 'hex · 十六进制' },
                  { value: 'ascii', label: 'ascii · 文本' },
                ]}
                onChange={(display) =>
                  onChange({ ...config, codec: { ...codec, display } })
                }
                disabled={disabled}
                ariaLabel="流量展示格式"
              />
            </FormField>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-5 text-mist-500">
              raw 编解码不会解析字段；发送 fields 时可用键为 hex、text 或 data（0-255 数组）。
            </div>
          </>
        )}

        {codec.type === 'fields' && (
          <>
            <div className="text-[11px] text-mist-500">字段顺序即帧内顺序。</div>

            <div className="space-y-2" ref={fieldsListRef}>
              {codec.fields.map((field, index) => (
                <FieldDefCard
                  key={index}
                  field={field}
                  index={index}
                  fields={codec.fields}
                  onChange={(next) => updateField(index, next)}
                  onMove={(direction) => moveField(index, direction)}
                  onDuplicate={() => duplicateField(index)}
                  onDelete={() => removeField(index)}
                  open={expandedFields.has(index)}
                  onToggle={() => toggleField(index)}
                  disabled={disabled}
                />
              ))}
            </div>

            <div className="rounded-lg border border-white/10 bg-ink-900/40 p-2.5">
              <SwitchRow
                label="启用校验和"
                hint="校验和固定写在帧尾，覆盖校验字段之前的全部字节。"
                checked={codec.checksum !== undefined}
                onChange={setChecksumEnabled}
                disabled={disabled}
              />

              {codec.checksum && (
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  <FormField label="算法" error={checksumError}>
                    <SelectInput<ChecksumConfig['algo']>
                      value={codec.checksum.algo}
                      options={CHECKSUM_OPTIONS}
                      onChange={(algo) =>
                        onChange({
                          ...config,
                          codec: {
                            ...codec,
                            checksum: { ...codec.checksum!, algo },
                          },
                        })
                      }
                      disabled={disabled}
                      ariaLabel="校验算法"
                    />
                  </FormField>

                  <FormField label="字节序" hint="默认按算法：MODBUS/CRC32 小端，其余大端。">
                    <SelectInput<'auto' | 'be' | 'le'>
                      value={codec.checksum.endian ?? 'auto'}
                      options={[
                        { value: 'auto', label: '默认（按算法）' },
                        { value: 'be', label: '大端（be）' },
                        { value: 'le', label: '小端（le）' },
                      ]}
                      onChange={(endian) => {
                        if (endian === 'auto') {
                          const { endian: _endian, ...rest } = codec.checksum!;
                          onChange({
                            ...config,
                            codec: { ...codec, checksum: rest },
                          });
                        } else {
                          onChange({
                            ...config,
                            codec: {
                              ...codec,
                              checksum: { ...codec.checksum!, endian },
                            },
                          });
                        }
                      }}
                      disabled={disabled}
                      ariaLabel="校验字节序"
                    />
                  </FormField>

                  <div className="sm:col-span-2">
                    <SwitchRow
                      label="校验失败时阻断"
                      hint="关闭后校验失败只记录警告，帧仍然交给规则处理。"
                      checked={codec.checksum.verify}
                      onChange={(verify) =>
                        onChange({
                          ...config,
                          codec: {
                            ...codec,
                            checksum: { ...codec.checksum!, verify },
                          },
                        })
                      }
                      disabled={disabled}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <InlineWarning>
                      {'{ fields }'} 编码会自动补齐校验和；发送 {'{ hex }'} 会绕过 codec，不会自动追加校验。
                    </InlineWarning>
                  </div>
                </div>
              )}
            </div>

            <button
              className="btn btn-ghost btn-sm w-full"
              onClick={addField}
              disabled={disabled}
            >
              <Plus className="h-3.5 w-3.5" />
              添加字段
            </button>
          </>
        )}
      </div>
    </FormSection>
  );
}
