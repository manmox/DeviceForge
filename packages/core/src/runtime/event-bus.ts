export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(event: unknown) => void>>();

  on<K extends keyof Events>(type: K, listener: (event: Events[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const wrapped = listener as (event: unknown) => void;
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
    };
  }

  emit<K extends keyof Events>(type: K, event: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[EventBus] listener for "${String(type)}" failed`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
