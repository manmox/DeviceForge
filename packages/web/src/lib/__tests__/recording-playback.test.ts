import { describe, expect, it } from 'vitest';
import { pageOffsetFor, playbackDelay } from '../recording-playback';
import type { RecordedTrafficEvent } from '../../types';

function recorded(offsetMs: number): RecordedTrafficEvent {
  return {
    offsetMs,
    event: {
      id: `event-${offsetMs}`,
      deviceId: 'sensor-1',
      ts: offsetMs,
      direction: 'system',
      data: '',
      size: 0,
    },
  };
}

describe('录制回放时间轴', () => {
  it('按事件间隔和倍速计算播放等待时间', () => {
    expect(playbackDelay(recorded(100), recorded(500), 2)).toBe(200);
    expect(playbackDelay(recorded(500), recorded(100), 1)).toBe(0);
    expect(playbackDelay(undefined, recorded(100), 1)).toBe(0);
  });

  it('限制单次等待上限并计算时间轴分页位置', () => {
    expect(playbackDelay(recorded(0), recorded(60_000), 0.5)).toBe(30_000);
    expect(pageOffsetFor(0, 200)).toBe(0);
    expect(pageOffsetFor(200, 200)).toBe(200);
    expect(pageOffsetFor(459, 200)).toBe(400);
  });
});
