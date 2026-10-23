import type { TransportStatus } from '@deviceforge/core';
import { describe, expect, it } from 'vitest';
import {
  formatHostPort,
  isLoopbackHost,
  transportEndpoint,
  transportPresentation,
  transportStatusDetail,
  transportStatusLabel,
  transportStatusTone,
} from '../transport-presentation';

const client = {
  type: 'tcp-client' as const,
  host: '127.0.0.1',
  port: 9000,
  connectTimeoutMs: 5_000,
  reconnect: { enabled: true, minDelayMs: 500, maxDelayMs: 10_000 },
};

function status(
  state: TransportStatus['state'],
  patch: Partial<TransportStatus> = {},
): TransportStatus {
  return { kind: 'tcp-client', state, ...patch };
}

describe('transportPresentation', () => {
  it('uses listener and outbound wording for each transport', () => {
    const server = transportPresentation('tcp-server');
    expect(server.kindLabel).toBe('TCP Server');
    expect(server.endpointLabel).toBe('监听地址');
    expect(server.peerLabel).toBe('客户端');
    expect(server.connectionTitle).toBe('客户端连接');
    expect(server.sendTargetLabel).toBe('→ 最新连接');
    expect(server.isOutbound).toBe(false);

    const outbound = transportPresentation('tcp-client');
    expect(outbound.kindLabel).toBe('TCP Client');
    expect(outbound.endpointLabel).toBe('目标地址');
    expect(outbound.peerLabel).toBe('上游服务器');
    expect(outbound.connectionTitle).toBe('上游连接');
    expect(outbound.sendTargetLabel).toBe('→ 上游连接');
    expect(outbound.isOutbound).toBe(true);
  });

  it('builds endpoint text for server, client and IPv6', () => {
    expect(
      transportEndpoint({ type: 'tcp-server', host: '127.0.0.1', port: 0 }),
    ).toBe('127.0.0.1:自动分配');
    expect(
      transportEndpoint(
        { type: 'tcp-server', host: '127.0.0.1', port: 19001 },
        ['127.0.0.1:19002'],
      ),
    ).toBe('127.0.0.1:19002');
    expect(transportEndpoint(client)).toBe('127.0.0.1:9000');
    expect(
      transportEndpoint({
        type: 'mqtt-client',
        url: 'mqtts://broker.example.com:8883',
        subscriptions: [],
        publishTopic: 'device/up',
        publishQos: 0,
      }),
    ).toBe('mqtts://broker.example.com:8883');
    expect(
      transportEndpoint({
        type: 'mqtt-broker',
        host: '127.0.0.1',
        port: 1883,
        publishTopic: 'device/down',
        publishQos: 1,
      }),
    ).toBe('mqtt://127.0.0.1:1883');
    expect(formatHostPort('::1', 9000)).toBe('[::1]:9000');
    expect(formatHostPort('[::1]', 9000)).toBe('[::1]:9000');
  });

  it('detects loopback targets', () => {
    for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of ['0.0.0.0', '192.168.1.10', 'example.com', '::']) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe('transport status presentation', () => {
  it('labels every state with a matching tone', () => {
    const cases: [
      TransportStatus['state'],
      string,
      ReturnType<typeof transportStatusTone>,
    ][] = [
      ['idle', '未启动', 'muted'],
      ['listening', '监听中', 'ok'],
      ['connecting', '连接中', 'warn'],
      ['connected', '已连接', 'ok'],
      ['reconnecting', '重连中', 'warn'],
      ['disconnected', '已断开', 'warn'],
      ['error', '连接错误', 'danger'],
    ];

    for (const [state, label, tone] of cases) {
      const value = status(state);
      expect(transportStatusLabel(value)).toBe(label);
      expect(transportStatusTone(value)).toBe(tone);
    }
  });

  it('shows attempts and a countdown while reconnecting', () => {
    const now = 1_000_000;
    expect(
      transportStatusDetail(
        status('reconnecting', {
          attempt: 2,
          nextRetryAt: now + 2_400,
        }),
        now,
      ),
    ).toBe('第 2 次 · 约 3s 后重试');
    expect(
      transportStatusDetail(
        status('reconnecting', {
          attempt: 1,
          nextRetryAt: now - 1,
        }),
        now,
      ),
    ).toBe('第 1 次 · 正在重试');
    expect(transportStatusDetail(status('disconnected'), now)).toBe('等待重启');
    expect(
      transportStatusDetail(status('error', { error: '连接超时' }), now),
    ).toBe('连接超时');
    expect(transportStatusDetail(status('connected'), now)).toBe('');
  });
});
