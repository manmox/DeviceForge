import type {
  TransportConfig,
  TransportStatus,
} from '@deviceforge/core';

export type TransportPresentation = {
  kindLabel: string;
  modeLabel: string;
  endpointLabel: string;
  endpointShortLabel: string;
  peerLabel: string;
  connectionTitle: string;
  connectionStatLabel: string;
  connectionUnit: string;
  sendTargetLabel: string;
  waitingLabel: string;
  pausedLabel: string;
  emptyConnectionText: (endpoint: string) => string;
  trafficEmptyHint: string;
  copyEndpointTitle: string;
  disconnectHint: string;
  isOutbound: boolean;
};

export const TRANSPORT_OPTIONS: {
  value: TransportConfig['type'];
  label: string;
  description: string;
}[] = [
  {
    value: 'tcp-server',
    label: 'TCP Server · 监听端口',
    description: '等待上位机主动连接本地端口。',
  },
  {
    value: 'tcp-client',
    label: 'TCP Client · 主动连接',
    description: '设备启动后主动连接一个上游服务器。',
  },
  {
    value: 'mqtt-client',
    label: 'MQTT Client · 发布订阅',
    description: '连接外部 MQTT Broker，按主题订阅和发布消息。',
  },
  {
    value: 'mqtt-broker',
    label: 'MQTT Broker · 本机服务',
    description: '在本机启动 MQTT Broker，供 MQTT 客户端连接。',
  },
];

const PRESENTATIONS: Record<TransportConfig['type'], TransportPresentation> = {
  'tcp-server': {
    kindLabel: 'TCP Server',
    modeLabel: '监听模式',
    endpointLabel: '监听地址',
    endpointShortLabel: '监听',
    peerLabel: '客户端',
    connectionTitle: '客户端连接',
    connectionStatLabel: '客户端连接',
    connectionUnit: '个连接',
    sendTargetLabel: '→ 最新连接',
    waitingLabel: '等待上位机连接',
    pausedLabel: '连接已断开，等待上位机重新连接',
    emptyConnectionText: (endpoint) =>
      `让上位机连接 ${endpoint} 后，连接会出现在这里。你可以查看收发字节数并手动断开。`,
    trafficEmptyHint:
      '启动设备后，让上位机连接本地端口；收发报文会实时出现在这里。',
    copyEndpointTitle: '复制监听地址',
    disconnectHint: '断开后，上位机需要重新连接。',
    isOutbound: false,
  },
  'tcp-client': {
    kindLabel: 'TCP Client',
    modeLabel: '主动连接',
    endpointLabel: '目标地址',
    endpointShortLabel: '目标',
    peerLabel: '上游服务器',
    connectionTitle: '上游连接',
    connectionStatLabel: '上游连接',
    connectionUnit: '条上游连接',
    sendTargetLabel: '→ 上游连接',
    waitingLabel: '等待连接上游',
    pausedLabel: '已手动断开，重启设备后重新连接',
    emptyConnectionText: (endpoint) =>
      `设备启动后会主动连接 ${endpoint}；连接成功后显示在这里。异常断开会自动重连，手动断开会暂停重连。`,
    trafficEmptyHint:
      '启动设备后，它会主动连接上游；收发报文会实时出现在这里。',
    copyEndpointTitle: '复制目标地址',
    disconnectHint: '断开后暂停自动重连；重启设备可恢复连接。',
    isOutbound: true,
  },
  'mqtt-client': {
    kindLabel: 'MQTT Client',
    modeLabel: '发布 / 订阅',
    endpointLabel: 'Broker 地址',
    endpointShortLabel: 'Broker',
    peerLabel: 'MQTT Broker',
    connectionTitle: 'Broker 连接',
    connectionStatLabel: 'Broker 连接',
    connectionUnit: '条 Broker 连接',
    sendTargetLabel: '→ 默认发布主题',
    waitingLabel: '等待连接 MQTT Broker',
    pausedLabel: '已手动断开，重启设备后重新连接',
    emptyConnectionText: (endpoint) =>
      `设备启动后会连接 ${endpoint}，随后订阅配置中的主题并发布消息。`,
    trafficEmptyHint: '连接 MQTT Broker 后，收发消息会实时出现在这里。',
    copyEndpointTitle: '复制 Broker 地址',
    disconnectHint: '断开后停止自动重连；重启设备可恢复连接。',
    isOutbound: true,
  },
  'mqtt-broker': {
    kindLabel: 'MQTT Broker',
    modeLabel: '本机服务',
    endpointLabel: '监听地址',
    endpointShortLabel: '监听',
    peerLabel: 'MQTT 客户端',
    connectionTitle: '客户端连接',
    connectionStatLabel: '客户端连接',
    connectionUnit: '个客户端',
    sendTargetLabel: '→ 发布到主题',
    waitingLabel: '等待 MQTT 客户端连接',
    pausedLabel: 'Broker 已停止',
    emptyConnectionText: (endpoint) =>
      `让 MQTT 客户端连接 ${endpoint}；收到的 PUBLISH 载荷会进入设备编解码和规则流程。`,
    trafficEmptyHint: '启动 Broker 并连接 MQTT 客户端后，消息会实时出现在这里。',
    copyEndpointTitle: '复制 Broker 监听地址',
    disconnectHint: '断开该 MQTT 客户端。',
    isOutbound: false,
  },
};

export function transportPresentation(
  type: TransportConfig['type'],
): TransportPresentation {
  return PRESENTATIONS[type];
}

function formatHost(host: string): string {
  const trimmed = host.trim();
  return trimmed.includes(':') && !trimmed.startsWith('[')
    ? `[${trimmed}]`
    : trimmed;
}

export function formatHostPort(host: string, port: number): string {
  return `${formatHost(host)}:${port}`;
}

export function transportEndpoint(
  config: TransportConfig,
  endpoints?: string[],
): string {
  const live = endpoints?.find((endpoint) => endpoint.length > 0);
  if (live) return live;
  if (config.type === 'mqtt-client') {
    try {
      const url = new URL(config.url);
      return `${url.protocol}//${url.host}`;
    } catch {
      return config.url;
    }
  }
  if (config.type === 'mqtt-broker') {
    const scheme = config.certFile && config.keyFile ? 'mqtts' : 'mqtt';
    return `${scheme}://${formatHostPort(config.host, config.port)}`;
  }
  if (config.type === 'tcp-server' && config.port === 0) {
    return `${formatHost(config.host)}:自动分配`;
  }
  return formatHostPort(config.host, config.port);
}

export function isLoopbackHost(host: string): boolean {
  const value = host
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '');
  if (value === 'localhost' || value === '::1') return true;

  const octets = value.split('.');
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255)
  );
}

export function transportStatusLabel(status: TransportStatus): string {
  switch (status.state) {
    case 'idle':
      return '未启动';
    case 'listening':
      return '监听中';
    case 'connecting':
      return '连接中';
    case 'connected':
      return '已连接';
    case 'reconnecting':
      return '重连中';
    case 'disconnected':
      return '已断开';
    case 'error':
      return '连接错误';
  }
}

export function transportStatusTone(
  status: TransportStatus,
): 'ok' | 'warn' | 'danger' | 'muted' {
  switch (status.state) {
    case 'listening':
    case 'connected':
      return 'ok';
    case 'connecting':
    case 'reconnecting':
    case 'disconnected':
      return 'warn';
    case 'error':
      return 'danger';
    case 'idle':
      return 'muted';
  }
}

export function transportStatusDetail(
  status: TransportStatus,
  now: number,
): string {
  switch (status.state) {
    case 'reconnecting': {
      const parts: string[] = [];
      if (status.attempt !== undefined) parts.push(`第 ${status.attempt} 次`);
      if (status.nextRetryAt !== undefined) {
        const seconds = Math.max(
          0,
          Math.ceil((status.nextRetryAt - now) / 1000),
        );
        parts.push(seconds > 0 ? `约 ${seconds}s 后重试` : '正在重试');
      }
      return parts.join(' · ') || '自动重连中';
    }
    case 'disconnected':
      return '等待重启';
    case 'error':
      return status.error ?? '连接失败';
    default:
      return '';
  }
}
