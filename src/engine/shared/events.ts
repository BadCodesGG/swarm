/**
 * The one seam between an act's simulation, scene, HUD and audio. Each act declares its own event
 * map; modules publish what happened and subscribe to what they care about, and none import each other.
 */

export type Handler<T> = (payload: T) => void;

export class EventBus<M extends { [K in keyof M]: unknown }> {
  private handlers = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(type: K, handler: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const s = set as Set<Handler<M[K]>>;
    s.add(handler);
    return () => s.delete(handler);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type) as Set<Handler<M[K]>> | undefined;
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
