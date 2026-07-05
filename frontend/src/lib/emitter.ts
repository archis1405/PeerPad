export type Listener<T> = (payload: T) => void;

// A minimal typed pub/sub. Both SignalingClient and WebRTCManager need to
// notify React components of connection events (peer joined, message
// received, ...) without dragging in a state-management library for what
// is currently a handful of event types.
export class Emitter<Events extends Record<string, unknown>> {
  private readonly listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = this.listeners[event] ?? new Set();
    set.add(listener);
    this.listeners[event] = set;
    return () => set.delete(listener);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners[event]?.forEach((listener) => listener(payload));
  }
}
