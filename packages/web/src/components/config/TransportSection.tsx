import type {
  DeviceConfig,
  MqttBrokerTransport,
  MqttClientTransport,
  MqttSubscription,
  HttpServerTransport,
  SerialTransport,
  VirtualSerialTransport,
  UdpClientTransport,
  UdpServerTransport,
  WebSocketServerTransport,
  TcpClientTransport,
  TcpServerTransport,
  TransportConfig,
} from '@deviceforge/core';
import { Cable, Plus, Trash2 } from 'lucide-react';
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
  type SelectOption,
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

const MQTT_QOS_OPTIONS: { value: '0' | '1'; label: string }[] = [
  { value: '0', label: 'QoS 0 · 至多一次' },
  { value: '1', label: 'QoS 1 · 至少一次' },
];

function MqttSubscriptionRow({
  subscription,
  index,
  disabled,
  onChange,
  onDelete,
}: {
  subscription: MqttSubscription;
  index: number;
  disabled: boolean;
  onChange: (next: MqttSubscription) => void;
  onDelete: () => void;
}) {
  const topicError = useIssueText(`transport.subscriptions.${index}.topic`);
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
      <FormField label={`主题过滤器 ${index + 1}`} error={topicError}>
        <TextInput
          value={subscription.topic}
          onChange={(topic) => onChange({ ...subscription, topic })}
          disabled={disabled}
          monospace
          placeholder="sensors/+/state"
        />
      </FormField>
      <FormField label="订阅 QoS">
        <SelectInput<'0' | '1'>
          value={String(subscription.qos) as '0' | '1'}
          options={MQTT_QOS_OPTIONS}
          onChange={(qos) => onChange({ ...subscription, qos: qos === '0' ? 0 : 1 })}
          disabled={disabled}
          ariaLabel={`订阅 QoS ${index + 1}`}
        />
      </FormField>
      <div className="flex items-end pb-0.5">
        <button
          type="button"
          className="btn btn-ghost btn-sm text-rose-300"
          onClick={onDelete}
          disabled={disabled}
          aria-label={`删除订阅 ${index + 1}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>
      </div>
    </div>
  );
}

function MqttClientFields({
  transport,
  onChange,
  disabled,
}: {
  transport: MqttClientTransport;
  onChange: (next: MqttClientTransport) => void;
  disabled: boolean;
}) {
  function update(patch: Partial<MqttClientTransport>) {
    onChange({ ...transport, ...patch });
  }

  return (
    <>
      <FormField label="Broker 地址" required error={useIssueText('transport.url')} hint="支持 mqtt:// 和 mqtts://；mqtts 默认校验证书。">
        <TextInput
          value={transport.url}
          onChange={(url) => update({ url })}
          disabled={disabled}
          monospace
          placeholder="mqtt://127.0.0.1:1883"
        />
      </FormField>
      <FormField label="Client ID" hint="留空时使用设备 ID。">
        <TextInput
          value={transport.clientId ?? ''}
          onChange={(clientId) => update({ clientId: clientId || undefined })}
          disabled={disabled}
          monospace
          placeholder="my-device"
        />
      </FormField>
      <FormField label="用户名" error={useIssueText('transport.username')}>
        <TextInput
          value={transport.username ?? ''}
          onChange={(username) => update({ username: username || undefined })}
          disabled={disabled}
          placeholder="可选"
        />
      </FormField>
      <FormField label="密码" error={useIssueText('transport.password')} hint="保存在本机设备配置文件中。">
        <TextInput
          type="password"
          value={transport.password ?? ''}
          onChange={(password) => update({ password: password || undefined })}
          disabled={disabled}
          placeholder="可选"
        />
      </FormField>
      <FormField label="CA 证书文件" error={useIssueText('transport.caFile')} hint="仅 mqtts:// 使用；留空时使用系统 CA。">
        <TextInput
          value={transport.caFile ?? ''}
          onChange={(caFile) => update({ caFile: caFile || undefined })}
          disabled={disabled}
          monospace
          placeholder="/path/to/ca.pem"
        />
      </FormField>
      <FormField label="默认发布主题" required error={useIssueText('transport.publishTopic')}>
        <TextInput
          value={transport.publishTopic}
          onChange={(publishTopic) => update({ publishTopic })}
          disabled={disabled}
          monospace
          placeholder="deviceforge/device/up"
        />
      </FormField>
      <FormField label="发布 QoS" error={useIssueText('transport.publishQos')}>
        <SelectInput<'0' | '1'>
          value={String(transport.publishQos) as '0' | '1'}
          options={MQTT_QOS_OPTIONS}
          onChange={(publishQos) => update({ publishQos: publishQos === '0' ? 0 : 1 })}
          disabled={disabled}
          ariaLabel="MQTT 发布 QoS"
        />
      </FormField>

      <div className="sm:col-span-2 rounded-lg border border-white/10 bg-ink-900/30 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium text-mist-300">订阅主题</div>
            <p className="mt-0.5 text-[10.5px] text-mist-500">每条 PUBLISH 载荷作为一帧进入 codec。支持 + 和 #。</p>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => update({ subscriptions: [...transport.subscriptions, { topic: '', qos: 0 }] })}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" />
            添加订阅
          </button>
        </div>
        {transport.subscriptions.length === 0 ? (
          <p className="mt-2 text-[10.5px] text-mist-600">暂无订阅；设备仍可向默认主题发布消息。</p>
        ) : (
          <div className="mt-2 space-y-2">
            {transport.subscriptions.map((subscription, index) => (
              <MqttSubscriptionRow
                key={index}
                subscription={subscription}
                index={index}
                disabled={disabled}
                onChange={(next) => update({ subscriptions: transport.subscriptions.map((item, itemIndex) => itemIndex === index ? next : item) })}
                onDelete={() => update({ subscriptions: transport.subscriptions.filter((_, itemIndex) => itemIndex !== index) })}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function MqttBrokerFields({
  transport,
  onChange,
  disabled,
}: {
  transport: MqttBrokerTransport;
  onChange: (next: MqttBrokerTransport) => void;
  disabled: boolean;
}) {
  function update(patch: Partial<MqttBrokerTransport>) {
    onChange({ ...transport, ...patch });
  }

  return (
    <>
      <FormField label="监听地址" required error={useIssueText('transport.host')} hint="默认只监听本机；如需局域网访问可改为 0.0.0.0。">
        <TextInput value={transport.host} onChange={(host) => update({ host })} disabled={disabled} monospace placeholder="127.0.0.1" />
      </FormField>
      <FormField label="端口" required error={useIssueText('transport.port')}>
        <NumberInput value={transport.port} onChange={(port) => update({ port: port ?? 1883 })} min={0} max={65535} step={1} disabled={disabled} ariaLabel="MQTT Broker 端口" />
      </FormField>
      <FormField label="用户名" error={useIssueText('transport.username')}>
        <TextInput value={transport.username ?? ''} onChange={(username) => update({ username: username || undefined })} disabled={disabled} placeholder="可选，所有客户端共用" />
      </FormField>
      <FormField label="密码" error={useIssueText('transport.password')} hint="保存在本机设备配置文件中。">
        <TextInput type="password" value={transport.password ?? ''} onChange={(password) => update({ password: password || undefined })} disabled={disabled} placeholder="可选，所有客户端共用" />
      </FormField>
      <FormField label="TLS 证书文件" error={useIssueText('transport.certFile')} hint="填写后启用 mqtts://；须与私钥同时配置。">
        <TextInput value={transport.certFile ?? ''} onChange={(certFile) => update({ certFile: certFile || undefined })} disabled={disabled} monospace placeholder="/path/to/server.crt" />
      </FormField>
      <FormField label="TLS 私钥文件" error={useIssueText('transport.keyFile')}>
        <TextInput value={transport.keyFile ?? ''} onChange={(keyFile) => update({ keyFile: keyFile || undefined })} disabled={disabled} monospace placeholder="/path/to/server.key" />
      </FormField>
      <FormField label="默认发布主题" required error={useIssueText('transport.publishTopic')}>
        <TextInput value={transport.publishTopic} onChange={(publishTopic) => update({ publishTopic })} disabled={disabled} monospace placeholder="deviceforge/device/down" />
      </FormField>
      <FormField label="发布 QoS" error={useIssueText('transport.publishQos')}>
        <SelectInput<'0' | '1'> value={String(transport.publishQos) as '0' | '1'} options={MQTT_QOS_OPTIONS} onChange={(publishQos) => update({ publishQos: publishQos === '0' ? 0 : 1 })} disabled={disabled} ariaLabel="MQTT Broker 发布 QoS" />
      </FormField>
      {transport.host === '0.0.0.0' && (
        <div className="sm:col-span-2">
          <InlineWarning>0.0.0.0 会把 Broker 暴露到局域网；确认网络环境可信后再使用。</InlineWarning>
        </div>
      )}
    </>
  );
}

function ExtendedTransportFields({
  transport,
  onChange,
  disabled,
}: {
  transport: Exclude<TransportConfig, TcpServerTransport | TcpClientTransport | MqttClientTransport | MqttBrokerTransport>;
  onChange: (next: TransportConfig) => void;
  disabled: boolean;
}) {
  const hostError = useIssueText('transport.host');
  const portError = useIssueText('transport.port');
  const pathError = useIssueText('transport.path');
  const bodySizeError = useIssueText('transport.maxBodyBytes');
  const messageSizeError = useIssueText('transport.maxMessageBytes');
  const serialPathError = useIssueText('transport.portPath');
  const baudRateError = useIssueText('transport.baudRate');
  const dataBitsError = useIssueText('transport.dataBits');
  const stopBitsError = useIssueText('transport.stopBits');
  const parityError = useIssueText('transport.parity');
  const flowControlError = useIssueText('transport.flowControl');
  const flowOptions: SelectOption<'none' | 'rtscts' | 'xon-xoff'>[] = [
    { value: 'none', label: '无' },
    { value: 'rtscts', label: 'RTS/CTS' },
    { value: 'xon-xoff', label: 'XON/XOFF' },
  ];
  const parityOptions: SelectOption<'none' | 'even' | 'odd'>[] = [
    { value: 'none', label: '无校验' },
    { value: 'even', label: '偶校验' },
    { value: 'odd', label: '奇校验' },
  ];

  if (transport.type === 'serial' || transport.type === 'virtual-serial') {
    const updateSerial = (patch: Partial<SerialTransport | VirtualSerialTransport>) =>
      onChange({ ...transport, ...patch } as SerialTransport | VirtualSerialTransport);
    return (
      <>
        {transport.type === 'serial' ? (
          <FormField label="串口路径" required error={serialPathError} hint="Linux 常见 /dev/ttyUSB0 或 /dev/ttyACM0；macOS 常见 /dev/cu.usbserial-*。">
            <TextInput value={transport.portPath} onChange={(portPath) => updateSerial({ portPath })} disabled={disabled} monospace placeholder="/dev/ttyUSB0" />
          </FormField>
        ) : (
          <div className="sm:col-span-2 rounded-lg border border-white/10 bg-ink-900/30 p-2.5 text-[11px] leading-5 text-mist-400">
            启动时由 socat 创建 PTY 对，设备端与外部工具端路径会显示在端点区域。停止设备会结束 socat 并移除临时 PTY。
          </div>
        )}
        <FormField label="波特率" required error={baudRateError}>
          <NumberInput value={transport.baudRate} onChange={(baudRate) => updateSerial({ baudRate: baudRate ?? 9600 })} min={50} max={4_000_000} step={300} disabled={disabled} ariaLabel="串口波特率" />
        </FormField>
        <FormField label="数据位" error={dataBitsError}>
          <SelectInput<string> value={String(transport.dataBits)} options={[5, 6, 7, 8].map((value) => ({ value: String(value), label: String(value) }))} onChange={(dataBits) => updateSerial({ dataBits: Number(dataBits) as 5 | 6 | 7 | 8 })} disabled={disabled} ariaLabel="串口数据位" />
        </FormField>
        <FormField label="停止位" error={stopBitsError}>
          <SelectInput<string> value={String(transport.stopBits)} options={[{ value: '1', label: '1' }, { value: '1.5', label: '1.5' }, { value: '2', label: '2' }]} onChange={(stopBits) => updateSerial({ stopBits: Number(stopBits) as 1 | 1.5 | 2 })} disabled={disabled} ariaLabel="串口停止位" />
        </FormField>
        <FormField label="校验位" error={parityError}>
          <SelectInput<'none' | 'even' | 'odd'> value={transport.parity} options={[...parityOptions]} onChange={(parity) => updateSerial({ parity })} disabled={disabled} ariaLabel="串口校验位" />
        </FormField>
        <FormField label="流控制" error={flowControlError}>
          <SelectInput<'none' | 'rtscts' | 'xon-xoff'> value={transport.flowControl} options={[...flowOptions]} onChange={(flowControl) => updateSerial({ flowControl })} disabled={disabled} ariaLabel="串口流控制" />
        </FormField>
      </>
    );
  }

  if (transport.type === 'udp-server' || transport.type === 'http-server' || transport.type === 'websocket-server') {
    const updateHostPort = (patch: Partial<UdpServerTransport | HttpServerTransport | WebSocketServerTransport>) =>
      onChange({ ...transport, ...patch } as TransportConfig);
    return (
      <>
        <FormField label="监听地址" required error={hostError} hint="默认绑定 127.0.0.1。">
          <TextInput value={transport.host} onChange={(host) => updateHostPort({ host })} disabled={disabled} monospace placeholder="127.0.0.1" />
        </FormField>
        <FormField label="监听端口" required error={portError} hint="0 表示由系统分配端口。">
          <NumberInput value={transport.port} onChange={(port) => updateHostPort({ port: port ?? 0 })} min={0} max={65535} step={1} disabled={disabled} ariaLabel="监听端口" />
        </FormField>
        {transport.type === 'http-server' && (
          <FormField label="请求体上限（字节）" error={bodySizeError} hint="超过上限的请求返回 413。">
            <NumberInput value={transport.maxBodyBytes} onChange={(maxBodyBytes) => updateHostPort({ maxBodyBytes: maxBodyBytes ?? 1_048_576 })} min={1} max={16 * 1024 * 1024} step={1024} disabled={disabled} ariaLabel="HTTP 请求体上限" />
          </FormField>
        )}
        {transport.type === 'websocket-server' && (
          <>
            <FormField label="WebSocket 路径" required error={pathError}>
              <TextInput value={transport.path} onChange={(path) => updateHostPort({ path })} disabled={disabled} monospace placeholder="/ws" />
            </FormField>
            <FormField label="消息上限（字节）" error={messageSizeError}>
              <NumberInput value={transport.maxMessageBytes} onChange={(maxMessageBytes) => updateHostPort({ maxMessageBytes: maxMessageBytes ?? 1_048_576 })} min={1} max={16 * 1024 * 1024} step={1024} disabled={disabled} ariaLabel="WebSocket 消息上限" />
            </FormField>
          </>
        )}
        <div className="sm:col-span-2 text-[11px] text-mist-500">端点：<span className="font-mono text-mist-300">{transportEndpoint(transport)}</span></div>
        {transport.host === '0.0.0.0' && (
          <div className="sm:col-span-2"><InlineWarning>该模拟服务会开放到局域网，且没有 TLS 或认证。确认网络环境可信后再使用。</InlineWarning></div>
        )}
      </>
    );
  }

  if (transport.type === 'udp-client') {
    const update = (patch: Partial<UdpClientTransport>) => onChange({ ...transport, ...patch });
    return (
      <>
        <FormField label="目标地址" required error={hostError}>
          <TextInput value={transport.host} onChange={(host) => update({ host })} disabled={disabled} monospace placeholder="127.0.0.1" />
        </FormField>
        <FormField label="目标端口" required error={portError}>
          <NumberInput value={transport.port} onChange={(port) => update({ port: port ?? 19011 })} min={1} max={65535} step={1} disabled={disabled} ariaLabel="UDP 目标端口" />
        </FormField>
        <FormField label="本地绑定地址（可选）">
          <TextInput value={transport.localHost ?? ''} onChange={(localHost) => update({ localHost: localHost || undefined })} disabled={disabled} monospace placeholder="系统自动选择" />
        </FormField>
        <FormField label="本地端口" hint="0 表示由系统分配。">
          <NumberInput value={transport.localPort} onChange={(localPort) => update({ localPort: localPort ?? 0 })} min={0} max={65535} step={1} disabled={disabled} ariaLabel="UDP 本地端口" />
        </FormField>
        {transport.host.trim() && !isLoopbackHost(transport.host) && (
          <div className="sm:col-span-2"><InlineWarning>设备会向该地址发送 UDP 数据报；UDP 不提供 TLS 或认证。</InlineWarning></div>
        )}
      </>
    );
  }
  return null;
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
      description="选择 TCP、UDP、串口、HTTP、WebSocket 或 MQTT 传输。"
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
          <TcpServerFields transport={config.transport} onChange={changeTransport} disabled={disabled} />
        ) : config.transport.type === 'tcp-client' ? (
          <TcpClientFields transport={config.transport} onChange={changeTransport} disabled={disabled} />
        ) : config.transport.type === 'mqtt-client' ? (
          <MqttClientFields transport={config.transport} onChange={changeTransport} disabled={disabled} />
        ) : config.transport.type === 'mqtt-broker' ? (
          <MqttBrokerFields transport={config.transport} onChange={changeTransport} disabled={disabled} />
        ) : (
          <ExtendedTransportFields transport={config.transport} onChange={changeTransport} disabled={disabled} />
        )}
      </div>
    </FormSection>
  );
}
