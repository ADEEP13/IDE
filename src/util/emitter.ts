type Handler<V> = (value: V) => void;

/** Tiny typed event emitter. */
export class Emitter<E extends object> {
  private handlers: { [K in keyof E]?: Set<Handler<E[K]>> } = {};
  on<K extends keyof E>(event: K, fn: Handler<E[K]>): () => void {
    (this.handlers[event] ??= new Set()).add(fn);
    return () => { this.handlers[event]?.delete(fn); };
  }
  emit<K extends keyof E>(event: K, value: E[K]): void {
    this.handlers[event]?.forEach((fn) => {
      try { fn(value); } catch (e) { console.error(e); }
    });
  }
}
