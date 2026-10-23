import type { RecordedTrafficEvent } from '../types';

export function playbackDelay(
  current: RecordedTrafficEvent | undefined,
  next: RecordedTrafficEvent | undefined,
  speed: number,
): number {
  if (!current || !next || !Number.isFinite(speed) || speed <= 0) return 0;
  return Math.min(30_000, Math.max(0, next.offsetMs - current.offsetMs) / speed);
}

export function pageOffsetFor(index: number, pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('分页长度必须为正整数');
  return Math.floor(Math.max(0, index) / pageSize) * pageSize;
}
