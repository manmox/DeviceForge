import type { FramingConfig } from '../schema/device';

export interface FrameDecoder {
  push(chunk: Buffer): Buffer[];
  reset(): void;
  readonly pendingBytes: number;
}

export class FramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FramingError';
  }
}

const MAX_BUFFER = 16 * 1024 * 1024;

class RawFramer implements FrameDecoder {
  private pending = 0;

  push(chunk: Buffer): Buffer[] {
    this.pending = 0;
    return chunk.length > 0 ? [chunk] : [];
  }

  reset(): void {
    this.pending = 0;
  }

  get pendingBytes(): number {
    return this.pending;
  }
}

class DelimiterFramer implements FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly delimiter: Buffer;
  private readonly includeDelimiter: boolean;

  constructor(delimiterHex: string, includeDelimiter: boolean) {
    this.delimiter = Buffer.from(delimiterHex, 'hex');
    this.includeDelimiter = includeDelimiter;
    if (this.delimiter.length === 0) throw new FramingError('分隔符不能为空');
  }

  push(chunk: Buffer): Buffer[] {
    if (chunk.length > 0) {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    }

    const frames: Buffer[] = [];
    let index = this.buffer.indexOf(this.delimiter);
    while (index !== -1) {
      const end = index + this.delimiter.length;
      const frame = this.buffer.subarray(0, this.includeDelimiter ? end : index);
      this.buffer = this.buffer.subarray(end);
      if (frame.length > 0) frames.push(Buffer.from(frame));
      index = this.buffer.indexOf(this.delimiter);
    }

    if (this.buffer.length > MAX_BUFFER) {
      this.reset();
      throw new FramingError(`分隔符分帧缓冲区超过 ${MAX_BUFFER} 字节，已丢弃未完成数据`);
    }

    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  get pendingBytes(): number {
    return this.buffer.length;
  }
}

class FixedFramer implements FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly frameLength: number) {}

  push(chunk: Buffer): Buffer[] {
    if (chunk.length > 0) {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    }

    const frames: Buffer[] = [];
    while (this.buffer.length >= this.frameLength) {
      frames.push(Buffer.from(this.buffer.subarray(0, this.frameLength)));
      this.buffer = this.buffer.subarray(this.frameLength);
    }
    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  get pendingBytes(): number {
    return this.buffer.length;
  }
}

class LengthPrefixFramer implements FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly offset: number;
  private readonly size: 1 | 2 | 4;
  private readonly endian: 'be' | 'le';
  private readonly adjust: number;
  private readonly maxFrameLength: number;

  constructor(config: Extract<FramingConfig, { type: 'length-prefix' }>) {
    this.offset = config.lengthField.offset;
    this.size = config.lengthField.size;
    this.endian = config.lengthField.endian;
    this.adjust = config.lengthField.adjust;
    this.maxFrameLength = config.maxFrameLength;
  }

  private readLength(): number {
    if (this.size === 1) return this.buffer.readUInt8(this.offset);
    if (this.size === 2) {
      return this.endian === 'be'
        ? this.buffer.readUInt16BE(this.offset)
        : this.buffer.readUInt16LE(this.offset);
    }
    return this.endian === 'be'
      ? this.buffer.readUInt32BE(this.offset)
      : this.buffer.readUInt32LE(this.offset);
  }

  push(chunk: Buffer): Buffer[] {
    if (chunk.length > 0) {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    }

    const headerLength = this.offset + this.size;
    const frames: Buffer[] = [];

    while (this.buffer.length >= headerLength) {
      const total = this.readLength() + this.adjust;
      if (total < headerLength) {
        this.reset();
        throw new FramingError(`长度字段解析为 ${total}，小于头部长度 ${headerLength}`);
      }
      if (total > this.maxFrameLength) {
        this.reset();
        throw new FramingError(`帧长度 ${total} 超过上限 ${this.maxFrameLength}`);
      }
      if (this.buffer.length < total) break;

      frames.push(Buffer.from(this.buffer.subarray(0, total)));
      this.buffer = this.buffer.subarray(total);
    }

    if (this.buffer.length > this.maxFrameLength + headerLength + 4096) {
      this.reset();
      throw new FramingError('未完成的帧超过缓冲区上限，已丢弃并重新同步');
    }

    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  get pendingBytes(): number {
    return this.buffer.length;
  }
}

export function createFramer(config: FramingConfig): FrameDecoder {
  switch (config.type) {
    case 'raw':
      return new RawFramer();
    case 'delimiter':
      return new DelimiterFramer(config.delimiter, config.includeDelimiter);
    case 'fixed':
      return new FixedFramer(config.length);
    case 'length-prefix':
      return new LengthPrefixFramer(config);
  }
}
