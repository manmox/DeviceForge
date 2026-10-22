import type {
  DelimiterFormat,
  DeviceConfig,
  FramingConfig,
} from '@deviceforge/core';
import { Ruler } from 'lucide-react';
import { useEffect, useState } from 'react';
import { changeFramingType } from '../../lib/config-defaults';
import {
  TEXT_DELIMITER_PRESETS,
  delimiterTextBytes,
  delimiterTextToHex,
  escapeDelimiterText,
  formatHexBytes,
  hexToDelimiterText,
  parseDelimiterText,
} from '../../lib/delimiter';
import { hexToBytes } from '../../lib/format';
import { useIssueText } from '../form/ConfigIssuesContext';
import {
  FormField,
  InlineWarning,
  NumberInput,
  SegmentedControl,
  SelectInput,
  SwitchRow,
  TextInput,
  type SelectOption,
} from '../form/FormControls';
import { FormSection } from '../form/FormSection';

const FRAMING_OPTIONS: SelectOption<FramingConfig['type']>[] = [
  { value: 'raw', label: 'raw · 原始数据块' },
  { value: 'delimiter', label: 'delimiter · 分隔符' },
  { value: 'length-prefix', label: 'length-prefix · 长度字段' },
  { value: 'fixed', label: 'fixed · 固定长度' },
];

const DELIMITER_PATTERN = /^(?:[0-9a-fA-F]{2})+$/;
const MAX_FRAME_LENGTH = 16 * 1024 * 1024;

type DelimiterFraming = Extract<FramingConfig, { type: 'delimiter' }>;

export function FramingSection({
  config,
  onChange,
  disabled = false,
}: {
  config: DeviceConfig;
  onChange: (next: DeviceConfig) => void;
  disabled?: boolean;
}) {
  const framing = config.framing;
  const delimiterError = useIssueText('framing.delimiter');
  const delimiterFormatError = useIssueText('framing.delimiterFormat');
  const lengthFieldError = useIssueText('framing.lengthField');
  const maxFrameLengthError = useIssueText('framing.maxFrameLength');
  const fixedLengthError = useIssueText('framing.length');

  function setFraming(next: FramingConfig) {
    onChange({ ...config, framing: next });
  }

  return (
    <FormSection
      title="分帧"
      description="只影响入站分帧；出站帧由 codec 完整编码。"
      icon={<Ruler className="h-4 w-4 text-violet-400" />}
      path="framing"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="分帧方式"
          hint="切换方式会使用新类型的默认参数；重新加载可恢复已保存值。"
          className="sm:col-span-2"
        >
          <SelectInput<FramingConfig['type']>
            value={framing.type}
            options={FRAMING_OPTIONS}
            onChange={(type) => setFraming(changeFramingType(framing, type))}
            disabled={disabled}
            ariaLabel="分帧方式"
          />
        </FormField>

        {framing.type === 'raw' && (
          <div className="sm:col-span-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-5 text-mist-500">
            每个 TCP 数据块都会作为一个完整帧交给 codec；粘包和半包不会被处理。需要明确消息边界时请使用
            length-prefix、delimiter 或 fixed。
          </div>
        )}

        {framing.type === 'delimiter' && (
          <DelimiterFramingFields
            framing={framing}
            onChange={setFraming}
            disabled={disabled}
            schemaError={delimiterError}
            formatSchemaError={delimiterFormatError}
          />
        )}

        {framing.type === 'length-prefix' && (
          <>
            <FormField
              label="长度字段偏移"
              error={lengthFieldError}
              hint="从帧起点开始计算，单位字节。"
            >
              <NumberInput
                value={framing.lengthField.offset}
                onChange={(offset) =>
                  setFraming({
                    ...framing,
                    lengthField: { ...framing.lengthField, offset: offset ?? 0 },
                  })
                }
                min={0}
                step={1}
                disabled={disabled}
                ariaLabel="长度字段偏移"
              />
            </FormField>
            <FormField label="长度字段大小">
              <SelectInput<'1' | '2' | '4'>
                value={String(framing.lengthField.size) as '1' | '2' | '4'}
                options={[
                  { value: '1', label: '1 字节' },
                  { value: '2', label: '2 字节' },
                  { value: '4', label: '4 字节' },
                ]}
                onChange={(size) =>
                  setFraming({
                    ...framing,
                    lengthField: {
                      ...framing.lengthField,
                      size: Number(size) as 1 | 2 | 4,
                    },
                  })
                }
                disabled={disabled}
                ariaLabel="长度字段大小"
              />
            </FormField>
            <FormField label="长度字节序">
              <SelectInput<'be' | 'le'>
                value={framing.lengthField.endian}
                options={[
                  { value: 'be', label: '大端（be）' },
                  { value: 'le', label: '小端（le）' },
                ]}
                onChange={(endian) =>
                  setFraming({
                    ...framing,
                    lengthField: { ...framing.lengthField, endian },
                  })
                }
                disabled={disabled}
                ariaLabel="长度字节序"
              />
            </FormField>
            <FormField
              label="长度修正"
              hint="实际帧长 = 长度字段值 + adjust；可为负数。"
            >
              <NumberInput
                value={framing.lengthField.adjust}
                onChange={(adjust) =>
                  setFraming({
                    ...framing,
                    lengthField: { ...framing.lengthField, adjust: adjust ?? 0 },
                  })
                }
                step={1}
                disabled={disabled}
                ariaLabel="长度修正"
              />
            </FormField>
            <FormField label="最大帧长" error={maxFrameLengthError} hint="范围 1..16 MiB。">
              <NumberInput
                value={framing.maxFrameLength}
                onChange={(maxFrameLength) =>
                  setFraming({ ...framing, maxFrameLength: maxFrameLength ?? 65535 })
                }
                min={1}
                max={MAX_FRAME_LENGTH}
                step={1}
                disabled={disabled}
                ariaLabel="最大帧长"
              />
            </FormField>
            <div className="sm:col-span-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-5 text-mist-500">
              帧总长 = 长度字段值 + adjust；长度字段本身和帧头都计入帧长。
            </div>
          </>
        )}

        {framing.type === 'fixed' && (
          <FormField
            label="每帧长度"
            required
            error={fixedLengthError}
            hint="范围 1..16 MiB；不足时等待后续数据。"
          >
            <NumberInput
              value={framing.length}
              onChange={(length) => setFraming({ ...framing, length: length ?? 1 })}
              min={1}
              max={MAX_FRAME_LENGTH}
              step={1}
              disabled={disabled}
              ariaLabel="每帧长度"
            />
          </FormField>
        )}
      </div>
    </FormSection>
  );
}

// 单独抽组件：切换 framing.type 时随之卸载，draft/error 不会残留在其他分帧方式里。
function DelimiterFramingFields({
  framing,
  onChange,
  disabled,
  schemaError,
  formatSchemaError,
}: {
  framing: DelimiterFraming;
  onChange: (next: FramingConfig) => void;
  disabled: boolean;
  schemaError?: string;
  formatSchemaError?: string;
}) {
  const format = framing.delimiterFormat ?? 'hex';
  const [draft, setDraft] = useState(() => escapeDelimiterText(framing.delimiter));
  const [focused, setFocused] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // draft 是输入框里的转义显示值，framing.delimiter 是规范文本。聚焦时不要
  // 用配置覆盖 draft，否则输入 \r 等转义中间态会被打断、光标也会跳走。
  useEffect(() => {
    if (focused) return;
    setDraft(escapeDelimiterText(framing.delimiter));
    setParseError(null);
  }, [framing.delimiter, format, focused]);

  useEffect(() => {
    setSwitchError(null);
  }, [framing.delimiter, format]);

  function setText(text: string) {
    onChange({ ...framing, delimiterFormat: 'text', delimiter: text });
  }

  function handleTextChange(next: string) {
    setDraft(next);
    const parsed = parseDelimiterText(next);
    if (!parsed.ok) {
      setParseError(parsed.error);
      return;
    }
    setParseError(null);
    if (parsed.text !== framing.delimiter) setText(parsed.text);
  }

  function applyPreset(text: string) {
    setDraft(escapeDelimiterText(text));
    setParseError(null);
    setSwitchError(null);
    setText(text);
  }

  // 模式切换的不对称是有意的：text→HEX 总是无损；HEX→text 只接受严格 UTF-8。
  // 非法 HEX 清空后切成文本，避免用户被困在 HEX；合法但非 UTF-8 则保持 HEX。
  function switchFormat(next: DelimiterFormat) {
    if (next === format || disabled) return;
    setSwitchError(null);
    setParseError(null);

    if (next === 'hex') {
      onChange({
        ...framing,
        delimiterFormat: 'hex',
        delimiter: delimiterTextToHex(framing.delimiter),
      });
      return;
    }

    const decoded = hexToDelimiterText(framing.delimiter);
    if (decoded.ok) {
      setDraft(escapeDelimiterText(decoded.text));
      onChange({
        ...framing,
        delimiterFormat: 'text',
        delimiter: decoded.text,
      });
      return;
    }

    if (decoded.reason === 'invalid-hex') {
      setDraft('');
      onChange({
        ...framing,
        delimiterFormat: 'text',
        delimiter: '',
      });
      return;
    }

    setSwitchError(
      '当前 HEX 字节不是合法 UTF-8，无法无损转换为文本；请先修改字节，或清空后再切换。',
    );
  }

  const isText = format === 'text';
  const textBytes = isText ? delimiterTextBytes(framing.delimiter) : null;
  const hexBytes = isText ? null : hexToBytes(framing.delimiter);
  const previewBytes = textBytes ?? hexBytes ?? [];
  const previewHex = formatHexBytes(previewBytes);
  const decodedHex = isText ? null : hexToDelimiterText(framing.delimiter);
  const hexTextPreview = decodedHex?.ok
    ? escapeDelimiterText(decodedHex.text) || '—'
    : decodedHex?.reason === 'invalid-utf8'
      ? '非 UTF-8 字节'
      : '—';

  return (
    <>
      <div className="flex flex-col">
        <span className="mb-1 text-[11px] font-medium text-mist-400">分隔符格式</span>
        <SegmentedControl<DelimiterFormat>
          value={format}
          options={[
            { value: 'text', label: '文本（UTF-8）' },
            { value: 'hex', label: 'HEX' },
          ]}
          onChange={switchFormat}
          disabled={disabled}
          size="sm"
          ariaLabel="分隔符格式"
        />
        {formatSchemaError && (
          <span className="mt-1 block text-[10.5px] leading-4 text-rose-300">
            {formatSchemaError}
          </span>
        )}
      </div>

      {isText ? (
        <FormField
          label="分隔符（文本）"
          required
          error={parseError ?? schemaError}
          hint={'按 UTF-8 编码；支持 \\r、\\n、\\t、\\0、\\\\、\\xNN。文本中的 "0D0A" 是 4 个 ASCII 字符。'}
        >
          <TextInput
            value={draft}
            onChange={handleTextChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            monospace
            placeholder={'\\r\\n 或 |'}
          />
        </FormField>
      ) : (
        <FormField
          label="分隔符（HEX）"
          required
          error={schemaError}
          hint="偶数位十六进制，可带空格；例如 CRLF 是 0D0A。"
        >
          <TextInput
            value={framing.delimiter}
            onChange={(value) => {
              setSwitchError(null);
              onChange({
                ...framing,
                delimiter: value.replace(/\s+/g, ''),
              });
            }}
            disabled={disabled}
            monospace
            placeholder="0D0A"
          />
        </FormField>
      )}

      {isText && (
        <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] text-mist-500">常用：</span>
          {TEXT_DELIMITER_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="chip transition-colors hover:border-white/20 hover:text-mist-200 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => applyPreset(preset.text)}
              disabled={disabled}
              title={escapeDelimiterText(preset.text)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {isText && framing.delimiter.length === 0 && !schemaError && !parseError && (
        <div className="sm:col-span-2">
          <InlineWarning>分隔符不能为空。</InlineWarning>
        </div>
      )}

      {!isText && !DELIMITER_PATTERN.test(framing.delimiter) && (
        <div className="sm:col-span-2">
          <InlineWarning>分隔符必须是非空的偶数位十六进制。</InlineWarning>
        </div>
      )}

      {switchError && (
        <div className="sm:col-span-2">
          <InlineWarning>{switchError}</InlineWarning>
        </div>
      )}

      <div className="sm:col-span-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[10.5px] leading-5 text-mist-500">
        <div>
          {isText ? 'UTF-8 字节' : 'HEX 字节'}：
          <span className="ml-1 font-mono text-mist-300">
            {previewHex || '—'}
          </span>
          <span className="ml-2">· {previewBytes.length} 字节</span>
        </div>
        {!isText && (
          <div className="mt-0.5">
            文本：
            <span className="ml-1 font-mono text-mist-300">
              {hexTextPreview}
            </span>
          </div>
        )}
      </div>

      <div className="sm:col-span-2">
        <SwitchRow
          label="保留分隔符"
          hint="开启后分隔符会包含在交给 codec 的帧中。"
          checked={framing.includeDelimiter}
          onChange={(includeDelimiter) => onChange({ ...framing, includeDelimiter })}
          disabled={disabled}
        />
      </div>
    </>
  );
}
