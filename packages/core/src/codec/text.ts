import type { OutgoingMessage, TextCodecConfig, TextField } from '../schema/device';
import type {
  Codec,
  CodecOptions,
  DecodeResult,
  EncodeContext,
  InboundObservation,
  PreparedOutbound,
} from './index';
import {
  encodeTextMessage,
  prepareTextMessage,
  type TextSequenceAllocator,
} from './text-encoder';
import { parseTextFrame } from './text-parser';

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value ?? '');
}

/**
 * 通用结构化文本 codec。
 *
 * 所有协议差异都在 TextCodecConfig 中描述；这个类只保留跨报文状态：
 * - 自动流水号计数器；
 * - prepareOutbound 固定时间戳/流水号；
 * - 根据 session 配置返回 ACK 跟踪信息。
 */
export class TextCodec implements Codec {
  private readonly nextSequences = new Map<string, number>();

  constructor(
    private readonly config: TextCodecConfig,
    private readonly options: CodecOptions = {},
  ) {}

  decode(frame: Buffer): DecodeResult {
    return parseTextFrame(frame, this.config, this.options.dictionaries);
  }

  prepareOutbound(
    message: OutgoingMessage,
    ctx: EncodeContext,
  ): PreparedOutbound {
    return prepareTextMessage(
      message,
      this.withDevice(ctx),
      this.config,
      this.sequenceAllocator(),
    );
  }

  encode(message: OutgoingMessage, ctx: EncodeContext): Buffer {
    // 直接调用 encode 时也补齐自动字段；runtime 会先调用 prepareOutbound，
    // 已填好的值不会重复分配。
    const prepared = this.prepareOutbound(message, ctx);
    return encodeTextMessage(
      prepared.message,
      this.withDevice(ctx),
      this.config,
      this.sequenceAllocator(),
      this.options.dictionaries,
    );
  }

  observeInbound(
    fields: Record<string, unknown>,
  ): InboundObservation | undefined {
    const session = this.config.session;
    if (!session || fields._message !== session.ackMessage) return undefined;
    const key = fields[session.sequenceField];
    if (key === undefined || key === null || textOf(key) === '') {
      return undefined;
    }
    return {
      ackKey: textOf(key),
      ackOk: session.successValues.includes(textOf(fields[session.statusField])),
    };
  }

  private withDevice(ctx: EncodeContext): EncodeContext {
    if (ctx.device || !this.options.deviceInfo) return ctx;
    return { ...ctx, device: this.options.deviceInfo };
  }

  private sequenceAllocator(): TextSequenceAllocator {
    return {
      allocate: (field: TextField) => {
        const current = this.nextSequences.get(field.name) ?? field.sequenceStart;
        this.nextSequences.set(field.name, current + 1);
        return current;
      },
      reserve: (field: TextField, value: unknown) => {
        const text = textOf(value);
        if (!/^\d+$/.test(text)) return;
        const numeric = Number(text);
        if (!Number.isSafeInteger(numeric)) return;
        const current = this.nextSequences.get(field.name) ?? field.sequenceStart;
        if (numeric >= current) this.nextSequences.set(field.name, numeric + 1);
      },
    };
  }
}
