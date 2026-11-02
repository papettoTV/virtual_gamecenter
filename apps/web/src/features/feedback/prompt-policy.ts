import type { LiveShareContext } from "../sharing/share-service";

export interface FeedbackContext { gameId: string | null; activity: "player" | "spectator" | "site" }
export interface PromptHistory { lastDay?: string; submittedAt?: number; playPrompted?: boolean }
export const FEEDBACK_HISTORY_KEY = "pulbase.feedback.v1";
export const FEEDBACK_RETURN_KEY = "pulbase.feedback-return.v1";
export function takeReturn(storage: Pick<Storage, "getItem" | "removeItem">, now: number): FeedbackContext | null {
  try {
    const raw = storage.getItem(FEEDBACK_RETURN_KEY);
    storage.removeItem(FEEDBACK_RETURN_KEY);
    if (!raw || raw.length > 1024) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || typeof value.gameId !== "string"
      || !["player", "spectator"].includes(value.activity) || !Number.isFinite(value.at)
      || now - value.at < 0 || now - value.at > 300000) return null;
    return { gameId: value.gameId, activity: value.activity };
  } catch { return null; }
}
export function japanDay(now: number) { return new Date(now + 9 * 3600000).toISOString().slice(0, 10); }
export function canPrompt(history: PromptHistory, now: number, activity: FeedbackContext["activity"]) {
  return history.lastDay !== japanDay(now)
    && !(history.submittedAt !== undefined && now - history.submittedAt < 7 * 86400000)
    && !(activity === "player" && history.playPrompted);
}
export function readHistory(storage: Pick<Storage, "getItem">): PromptHistory | null {
  try {
    const raw = storage.getItem(FEEDBACK_HISTORY_KEY);
    if (!raw) return {};
    if (raw.length > 1024) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)
      || (value.lastDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value.lastDay))
      || (value.submittedAt !== undefined && (!Number.isFinite(value.submittedAt) || value.submittedAt < 0))
      || (value.playPrompted !== undefined && typeof value.playPrompted !== "boolean")) return null;
    return value;
  } catch { return null; }
}

export class FeedbackVisit {
  private visit: { context: FeedbackContext; watched: number; finished: boolean; manual: boolean } | null = null;
  private activeSince: number | null = null;
  private cabinet = false;
  current: FeedbackContext = { gameId: null, activity: "site" };

  live(context: LiveShareContext | null, now: number, visible: boolean) {
    this.flush(now);
    if (!context) return;
    if (!this.visit || this.visit.context.gameId !== context.gameId || this.visit.context.activity !== context.role) {
      this.visit = { context: { gameId: context.gameId, activity: context.role }, watched: 0, finished: false, manual: false };
    }
    this.current = this.visit.context;
    this.visit.finished ||= context.role === "player" && context.phase === "finished";
    if (visible && context.role === "spectator" && context.phase === "playing") this.activeSince = now;
  }

  openedManually() {
    if (this.visit) this.visit.manual = true;
  }

  route(address: string, now: number): FeedbackContext | null {
    const url = new URL(address, "https://local.invalid");
    const cabinet = /^\/cabinets\/[^/]+$/.test(url.pathname);
    const returned = this.cabinet && url.pathname === "/" && !url.searchParams.has("game");
    this.cabinet = cabinet;
    const visit = this.visit;
    if (cabinet) return null;
    this.flush(now);
    this.visit = null;
    if (returned && visit && !visit.manual && (visit.finished || visit.watched >= 60000)) return visit.context;
    return null;
  }

  leaving(now: number): FeedbackContext | null {
    this.flush(now);
    return this.cabinet && this.visit && !this.visit.manual && (this.visit.finished || this.visit.watched >= 60000) ? this.visit.context : null;
  }

  private flush(now: number) {
    if (this.visit && this.activeSince !== null) this.visit.watched += Math.max(0, now - this.activeSince);
    this.activeSince = null;
  }
}
