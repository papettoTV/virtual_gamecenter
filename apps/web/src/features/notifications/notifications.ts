export interface Notice {
  id: string;
  type: "success" | "info" | "error";
  message: string;
  scope?: string;
  action?: { label: string; run: () => void | Promise<void> };
}

export class NotificationStore {
  private items: Notice[] = [];
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Set<string>();
  private scopeVersions = new Map<string, number>();

  captureScope(scope?: string) {
    const version = scope ? this.scopeVersions.get(scope) : undefined;
    return () => !scope || this.scopeVersions.get(scope) === version;
  }

  getSnapshot = () => this.items;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  show(notice: Notice) {
    this.stopTimer(notice.id);
    const index = this.items.findIndex(item => item.id === notice.id);
    this.items = index < 0 ? [...this.items, notice] : this.items.map(item => item.id === notice.id ? notice : item);
    this.changed();
  }

  dismiss(id: string) {
    this.stopTimer(id);
    this.items = this.items.filter(item => item.id !== id);
    this.changed();
  }

  clearScope(scope: string) {
    this.scopeVersions.set(scope, (this.scopeVersions.get(scope) ?? 0) + 1);
    for (const item of this.items.filter(item => item.scope === scope)) this.dismiss(item.id);
  }

  async runAction(notice: Notice) {
    if (!notice.action || this.pending.has(notice.id) || !this.items.includes(notice)) return;
    this.pending.add(notice.id);
    try {
      await notice.action.run();
      if (this.items.includes(notice)) this.dismiss(notice.id);
    } catch {
      if (this.items.includes(notice)) this.show({ ...notice, type: "error", message: "処理に失敗しました。もう一度お試しください。" });
    } finally {
      this.pending.delete(notice.id);
    }
  }

  private stopTimer(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  private changed() {
    for (const item of this.items.slice(0, 3)) {
      if (item.type !== "error" && !this.timers.has(item.id)) {
        this.timers.set(item.id, setTimeout(() => this.dismiss(item.id), 5000));
      }
    }
    for (const listener of this.listeners) listener();
  }
}

export const notifications = new NotificationStore();
