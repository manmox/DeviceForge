import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProtocolSession,
  type ProtocolSendContext,
} from '../runtime/protocol-session';
import type { TransportStatus } from '../types';

interface SentFrame {
  connectionId: string;
  data: Buffer;
  context: ProtocolSendContext;
}

interface Notice {
  level: 'info' | 'warning' | 'error';
  message: string;
  connectionId?: string;
}

function setup(mode: 'tcp-client' | 'tcp-server' = 'tcp-client') {
  const sent: SentFrame[] = [];
  const notices: Notice[] = [];
  const session = new ProtocolSession({
    mode,
    send: async (connectionId, data, context) => {
      sent.push({ connectionId, data, context });
    },
    notify: (level, message, connectionId) => {
      notices.push({ level, message, ...(connectionId ? { connectionId } : {}) });
    },
  });
  return { session, sent, notices };
}

const track = { key: '3', timeoutMs: 1_000, maxRetries: 2 };
const frame = Buffer.from('frame-3');

describe('ProtocolSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears pending when the ACK is OK and never retries', async () => {
    const { session, sent } = setup();
    const handle = session.register('c1', track, frame);
    session.arm(handle);
    expect(session.pendingCount).toBe(1);

    session.acknowledge('c1', '3', true);
    expect(session.pendingCount).toBe(0);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(0);
  });

  it('retries at most maxRetries times and then reports an error', async () => {
    const { session, sent, notices } = setup();
    const handle = session.register('c1', track, frame);
    session.arm(handle);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      connectionId: 'c1',
      context: { sequence: '3', attempt: 1, maxRetries: 2, reason: 'retry' },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.context.attempt).toBe(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toHaveLength(2);
    expect(session.pendingCount).toBe(0);
    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'error', message: expect.stringContaining('重试 2 次') }),
      ]),
    );
  });

  it('keeps pending on a non-OK ACK and continues retrying', async () => {
    const { session, sent, notices } = setup();
    const handle = session.register('c1', track, frame);
    session.arm(handle);

    session.acknowledge('c1', '3', false);
    expect(session.pendingCount).toBe(1);
    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'warning', message: expect.stringContaining('状态非 OK') }),
      ]),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toHaveLength(1);
  });

  it('reports an unknown ACK as info only', () => {
    const { session, notices } = setup();
    session.acknowledge('c1', '99', true);
    expect(notices).toEqual([
      expect.objectContaining({ level: 'info', message: expect.stringContaining('未跟踪') }),
    ]);
  });

  it('pauses on client disconnect and resumes after connect rules', async () => {
    const { session, sent } = setup('tcp-client');
    const handle = session.register('old', track, frame);
    session.arm(handle);

    session.onConnectionClosed('old');
    session.onTransportStatus({
      kind: 'tcp-client',
      state: 'reconnecting',
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(0);
    expect(session.pendingCount).toBe(1);

    session.onConnectionReady('new');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      connectionId: 'new',
      context: { sequence: '3', attempt: 1, reason: 'reconnect' },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent[1]).toMatchObject({
      connectionId: 'new',
      context: { attempt: 2, reason: 'retry' },
    });

    session.acknowledge('new', '3', true);
    expect(session.pendingCount).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(2);
  });

  it('does not resend entries created during connect rules', async () => {
    const { session, sent } = setup('tcp-client');
    const paused = session.register('old', { ...track, key: '1' }, Buffer.from('old'));
    session.arm(paused);
    session.onConnectionClosed('old');

    const fresh = session.register('new', { ...track, key: '2' }, Buffer.from('new'));
    session.arm(fresh);

    session.onConnectionReady('new');
    await vi.advanceTimersByTimeAsync(0);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.context.sequence).toBe('1');

    // 新条目只被 arm 了一次，不应在重连恢复时被额外发送。
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(1);

    session.acknowledge('new', '1', true);
    session.acknowledge('new', '2', true);
    expect(session.pendingCount).toBe(0);
  });

  it('drops pending for a closed server connection', async () => {
    const { session, sent, notices } = setup('tcp-server');
    const handle = session.register('client-1', track, frame);
    session.arm(handle);

    session.onConnectionClosed('client-1');
    expect(session.pendingCount).toBe(0);
    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'warning', message: expect.stringContaining('丢弃 1 条') }),
      ]),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(0);
  });

  it('clears pending on manual disconnect, transport error and stop', async () => {
    for (const status of [
      { kind: 'tcp-client', state: 'disconnected' },
      { kind: 'tcp-client', state: 'error' },
    ] as TransportStatus[]) {
      const { session, sent } = setup('tcp-client');
      session.arm(session.register('c1', track, frame));
      session.onTransportStatus(status);
      expect(session.pendingCount).toBe(0);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(sent).toHaveLength(0);
    }

    const { session, sent } = setup('tcp-client');
    session.arm(session.register('c1', track, frame));
    session.stop();
    expect(session.pendingCount).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(0);
  });
});
