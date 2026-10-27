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
  { value: 'udp-server', label: 'UDP Server · 数据报监听', description: '监听 UDP 端口；按来源地址和端口区分发送方。' },
  { value: 'udp-client', label: 'UDP Client · 数据报目标', description: '向一个 UDP 目标发送和接收完整数据报。' },
  { value: 'serial', label: 'Serial · 物理串口', description: '使用本机串口设备，首轮支持 Linux 与 macOS。' },
  { value: 'virtual-serial', label: 'Virtual Serial · 虚拟串口', description: '用 socat 创建 PTY 对，供模拟器和串口工具互通。' },
  { value: 'http-server', label: 'HTTP Server · 请求响应', description: '按 HTTP 请求规则返回状态码、响应头和响应体。' },
  { value: 'websocket-server', label: 'WebSocket Server · 消息服务', description: '接收多个客户端的文本或二进制消息。' },
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
  'udp-server': {
    kindLabel: 'UDP Server', modeLabel: '数据报监听', endpointLabel: '监听地址', endpointShortLabel: '监听',
    peerLabel: '发送方', connectionTitle: 'UDP 来源端点', connectionStatLabel: '发送方', connectionUnit: '个来源端点',
    sendTargetLabel: '→ 最近来源端点', waitingLabel: '等待 UDP 数据报', pausedLabel: 'UDP Server 已停止',
    emptyConnectionText: (endpoint) => `向 ${endpoint} 发送数据报后，来源地址和端口会显示在这里。`,
    trafficEmptyHint: '启动设备并向监听端口发送数据报，收发消息会出现在这里。',
    copyEndpointTitle: '复制 UDP 监听地址', disconnectHint: '移除该来源端点；下次收到数据报时会重新出现。', isOutbound: false,
  },
  'udp-client': {
    kindLabel: 'UDP Client', modeLabel: '单一目标', endpointLabel: '目标地址', endpointShortLabel: '目标',
    peerLabel: '目标端点', connectionTitle: 'UDP 目标端点', connectionStatLabel: '目标', connectionUnit: '个目标端点',
    sendTargetLabel: '→ UDP 目标', waitingLabel: '等待 UDP Socket', pausedLabel: 'UDP Client 已断开',
    emptyConnectionText: (endpoint) => `设备启动后使用本地 UDP Socket 与 ${endpoint} 收发数据报。`,
    trafficEmptyHint: '启动设备后，向配置的 UDP 目标收发数据报。',
    copyEndpointTitle: '复制 UDP 目标地址', disconnectHint: '关闭本地 UDP Socket；重启设备后恢复。', isOutbound: true,
  },
  'serial': {
    kindLabel: 'Serial', modeLabel: '物理串口', endpointLabel: '串口路径', endpointShortLabel: '串口',
    peerLabel: '串口设备', connectionTitle: '串口连接', connectionStatLabel: '串口', connectionUnit: '个串口',
    sendTargetLabel: '→ 串口', waitingLabel: '等待串口打开', pausedLabel: '串口已关闭',
    emptyConnectionText: (endpoint) => `启动设备后打开 ${endpoint}，串口收发字节会显示在这里。`,
    trafficEmptyHint: '串口数据按字节流分帧，收发报文会出现在这里。',
    copyEndpointTitle: '复制串口路径', disconnectHint: '关闭串口；重启设备后重新打开。', isOutbound: false,
  },
  'virtual-serial': {
    kindLabel: 'Virtual Serial', modeLabel: '虚拟串口', endpointLabel: 'PTY 端点', endpointShortLabel: 'PTY',
    peerLabel: '串口端点', connectionTitle: '虚拟串口对', connectionStatLabel: 'PTY', connectionUnit: '个 PTY 对',
    sendTargetLabel: '→ 虚拟串口', waitingLabel: '等待 socat 创建 PTY', pausedLabel: '虚拟串口已关闭',
    emptyConnectionText: () => '启动设备后会显示应用端和外部工具端的 PTY 路径。',
    trafficEmptyHint: '将串口工具连接到外部 PTY 路径，字节流会进入设备规则。',
    copyEndpointTitle: '复制 PTY 路径', disconnectHint: '关闭 socat 和 PTY；重启设备后重新创建。', isOutbound: false,
  },
  'http-server': {
    kindLabel: 'HTTP Server', modeLabel: 'HTTP 请求响应', endpointLabel: '监听地址', endpointShortLabel: 'HTTP',
    peerLabel: '客户端', connectionTitle: 'HTTP 客户端连接', connectionStatLabel: '客户端', connectionUnit: '个连接',
    sendTargetLabel: '按请求规则响应', waitingLabel: '等待 HTTP 请求', pausedLabel: 'HTTP Server 已停止',
    emptyConnectionText: (endpoint) => `向 ${endpoint} 发送请求，命中规则后由设备返回响应。`,
    trafficEmptyHint: '请求方法、路径、查询参数、请求头和请求体会进入帧规则。',
    copyEndpointTitle: '复制 HTTP 地址', disconnectHint: '关闭该客户端连接。', isOutbound: false,
  },
  'websocket-server': {
    kindLabel: 'WebSocket Server', modeLabel: 'WebSocket 消息服务', endpointLabel: '监听地址', endpointShortLabel: 'WS',
    peerLabel: '客户端', connectionTitle: 'WebSocket 客户端', connectionStatLabel: '客户端', connectionUnit: '个客户端',
    sendTargetLabel: '→ 最近客户端', waitingLabel: '等待 WebSocket 客户端', pausedLabel: 'WebSocket Server 已停止',
    emptyConnectionText: (endpoint) => `让客户端连接 ${endpoint}，每条文本或二进制消息都会触发帧规则。`,
    trafficEmptyHint: 'WebSocket 消息边界作为帧边界，规则响应会发回同一客户端。',
    copyEndpointTitle: '复制 WebSocket 地址', disconnectHint: '关闭该 WebSocket 客户端。', isOutbound: false,
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
  switch (config.type) {
    case 'mqtt-client':
      try {
        const url = new URL(config.url);
        return `${url.protocol}//${url.host}`;
      } catch {
        return config.url;
      }
    case 'mqtt-broker': {
      const scheme = config.certFile && config.keyFile ? 'mqtts' : 'mqtt';
      return `${scheme}://${formatHostPort(config.host, config.port)}`;
    }
    case 'serial': return config.portPath;
    case 'virtual-serial': return '启动后由 socat 分配';
    case 'websocket-server': return `ws://${formatHostPort(config.host, config.port)}${config.path}`;
    case 'http-server': return `http://${formatHostPort(config.host, config.port)}`;
    case 'tcp-server':
    case 'udp-server':
      return config.port === 0 ? `${formatHost(config.host)}:自动分配` : formatHostPort(config.host, config.port);
    case 'tcp-client':
    case 'udp-client':
      return formatHostPort(config.host, config.port);
  }
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
