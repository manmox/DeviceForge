import type { DeviceConfig, FramingConfig } from '@deviceforge/core';
import { Ruler } from 'lucide-react';
import { changeFramingType } from '../../lib/config-defaults';
import { hexToBytes } from '../../lib/format';
import { useIssueText } from '../form/ConfigIssuesContext';
import {
  FormField,
  InlineWarning,
  NumberInput,
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
          <>
            <FormField
              label="分隔符（hex）"
              required
              error={delimiterError}
              hint="偶数位十六进制，可带空格；例如 CRLF 是 0D0A。"
            >
              <TextInput
                value={framing.delimiter}
                onChange={(value) =>
                  setFraming({ ...framing, delimiter: value.replace(/\s+/g, '') })
                }
                disabled={disabled}
                monospace
                placeholder="0D0A"
              />
            </FormField>
            <div className="flex flex-col justify-end">
              <div className="text-[10.5px] text-mist-500">
                预览：
                <span className="ml-1 font-mono text-mist-300">
                  {hexToBytes(framing.delimiter)
                    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
                    .join(' ') || '—'}
                </span>
              </div>
              <div className="mt-0.5 text-[10.5px] text-mist-500">
                {hexToBytes(framing.delimiter).length} 字节
              </div>
            </div>
            {!DELIMITER_PATTERN.test(framing.delimiter) && (
              <div className="sm:col-span-2">
                <InlineWarning>分隔符必须是非空的偶数位十六进制。</InlineWarning>
              </div>
            )}
            <div className="sm:col-span-2">
              <SwitchRow
                label="保留分隔符"
                hint="开启后分隔符会包含在交给 codec 的帧中。"
                checked={framing.includeDelimiter}
                onChange={(includeDelimiter) => setFraming({ ...framing, includeDelimiter })}
                disabled={disabled}
              />
            </div>
          </>
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
