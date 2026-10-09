export class GameLifetime {
  private cleanups = new Set<() => void>();
  private stopped = false;

  get disposed() { return this.stopped; }

  own(cleanup: () => void): () => void {
    if (this.stopped) cleanup();
    else this.cleanups.add(cleanup);
    return () => { this.cleanups.delete(cleanup); };
  }

  listen<Type extends keyof WindowEventMap>(target: Window, type: Type, listener: (event: WindowEventMap[Type]) => void, options?: boolean | AddEventListenerOptions): void;
  listen<Type extends keyof HTMLElementEventMap>(target: HTMLElement, type: Type, listener: (event: HTMLElementEventMap[Type]) => void, options?: boolean | AddEventListenerOptions): void;
  listen(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
  listen(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) {
    if (this.stopped) return;
    target.addEventListener(type, listener, options);
    this.own(() => target.removeEventListener(type, listener, options));
  }

  frame(callback: FrameRequestCallback): number {
    if (this.stopped) return 0;
    let release: () => void = () => {};
    const handle = requestAnimationFrame(now => { release(); if (!this.stopped) callback(now); });
    release = this.own(() => cancelAnimationFrame(handle));
    return handle;
  }

  timeout(callback: () => void, delay: number): number {
    if (this.stopped) return 0;
    let release: () => void = () => {};
    const handle = window.setTimeout(() => { release(); if (!this.stopped) callback(); }, delay);
    release = this.own(() => window.clearTimeout(handle));
    return handle;
  }

  interval(callback: () => void, delay: number): number {
    if (this.stopped) return 0;
    const handle = window.setInterval(() => { if (!this.stopped) callback(); }, delay);
    this.own(() => window.clearInterval(handle));
    return handle;
  }

  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    for (const cleanup of [...this.cleanups].reverse()) cleanup();
    this.cleanups.clear();
  }
}
