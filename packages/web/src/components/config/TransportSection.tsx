import type {
  DeviceConfig,
  TcpClientTransport,
  TcpServerTransport,
  TransportConfig,
} from '@deviceforge/core';
import { Cable } from 'lucide-react';
import { changeTransportType } from '../../lib/config-defaults';
import {
  transportEndpoint,
  transportPresentation,
  TRANSPORT_OPTIONS,
  isLoopbackHost,
} from '../../lib/transport-presentation';
import { useIssueText } from '../form/ConfigIssuesContext';
import {
  FormField,
  InlineWarning,
  NumberInput,
  SelectInput,
  SwitchRow,
  TextInput,
} from '../form/FormControls';
import { FormSection } from '../form/FormSection';

function TcpServerFields({
  transport,
  onChange,
  disabled,
}: {
  transport: TcpServerTransport;
  onChange: (next: TcpServerTransport) => void;
  disabled: boolean;
}) {
  const hostError = useIssueText('transport.host');
  const portError = useIssueText('transport.port');

  function update(patch: Partial<TcpServerTransport>) {
    onChange({ ...transport, ...patch });
  }

  return (
    <>
      <FormField
        label="监听地址"
        required
        error={hostError}
        hint="默认只监听本机；如需局域网访问可改为 0.0.0.0。"
      >
        <TextInput
          value={transport.host}
          onChange={(host) => update({ host })}
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
          value={transport.port}
          onChange={(port) => update({ port: port ?? 0 })}
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
            {transportEndpoint(transport)}
          </span>
        </span>
      </div>

      {transport.host === '0.0.0.0' && (
        <div className="sm:col-span-2">
          <InlineWarning>
            0.0.0.0 会把模拟设备暴露到局域网；确认网络环境可信后再使用。
          </InlineWarning>
        </div>
      )}
    </>
  );
}

function TcpClientFields({
  transport,
  onChange,
  disabled,
}: {
  transport: TcpClientTransport;
  onChange: (next: TcpClientTransport) => void;
  disabled: boolean;
}) {
  const hostError = useIssueText('transport.host');
  const portError = useIssueText('transport.port');
  const timeoutError = useIssueText('transport.connectTimeoutMs');
  const minDelayError = useIssueText('transport.reconnect.minDelayMs');
  const maxDelayError = useIssueText('transport.reconnect.maxDelayMs');

  function update(patch: Partial<TcpClientTransport>) {
    onChange({ ...transport, ...patch });
  }

  function updateReconnect(patch: Partial<TcpClientTransport['reconnect']>) {
    update({ reconnect: { ...transport.reconnect, ...patch } });
  }

  return (
    <>
      <FormField
        label="目标地址"
        required
        error={hostError}
        hint="设备启动后会主动连接该地址；可填写局域网或公网目标。"
      >
        <TextInput
          value={transport.host}
          onChange={(host) => update({ host })}
          disabled={disabled}
          monospace
          placeholder="127.0.0.1"
        />
      </FormField>

      <FormField
        label="目标端口"
        required
        error={portError}
        hint="上游服务器监听的 TCP 端口。"
      >
        <NumberInput
          value={transport.port}
          onChange={(port) => update({ port: port ?? 19001 })}
          min={1}
          max={65535}
          step={1}
          disabled={disabled}
          ariaLabel="目标端口"
        />
      </FormField>

      <FormField
        label="连接超时 (ms)"
        required
        error={timeoutError}
        hint="建连超过该时间视为失败，随后按重连策略处理。"
      >
        <NumberInput
          value={transport.connectTimeoutMs}
          onChange={(connectTimeoutMs) =>
            update({ connectTimeoutMs: connectTimeoutMs ?? 5_000 })
          }
          min={100}
          max={120_000}
          step={100}
          disabled={disabled}
          ariaLabel="连接超时"
        />
      </FormField>

      <div className="hidden sm:block" />

      <div className="sm:col-span-2">
        <SwitchRow
          label="自动重连"
          hint="连接失败或意外断开后，按指数退避自动重试，直到停止设备或手动断开。"
          checked={transport.reconnect.enabled}
          onChange={(enabled) => updateReconnect({ enabled })}
          disabled={disabled}
        />
      </div>

      {transport.reconnect.enabled ? (
        <>
          <FormField
            label="初始重试间隔 (ms)"
            required
            error={minDelayError}
            hint="第一次重试的等待时间。"
          >
            <NumberInput
              value={transport.reconnect.minDelayMs}
              onChange={(minDelayMs) =>
                updateReconnect({ minDelayMs: minDelayMs ?? 500 })
              }
              min={10}
              max={60_000}
              step={100}
              disabled={disabled}
              ariaLabel="初始重试间隔"
            />
          </FormField>

          <FormField
            label="最大重试间隔 (ms)"
            required
            error={maxDelayError}
            hint="退避等待的上限；后续重试不会超过该值。"
          >
            <NumberInput
              value={transport.reconnect.maxDelayMs}
              onChange={(maxDelayMs) =>
                updateReconnect({ maxDelayMs: maxDelayMs ?? 10_000 })
              }
              min={10}
              max={300_000}
              step={100}
              disabled={disabled}
              ariaLabel="最大重试间隔"
            />
          </FormField>
        </>
      ) : (
        <div className="sm:col-span-2">
          <InlineWarning>
            关闭自动重连后，连接失败或意外断开不会重试；传输状态会变为错误，设备仍保持运行。
          </InlineWarning>
        </div>
      )}

      <div className="sm:col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mist-500">
        <span>
          端点：
          <span className="ml-1 font-mono text-mist-300">
            → {transportEndpoint(transport)}
          </span>
        </span>
      </div>

      {transport.host.trim().length > 0 && !isLoopbackHost(transport.host) && (
        <div className="sm:col-span-2">
          <InlineWarning>
            设备会主动连接局域网/公网地址；请确认目标可信，并注意当前传输没有
            TLS 或认证。
          </InlineWarning>
        </div>
      )}
    </>
  );
}

export function TransportSection({
  config,
  onChange,
  disabled = false,
}: {
  config: DeviceConfig;
  onChange: (next: DeviceConfig) => void;
  disabled?: boolean;
}) {
  const presentation = transportPresentation(config.transport.type);
  const selectedOption = TRANSPORT_OPTIONS.find(
    (option) => option.value === config.transport.type,
  );

  function changeTransport(next: TransportConfig) {
    onChange({ ...config, transport: next });
  }

  return (
    <FormSection
      title="传输"
      description="设备监听或主动连接的网络端点。TCP Server 等待上位机接入，TCP Client 主动连接上游。"
      icon={<Cable className="h-4 w-4 text-sky-400" />}
      path="transport"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="类型"
          hint={selectedOption?.description ?? presentation.modeLabel}
        >
          <SelectInput<TransportConfig['type']>
            value={config.transport.type}
            options={TRANSPORT_OPTIONS}
            onChange={(type) => {
              if (type === config.transport.type) return;
              changeTransport(changeTransportType(config.transport, type));
            }}
            disabled={disabled}
            ariaLabel="传输类型"
          />
        </FormField>

        <div className="hidden sm:block" />

        {config.transport.type === 'tcp-server' ? (
          <TcpServerFields
            transport={config.transport}
            onChange={(next) => changeTransport(next)}
            disabled={disabled}
          />
        ) : (
          <TcpClientFields
            transport={config.transport}
            onChange={(next) => changeTransport(next)}
            disabled={disabled}
          />
        )}
      </div>
    </FormSection>
  );
}
