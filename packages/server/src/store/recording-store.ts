import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  createReadStream,
} from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type {
  RecordedTrafficEvent,
  RecordingSession,
  TrafficEvent,
} from '@deviceforge/core';
import type { RecordingApplication } from '../application/contracts';

interface ActiveRecording {
  session: RecordingSession;
  directory: string;
  startedMono: number;
}

function keyOf(deviceId: string, recordingId: string): string {
  return `${deviceId}\u0000${recordingId}`;
}

function parseRecordedEvent(line: string): RecordedTrafficEvent | undefined {
  try {
    const value = JSON.parse(line) as Partial<RecordedTrafficEvent>;
    if (
      typeof value.offsetMs !== 'number' ||
      !Number.isFinite(value.offsetMs) ||
      !value.event ||
      typeof value.event !== 'object'
    ) return undefined;
    return value as RecordedTrafficEvent;
  } catch {
    return undefined;
  }
}

async function countRecordedEvents(filePath: string): Promise<number> {
  if (!existsSync(filePath)) return 0;
  let count = 0;
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (parseRecordedEvent(line)) count += 1;
  }
  return count;
}

export class RecordingStore implements RecordingApplication {
  private readonly sessions = new Map<string, RecordingSession>();
  private readonly activeByDevice = new Map<string, ActiveRecording>();
  private readonly listeners = new Set<(deviceId: string) => void>();

  constructor(private readonly rootDir: string) {}

  async initialize(): Promise<void> {
    if (!existsSync(this.rootDir)) return;
    for (const deviceEntry of readdirSync(this.rootDir, { withFileTypes: true })) {
      if (!deviceEntry.isDirectory()) continue;
      const deviceDir = path.join(this.rootDir, deviceEntry.name);
      for (const recordingEntry of readdirSync(deviceDir, { withFileTypes: true })) {
        if (!recordingEntry.isDirectory()) continue;
        const directory = path.join(deviceDir, recordingEntry.name);
        const metadataPath = path.join(directory, 'session.json');
        try {
          const session = JSON.parse(readFileSync(metadataPath, 'utf8')) as RecordingSession;
          if (
            session.deviceId !== deviceEntry.name ||
            session.id !== recordingEntry.name ||
            !['recording', 'stopped', 'interrupted', 'error'].includes(session.state)
          ) continue;
          if (session.state === 'recording') {
            session.state = 'interrupted';
            session.endedAt = Date.now();
            session.eventCount = await countRecordedEvents(path.join(directory, 'events.jsonl'));
            try {
              this.writeSession(directory, session);
            } catch (error) {
              console.warn(`[recordings] 无法更新中断会话 ${metadataPath}`, error);
            }
          }
          this.sessions.set(keyOf(session.deviceId, session.id), session);
        } catch (error) {
          console.warn(`[recordings] 跳过无法读取的录制会话 ${metadataPath}`, error);
        }
      }
    }
  }

  onChange(listener: (deviceId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(deviceId: string): RecordingSession[] {
    return [...this.sessions.values()]
      .filter((session) => session.deviceId === deviceId)
      .sort((left, right) => right.startedAt - left.startedAt)
      .map((session) => ({ ...session }));
  }

  start(deviceId: string): RecordingSession {
    if (this.activeByDevice.has(deviceId)) {
      throw new Error(`设备 ${deviceId} 已有正在进行的录制`);
    }
    const id = randomUUID();
    const directory = path.join(this.rootDir, deviceId, id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'events.jsonl'), '', 'utf8');
    const session: RecordingSession = {
      id,
      deviceId,
      startedAt: Date.now(),
      state: 'recording',
      eventCount: 0,
    };
    this.writeSession(directory, session);
    this.sessions.set(keyOf(deviceId, id), session);
    this.activeByDevice.set(deviceId, {
      session,
      directory,
      startedMono: performance.now(),
    });
    this.emit(deviceId);
    return { ...session };
  }

  stop(deviceId: string, recordingId: string): RecordingSession | undefined {
    const active = this.activeByDevice.get(deviceId);
    if (!active || active.session.id !== recordingId) return undefined;
    active.session.state = 'stopped';
    active.session.endedAt = Date.now();
    this.activeByDevice.delete(deviceId);
    try {
      this.writeSession(active.directory, active.session);
    } catch (error) {
      active.session.state = 'error';
      active.session.error = error instanceof Error ? error.message : String(error);
      try {
        this.writeSession(active.directory, active.session);
      } catch (writeError) {
        console.error('[recordings] 无法保存停止录制时的错误状态', writeError);
      }
      this.emit(deviceId);
      throw error;
    }
    this.emit(deviceId);
    return { ...active.session };
  }

  append(event: TrafficEvent): void {
    const active = this.activeByDevice.get(event.deviceId);
    if (!active) return;
    const envelope: RecordedTrafficEvent = {
      offsetMs: Math.max(0, performance.now() - active.startedMono),
      event,
    };
    try {
      appendFileSync(
        path.join(active.directory, 'events.jsonl'),
        `${JSON.stringify(envelope)}\n`,
        'utf8',
      );
      active.session.eventCount += 1;
    } catch (error) {
      active.session.state = 'error';
      active.session.endedAt = Date.now();
      active.session.error = error instanceof Error ? error.message : String(error);
      try {
        this.writeSession(active.directory, active.session);
      } catch (writeError) {
        console.error('[recordings] 无法保存录制错误状态', writeError);
      }
      this.activeByDevice.delete(event.deviceId);
      this.emit(event.deviceId);
    }
  }

  async readEvents(
    deviceId: string,
    recordingId: string,
    offset: number,
    limit: number,
  ): Promise<{ events: RecordedTrafficEvent[]; total: number } | undefined> {
    const session = this.sessions.get(keyOf(deviceId, recordingId));
    if (!session) return undefined;
    const filePath = path.join(this.directoryOf(session), 'events.jsonl');
    if (!existsSync(filePath)) return { events: [], total: 0 };

    const events: RecordedTrafficEvent[] = [];
    let total = 0;
    const input = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      const recorded = parseRecordedEvent(line);
      if (!recorded) continue;
      if (total >= offset && events.length < limit) events.push(recorded);
      total += 1;
    }
    return { events, total };
  }

  delete(deviceId: string, recordingId: string): boolean {
    const session = this.sessions.get(keyOf(deviceId, recordingId));
    if (!session) return false;
    if (this.activeByDevice.get(deviceId)?.session.id === recordingId) {
      throw new Error('请先停止录制再删除会话');
    }
    rmSync(this.directoryOf(session), { recursive: true, force: true });
    this.sessions.delete(keyOf(deviceId, recordingId));
    this.emit(deviceId);
    return true;
  }

  private directoryOf(session: RecordingSession): string {
    return path.join(this.rootDir, session.deviceId, session.id);
  }

  private writeSession(directory: string, session: RecordingSession): void {
    const filePath = path.join(directory, 'session.json');
    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(session, null, 2), 'utf8');
    renameSync(tempPath, filePath);
  }

  private emit(deviceId: string): void {
    for (const listener of this.listeners) listener(deviceId);
  }
}
