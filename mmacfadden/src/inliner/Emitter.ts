export class Emitter<T extends { type: string }> extends EventTarget {
  emit(payload: T) { this.dispatchEvent(new CustomEvent(payload.type, { detail: payload })); }
  on<K extends T["type"]>(type: K, fn: (ev: Extract<T, { type: K }>) => void) {
    const handler = (e: Event) => fn((e as CustomEvent).detail);
    this.addEventListener(type as string, handler as EventListener);
    return () => this.removeEventListener(type as string, handler as EventListener);
  }
}