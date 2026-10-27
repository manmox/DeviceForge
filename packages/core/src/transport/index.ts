import type { TransportConfig } from '../schema/device';
import { MqttBrokerTransportAdapter } from './mqtt-broker';
import { MqttClientTransportAdapter } from './mqtt-client';
import { TcpClientTransportAdapter } from './tcp-client';
import { TcpServerTransportAdapter } from './tcp-server';
import { UdpClientTransportAdapter, UdpServerTransportAdapter } from './udp';
import { SerialTransportAdapter } from './serial';
import { HttpServerTransportAdapter } from './http-server';
import { WebSocketServerTransportAdapter } from './websocket-server';
import type { TransportAdapter } from './types';

export function createTransport(
  config: TransportConfig,
  deviceId = '',
): TransportAdapter {
  switch (config.type) {
    case 'tcp-server':
      return new TcpServerTransportAdapter(config);
    case 'tcp-client':
      return new TcpClientTransportAdapter(config);
    case 'udp-server':
      return new UdpServerTransportAdapter(config);
    case 'udp-client':
      return new UdpClientTransportAdapter(config);
    case 'serial':
    case 'virtual-serial':
      return new SerialTransportAdapter(config);
    case 'http-server':
      return new HttpServerTransportAdapter(config);
    case 'websocket-server':
      return new WebSocketServerTransportAdapter(config);
    case 'mqtt-client':
      return new MqttClientTransportAdapter(config, deviceId);
    case 'mqtt-broker':
      return new MqttBrokerTransportAdapter(config);
  }
}
