import type { DeviceConfig } from '@deviceforge/core';
import { Cable } from 'lucide-react';
import { useIssueText } from '../form/ConfigIssuesContext';
import {
  FormField,
  InlineWarning,
  NumberInput,
  TextInput,
} from '../form/FormControls';
import { FormSection } from '../form/FormSection';

export function TransportSection({
  config,
  onChange,
  disabled = false,
}: {
  config: DeviceConfig;
  onChange: (next: DeviceConfig) => void;
  disabled?: boolean;
}) {
  const hostError = useIssueText('transport.host');
  const portError = useIssueText('transport.port');

  function updateTransport(patch: Partial<DeviceConfig['transport']>) {
    onChange({ ...config, transport: { ...config.transport, ...patch } });
  }

  return (
    <FormSection
      title="传输"
      description="模拟设备监听的本地端点。当前版本只实现 TCP Server；更多传输在 M2 规划中。"
      icon={<Cable className="h-4 w-4 text-sky-400" />}
      path="transport"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="类型" hint="当前仅支持 TCP Server。">
          <div className="field flex h-8 items-center text-xs text-mist-300">TCP Server</div>
        </FormField>

        <div className="hidden sm:block" />

        <FormField
          label="监听地址"
          required
          error={hostError}
          hint="默认只监听本机；如需局域网访问可改为 0.0.0.0。"
        >
          <TextInput
            value={config.transport.host}
            onChange={(host) => updateTransport({ host })}
            disabled={disabled}
            monospace
            placeholder="127.0.0.1"
          />
        </FormField>

        <FormField
          label="端口"
          required
          error={portError}
          hint="0 表示自动分配；实际端口以运行状态中的端点为准。"
        >
          <NumberInput
            value={config.transport.port}
            onChange={(port) => updateTransport({ port: port ?? 0 })}
            min={0}
            max={65535}
            step={1}
            disabled={disabled}
            ariaLabel="监听端口"
          />
        </FormField>

        <div className="sm:col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mist-500">
          <span>
            端点：
            <span className="ml-1 font-mono text-mist-300">
              {config.transport.host}:{config.transport.port || '自动分配'}
            </span>
          </span>
        </div>

        {config.transport.host === '0.0.0.0' && (
          <div className="sm:col-span-2">
            <InlineWarning>
              0.0.0.0 会把模拟设备暴露到局域网；确认网络环境可信后再使用。
            </InlineWarning>
          </div>
        )}
      </div>
    </FormSection>
  );
}
