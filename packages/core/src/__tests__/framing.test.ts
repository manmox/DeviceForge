import { describe, expect, it } from 'vitest';
import { createFramer, FramingError } from '../framing';

const lengthPrefixConfig = {
  type: 'length-prefix',
  lengthField: { offset: 2, size: 2, endian: 'be', adjust: 0 },
  maxFrameLength: 1024,
} as const;

describe('length-prefix framer', () => {
  const frame = Buffer.from('aa55000c03010000fa3c0000', 'hex');

  it('waits for fragmented frames and emits once complete', () => {
    const framer = createFramer(lengthPrefixConfig);
    expect(framer.push(frame.subarray(0, 3))).toEqual([]);
    expect(framer.push(frame.subarray(3, 7))).toEqual([]);
    expect(framer.pendingBytes).toBe(7);

    const frames = framer.push(frame.subarray(7));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.toString('hex')).toBe(frame.toString('hex'));
    expect(framer.pendingBytes).toBe(0);
  });

  it('splits multiple frames in one chunk', () => {
    const framer = createFramer(lengthPrefixConfig);
    const frames = framer.push(Buffer.concat([frame, frame]));
    expect(frames).toHaveLength(2);
    expect(frames[0]!.toString('hex')).toBe(frame.toString('hex'));
    expect(frames[1]!.toString('hex')).toBe(frame.toString('hex'));
  });

  it('rejects frames larger than the configured maximum', () => {
    const framer = createFramer({
      type: 'length-prefix',
      lengthField: { offset: 2, size: 2, endian: 'be', adjust: 0 },
      maxFrameLength: 8,
    });
    expect(() => framer.push(frame)).toThrow(FramingError);
  });
});

describe('delimiter framer', () => {
  it('splits on a hex delimiter and optionally keeps it', () => {
    const framer = createFramer({
      type: 'delimiter',
      delimiter: '0d0a',
      includeDelimiter: false,
    });
    const frames = framer.push(Buffer.from('hello\r\nworld\r\n', 'utf8'));
    expect(frames.map((item) => item.toString('utf8'))).toEqual(['hello', 'world']);

    const keeping = createFramer({
      type: 'delimiter',
      delimiter: '0d0a',
      includeDelimiter: true,
    });
    const kept = keeping.push(Buffer.from('hi\r\n', 'utf8'));
    expect(kept[0]!.toString('hex')).toBe('68690d0a');
  });
});

describe('fixed framer', () => {
  it('emits fixed-size chunks', () => {
    const framer = createFramer({ type: 'fixed', length: 4 });
    const frames = framer.push(Buffer.from('abcdefghij', 'utf8'));
    expect(frames.map((item) => item.toString('utf8'))).toEqual(['abcd', 'efgh']);
    expect(framer.pendingBytes).toBe(2);
  });
});

describe('raw framer', () => {
  it('treats each chunk as one frame', () => {
    const framer = createFramer({ type: 'raw' });
    const frames = framer.push(Buffer.from('abc', 'utf8'));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.toString('utf8')).toBe('abc');
  });
});
