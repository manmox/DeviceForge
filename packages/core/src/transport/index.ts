import type { TransportConfig } from '../schema/device';
import { TcpClientTransportAdapter } from './tcp-client';
import { TcpServerTransportAdapter } from './tcp-server';
import type { TransportAdapter } from './types';

export function createTransport(config: TransportConfig): TransportAdapter {
  switch (config.type) {
    case 'tcp-server':
      return new TcpServerTransportAdapter(config);
    case 'tcp-client':
      return new TcpClientTransportAdapter(config);
  }
}
