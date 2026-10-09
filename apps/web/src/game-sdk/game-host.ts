import type { GameInstance, PlayAction } from "./contracts";

export class GameHost {
  private instance: GameInstance | null = null;
  private listeners = new Set<(action: PlayAction) => void>();

  attach(instance: GameInstance) {
    this.instance = instance;
    return () => { if (this.instance === instance) this.instance = null; };
  }

  subscribe(listener: (action: PlayAction) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  requestPlay(action: PlayAction) {
    if (!this.instance) return;
    for (const listener of this.listeners) listener(action);
  }

  async play(action: PlayAction): Promise<boolean> {
    const instance = this.instance;
    if (!instance) return false;
    const started = await instance.play(action);
    return this.instance === instance && started;
  }

  async selectSolo() {
    const instance = this.instance;
    if (!instance) return;
    await instance.prepareSolo?.();
    if (this.instance === instance) this.requestPlay("start");
  }
}

export const gameHost = new GameHost();
