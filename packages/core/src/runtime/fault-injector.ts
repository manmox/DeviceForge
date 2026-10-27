import type {
  FaultAction,
  FaultInjectionConfig,
  FaultRule,
} from '../schema/device';

export type FaultDirection = 'in' | 'out';

export interface AppliedFault {
  connectionId: string;
  direction: FaultDirection;
  index: number;
  rule: FaultRule;
  action: FaultAction['type'];
  inputBytes: number;
  outputBytes: number;
}

export interface FaultInjectorOptions {
  onFault(event: AppliedFault): void;
  disconnect(connectionId: string): Promise<void>;
  random?: () => number;
}

interface Waiter {
  endOffset: number;
  resolve(): void;
  reject(error: unknown): void;
}

interface TcpStream {
  connectionId: string;
  direction: FaultDirection;
  buffer: Buffer;
  addedBytes: number;
  processedBytes: number;
  index: number;
  closed: boolean;
  timer?: ReturnType<typeof setTimeout>;
  chain: Promise<void>;
  waiters: Waiter[];
  deliver?: (data: Buffer) => Promise<void>;
}

export interface FaultResult {
  data?: Buffer;
  applied?: AppliedFault;
}

const IDLE_FLUSH_MS = 5;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 运行时故障注入。TCP/串口按固定长度分段，有边界传输按单条消息处理。
 * 每条连接的入站、出站计数彼此独立。
 */
export class FaultInjector {
  private config: FaultInjectionConfig;
  private enabled = false;
  private readonly streams = new Map<string, TcpStream>();
  private readonly messageIndexes = new Map<string, number>();
  private readonly messageChains = new Map<string, Promise<void>>();
  private readonly messageGenerations = new Map<string, symbol>();
  private generation = 0;
  private readonly random: () => number;

  constructor(
    config: FaultInjectionConfig,
    private readonly options: FaultInjectorOptions,
  ) {
    this.config = config;
    this.random = options.random ?? Math.random;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get rules(): FaultRule[] {
    return this.config.rules;
  }

  setConfig(config: FaultInjectionConfig): void {
    this.config = config;
  }

  openConnection(connectionId: string): void {
    this.messageGenerations.set(connectionId, Symbol(connectionId));
    for (const key of this.messageIndexes.keys()) {
      if (key.startsWith(`${connectionId}\u0000`)) this.messageIndexes.delete(key);
    }
    for (const key of this.messageChains.keys()) {
      if (key.startsWith(`${connectionId}\u0000`)) this.messageChains.delete(key);
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    if (enabled) {
      if (!wasEnabled) {
        this.messageIndexes.clear();
        for (const stream of this.streams.values()) stream.index = 0;
      }
      return;
    }

    const pending: Promise<void>[] = [];
    for (const stream of this.streams.values()) {
      if (stream.timer) clearTimeout(stream.timer);
      stream.timer = undefined;
      this.enqueueBuffered(stream, true, stream.deliver);
      pending.push(stream.chain);
    }
    await Promise.all(pending);
  }

  async pushTcp(
    connectionId: string,
    direction: FaultDirection,
    data: Buffer,
    deliver: (data: Buffer) => Promise<void>,
  ): Promise<void> {
    if (data.length === 0) return;

    if (!this.enabled || this.config.rules.length === 0) {
      const key = `${connectionId}\u0000${direction}`;
      const stream = this.streams.get(key);
      if (!stream || stream.closed) {
        await deliver(data);
        return;
      }

      stream.deliver = deliver;
      if (stream.timer) clearTimeout(stream.timer);
      stream.timer = undefined;
      this.enqueueBuffered(stream, true, deliver);

      stream.addedBytes += data.length;
      const endOffset = stream.addedBytes;
      const completed = new Promise<void>((resolve, reject) => {
        stream.waiters.push({ endOffset, resolve, reject });
      });
      this.enqueueSegment(stream, Buffer.from(data), deliver, true);
      await completed;
      return;
    }

    const stream = this.getStream(connectionId, direction);
    if (stream.closed) return;
    stream.deliver = deliver;

    stream.buffer = Buffer.concat([stream.buffer, data]);
    stream.addedBytes += data.length;
    const endOffset = stream.addedBytes;
    const completed = new Promise<void>((resolve, reject) => {
      stream.waiters.push({ endOffset, resolve, reject });
    });

    const segmentSize = this.config.segmentSizeBytes;
    while (stream.buffer.length >= segmentSize) {
      const segment = stream.buffer.subarray(0, segmentSize);
      stream.buffer = stream.buffer.subarray(segmentSize);
      this.enqueueSegment(stream, Buffer.from(segment), deliver, false);
    }

    if (stream.timer) clearTimeout(stream.timer);
    if (stream.buffer.length > 0) {
      stream.timer = setTimeout(() => {
        stream.timer = undefined;
        this.enqueueBuffered(stream, false, deliver);
      }, IDLE_FLUSH_MS);
    }

    await completed;
  }

  async processMessage(
    connectionId: string,
    direction: FaultDirection,
    data: Buffer,
  ): Promise<FaultResult> {
    const key = `${connectionId}\u0000${direction}`;
    let generation = this.messageGenerations.get(connectionId);
    // Broker 广播没有客户端连接 ID，空 ID 表示 Broker 级消息序列。
    if (!generation && connectionId === '') {
      generation = Symbol('broadcast');
      this.messageGenerations.set(connectionId, generation);
    }
    if (!generation) return {};
    const epoch = this.generation;
    const active = this.enabled && this.config.rules.length > 0;
    const previous = this.messageChains.get(key);
    if (!active && !previous) return { data };

    let resolveResult!: (result: FaultResult) => void;
    let rejectResult!: (error: unknown) => void;
    const resultPromise = new Promise<FaultResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const next = (previous ?? Promise.resolve())
      .then(async () => {
        if (
          epoch !== this.generation ||
          generation !== this.messageGenerations.get(connectionId)
        ) {
          resolveResult({});
          return;
        }
        if (!active) {
          resolveResult({ data });
          return;
        }
        const index = (this.messageIndexes.get(key) ?? 0) + 1;
        this.messageIndexes.set(key, index);
        const result = await this.apply(connectionId, direction, index, data);
        if (
          epoch !== this.generation ||
          generation !== this.messageGenerations.get(connectionId)
        ) {
          resolveResult({});
          return;
        }
        resolveResult(result);
      })
      .catch((error: unknown) => {
        rejectResult(error);
      });
    this.messageChains.set(key, next);
    void next.finally(() => {
      if (this.messageChains.get(key) === next) this.messageChains.delete(key);
    });
    return resultPromise;
  }

  /** 保留旧接口名称，兼容现有调用方与测试。 */
  processMqtt(
    connectionId: string,
    direction: FaultDirection,
    data: Buffer,
  ): Promise<FaultResult> {
    return this.processMessage(connectionId, direction, data);
  }

  closeConnection(connectionId: string): void {
    this.messageGenerations.delete(connectionId);
    for (const [key, stream] of this.streams) {
      if (stream.connectionId !== connectionId) continue;
      stream.closed = true;
      if (stream.timer) clearTimeout(stream.timer);
      stream.timer = undefined;
      stream.buffer = Buffer.alloc(0);
      stream.processedBytes = stream.addedBytes;
      this.resolveWaiters(stream);
      this.streams.delete(key);
    }
    for (const key of this.messageIndexes.keys()) {
      if (key.startsWith(`${connectionId}\u0000`)) this.messageIndexes.delete(key);
    }
    for (const key of this.messageChains.keys()) {
      if (key.startsWith(`${connectionId}\u0000`)) this.messageChains.delete(key);
    }
  }

  closeAll(): void {
    this.generation += 1;
    for (const stream of this.streams.values()) {
      stream.closed = true;
      if (stream.timer) clearTimeout(stream.timer);
      stream.timer = undefined;
      stream.buffer = Buffer.alloc(0);
      stream.processedBytes = stream.addedBytes;
      this.resolveWaiters(stream);
    }
    this.streams.clear();
    this.messageIndexes.clear();
    this.messageChains.clear();
    this.messageGenerations.clear();
  }

  private getStream(connectionId: string, direction: FaultDirection): TcpStream {
    const key = `${connectionId}\u0000${direction}`;
    let stream = this.streams.get(key);
    if (!stream) {
      stream = {
        connectionId,
        direction,
        buffer: Buffer.alloc(0),
        addedBytes: 0,
        processedBytes: 0,
        index: 0,
        closed: false,
        chain: Promise.resolve(),
        waiters: [],
      };
      this.streams.set(key, stream);
    }
    return stream;
  }

  private enqueueBuffered(
    stream: TcpStream,
    bypass: boolean,
    deliver?: (data: Buffer) => Promise<void>,
  ): void {
    if (stream.buffer.length === 0 || stream.closed) return;
    const segment = stream.buffer;
    stream.buffer = Buffer.alloc(0);
    this.enqueueSegment(
      stream,
      Buffer.from(segment),
      deliver ?? (async () => undefined),
      bypass,
    );
  }

  private enqueueSegment(
    stream: TcpStream,
    segment: Buffer,
    deliver: (data: Buffer) => Promise<void>,
    bypass: boolean,
  ): void {
    stream.chain = stream.chain
      .then(async () => {
        if (stream.closed) return;
        stream.index += 1;
        const result = bypass
          ? { data: segment }
          : await this.apply(
              stream.connectionId,
              stream.direction,
              stream.index,
              segment,
            );
        if (stream.closed) return;

        if (result.applied) {
          this.options.onFault(result.applied);
        }

        if (result.applied?.action === 'disconnect') {
          stream.closed = true;
          await this.options.disconnect(stream.connectionId);
          stream.buffer = Buffer.alloc(0);
          stream.processedBytes = stream.addedBytes;
          this.resolveWaiters(stream);
          return;
        }
        if (result.data) await deliver(result.data);
      })
      .then(() => {
        if (!stream.closed) stream.processedBytes += segment.length;
        this.resolveWaiters(stream);
      })
      .catch((error: unknown) => {
        this.rejectWaiters(stream, error);
      });
  }

  private async apply(
    connectionId: string,
    direction: FaultDirection,
    index: number,
    input: Buffer,
  ): Promise<FaultResult> {
    if (!this.enabled) return { data: input };
    const rule = this.config.rules.find(
      (candidate) =>
        candidate.enabled &&
        (candidate.direction === 'both' || candidate.direction === direction) &&
        this.matches(candidate, index),
    );
    if (!rule) return { data: input };

    const action = rule.action;
    let output: Buffer | undefined = input;
    if (action.type === 'delay') {
      await wait(action.delayMs);
    } else if (action.type === 'drop' || action.type === 'disconnect') {
      output = undefined;
    } else if (input.length > 0) {
      output = Buffer.from(input);
      const byteIndex = Math.floor(this.random() * output.length);
      const bitIndex = Math.floor(this.random() * 8);
      output[byteIndex] = output[byteIndex]! ^ (1 << bitIndex);
    }

    return {
      data: output,
      applied: {
        connectionId,
        direction,
        index,
        rule,
        action: action.type,
        inputBytes: input.length,
        outputBytes: output?.length ?? 0,
      },
    };
  }

  private matches(rule: FaultRule, index: number): boolean {
    const trigger = rule.trigger;
    if (trigger.type === 'probability') {
      return this.random() * 100 < trigger.percent;
    }
    if (trigger.mode === 'indices') return trigger.indices.includes(index);
    return index % trigger.interval === 0;
  }

  private resolveWaiters(stream: TcpStream): void {
    const remaining: Waiter[] = [];
    for (const waiter of stream.waiters) {
      if (stream.processedBytes >= waiter.endOffset || stream.closed) waiter.resolve();
      else remaining.push(waiter);
    }
    stream.waiters = remaining;
  }

  private rejectWaiters(stream: TcpStream, error: unknown): void {
    for (const waiter of stream.waiters) waiter.reject(error);
    stream.waiters = [];
  }
}
