import type { SharedResult, SharedResultDraft } from "../../domain/shared-result";
import { fetchPlatformBootstrap } from "../platform/platform-client";
import { openResultShare } from "./share-service";

export class ResultSharingStore {
  private draft: SharedResultDraft | null = null;
  private saved: SharedResult | null = null;
  private pending: Promise<SharedResult> | null = null;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.draft;
  getPublishedSnapshot = () => this.saved;
  setResult(draft: SharedResultDraft | null) {
    if (draft?.id === this.draft?.id) return;
    this.draft = draft ? { ...draft, metrics: { ...draft.metrics } } : null;
    this.saved = null;
    this.pending = null;
    this.listeners.forEach(listener => listener());
  }
  clear(gameId: string) {
    if (this.draft?.gameId === gameId) this.setResult(null);
  }
  usePublished(result: SharedResult) {
    this.setResult(result);
    this.saved = result;
  }
  patchMetrics(metrics: SharedResultDraft["metrics"]) {
    if (!this.draft || this.saved || this.pending) return;
    this.draft = { ...this.draft, metrics: { ...this.draft.metrics, ...metrics } };
    this.listeners.forEach(listener => listener());
  }
  async ensureSaved(): Promise<SharedResult> {
    if (this.saved) return this.saved;
    if (this.pending) return this.pending;
    const draft = this.draft;
    if (!draft) throw new Error("result_unavailable");
    const pending = (async () => {
      await fetchPlatformBootstrap();
      const response = await fetch("/api/results", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      if (!response.ok) throw new Error("result_save_failed");
      const { result } = await response.json() as { result: SharedResult };
      if (this.draft?.id === draft.id) this.saved = result;
      return result;
    })();
    this.pending = pending;
    try { return await pending; }
    finally { if (this.pending === pending) this.pending = null; }
  }
  async share(viewer = false) {
    const draft = this.draft;
    if (draft) await openResultShare(draft, () => this.ensureSaved(), viewer);
  }
}

export const resultSharing = new ResultSharingStore();
