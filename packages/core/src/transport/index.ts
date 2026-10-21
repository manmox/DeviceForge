import type { TransportConfig } from '../schema/device';
import { TcpServerTransportAdapter } from './tcp-server';
import type { TransportAdapter } from './types';

export function createTransport(config: TransportConfig): TransportAdapter {
  switch (config.type) {
    case 'tcp-server':
      return new TcpServerTransportAdapter(config);
  }
}
