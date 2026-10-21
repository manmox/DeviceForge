import type { TrafficEvent } from '../types';

export class TrafficBuffer {
  private readonly items: (TrafficEvent | undefined)[];
  private start = 0;
  private count = 0;

  constructor(private readonly capacity = 5000) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('traffic buffer capacity must be a positive integer');
    }
    this.items = new Array<TrafficEvent | undefined>(capacity);
  }

  push(event: TrafficEvent): void {
    if (this.count < this.capacity) {
      this.items[(this.start + this.count) % this.capacity] = event;
      this.count += 1;
      return;
    }
    this.items[this.start] = event;
    this.start = (this.start + 1) % this.capacity;
  }

  list(limit?: number): TrafficEvent[] {
    const wanted =
      limit === undefined ? this.count : Math.max(0, Math.min(Math.trunc(limit), this.count));
    const result: TrafficEvent[] = [];
    for (let index = this.count - wanted; index < this.count; index += 1) {
      const item = this.items[(this.start + index) % this.capacity];
      if (item) result.push(item);
    }
    return result;
  }

  clear(): void {
    this.items.fill(undefined);
    this.start = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}
