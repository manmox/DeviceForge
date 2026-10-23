import type { CodecConfig, OutgoingMessage } from '@deviceforge/core';
import { Wand2 } from 'lucide-react';
import {
  codecFieldSuggestions,
  defaultFieldsForCodec,
  missingFieldsForCodec,
} from '../../lib/codec-fields';
import { hexToBytes } from '../../lib/format';
import { messageKind, withMessageKind } from '../../lib/rule-shape';
import type { TemplateCompletionContext } from '../../lib/template-suggestions';
import type { DictionaryRegistry } from '../../types';
import { useIssueText } from '../form/ConfigIssuesContext';
import {
  FormField,
  InlineWarning,
  SelectInput,
  TextArea,
} from '../form/FormControls';
import { VisualJsonEditor } from '../form/VisualJsonEditor';

export function MessageEditor({
  message,
  onChange,
  codec,
  dictionaries,
  templateContext,
  path,
  disabled = false,
}: {
  message: OutgoingMessage;
  onChange: (next: OutgoingMessage) => void;
  codec: CodecConfig;
  dictionaries?: DictionaryRegistry;
  templateContext?: TemplateCompletionContext;
  path: string;
  disabled?: boolean;
}) {
  const kind = messageKind(message);
  const issueText = useIssueText(path);
  const fields = message.fields ?? {};
  const suggestions = codecFieldSuggestions(codec);

  const missingFields = missingFieldsForCodec(codec, fields);

  const hex = message.hex ?? '';
  const validHex = /^(?:[0-9a-fA-F]{2})*$/.test(hex);
  const bytes = hexToBytes(hex);
  const preview = bytes
    .slice(0, 24)
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');

  return (
    <div className="space-y-2">
      {issueText && <p className="text-[10.5px] leading-4 text-rose-300">{issueText}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <FormField label="消息格式" className="w-52">
          <SelectInput<'fields' | 'hex'>
            value={kind}
            options={[
              { value: 'fields', label: 'fields · 声明式字段' },
              { value: 'hex', label: 'hex · 原始字节' },
            ]}
            onChange={(nextKind) => onChange(withMessageKind(message, nextKind))}
            disabled={disabled}
            ariaLabel="消息格式"
          />
        </FormField>
        {kind === 'fields' && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() =>
              onChange({ fields: defaultFieldsForCodec(codec, dictionaries) })
            }
            disabled={disabled}
            title="根据编解码字段生成默认值"
          >
            <Wand2 className="h-3.5 w-3.5" />
            按字段填充
          </button>
        )}
      </div>

      {kind === 'fields' ? (
        <>
          <VisualJsonEditor
            value={fields}
            onChange={(nextFields) => onChange({ fields: nextFields })}
            keyPlaceholder="字段名"
            addLabel="添加字段"
            emptyText="没有字段"
            templates
            completion={templateContext}
            suggestions={suggestions}
            disabled={disabled}
          />
          <p className="text-[10.5px] leading-4 text-mist-500">
            {codec.type === 'fields'
              ? '常量、长度和校验由 codec 自动补齐；值支持模板，输入 $ 或 ${ 可打开建议。'
              : codec.type === 'text'
                ? 'kind 选择报文；repeat 用数组，item 字段名由 codec 配置决定；optional 字段可用 null 显式省略，timestamp / sequence 可自动生成。'
                : 'raw codec 可用键：hex / text / data（0-255 数组）。'}
          </p>
          {missingFields.length > 0 && (
            <InlineWarning>
              缺少非 const/calc 字段：{missingFields.join('、')}；发送时可能报错。
            </InlineWarning>
          )}
        </>
      ) : (
        <>
          <TextArea
            value={hex}
            onChange={(value) => onChange({ hex: value.replace(/\s+/g, '') })}
            rows={3}
            className="min-h-[78px] font-mono"
            placeholder="AA 55 00 0C ..."
            disabled={disabled}
            ariaLabel="原始 hex 消息"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-mist-500">
            <span>{bytes.length} 字节</span>
            <span className="min-w-0 truncate font-mono text-mist-400">
              {preview || '—'}
              {bytes.length > 24 ? ' …' : ''}
            </span>
          </div>
          {!validHex && <InlineWarning>hex 必须是偶数位十六进制，允许为空。</InlineWarning>}
          <p className="text-[10.5px] leading-4 text-mist-500">
            hex 会绕过 codec 的常量/长度/校验，直接发送原始字节。
          </p>
        </>
      )}
    </div>
  );
}
