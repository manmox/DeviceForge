import type { TransportConfig } from '../schema/device';
import { MqttBrokerTransportAdapter } from './mqtt-broker';
import { MqttClientTransportAdapter } from './mqtt-client';
import { TcpClientTransportAdapter } from './tcp-client';
import { TcpServerTransportAdapter } from './tcp-server';
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
    case 'mqtt-client':
      return new MqttClientTransportAdapter(config, deviceId);
    case 'mqtt-broker':
      return new MqttBrokerTransportAdapter(config);
  }
}
