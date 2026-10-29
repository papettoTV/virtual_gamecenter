import { createUuid } from "../../shared/id";
import { getGameDefinition } from "../../domain/game";
import type { SharedResult, SharedResultDraft } from "../../domain/shared-result";
import { presentResult } from "./result-presenters";
import { shareTags } from "./share-tags";
import { recordSharingEvent } from "./sharing-events";

export interface LiveShareContext {
  gameId: string;
  cabinetId: string;
  role: "player" | "spectator";
  phase: "ready" | "playing" | "paused" | "finished";
}

export interface SharePanelState {
  kind: "live" | "result";
  gameId: string;
  targetId: string;
  shareId: string;
  title: string;
  text: string;
  url: string;
  status: "loading" | "ready" | "error";
  result?: SharedResult;
  retry?: () => void;
}

let panel: SharePanelState | null = null;
let liveContext: LiveShareContext | null = null;
const panelListeners = new Set<() => void>();
const liveListeners = new Set<() => void>();
export const sharePanel = {
  subscribe: (listener: () => void) => { panelListeners.add(listener); return () => panelListeners.delete(listener); },
  getSnapshot: () => panel,
  close: () => { panel = null; panelListeners.forEach(listener => listener()); },
};
export const liveSharing = {
  subscribe: (listener: () => void) => { liveListeners.add(listener); return () => liveListeners.delete(listener); },
  getSnapshot: () => liveContext,
};

export function setLiveContext(context: LiveShareContext | null) {
  if (JSON.stringify(context) === JSON.stringify(liveContext)) return;
  liveContext = context;
  liveListeners.forEach(listener => listener());
}

function updatePanel(state: SharePanelState) {
  panel = state;
  panelListeners.forEach(listener => listener());
}

export function liveShareText(context: LiveShareContext): string {
  const title = getGameDefinition(context.gameId)?.localizedTitle ?? context.gameId;
  const tags = shareTags(context.gameId);
  if (context.phase === "finished") return `${title}のプレイは終了しました。この筐体の状況はこちら。\n${tags}`;
  if (context.role === "spectator") return `${title}のライブを観戦中。一緒に見ませんか？\n${tags}`;
  if (context.phase === "ready") return `これから${title}に挑戦！ここから観戦できます。\n${tags}`;
  if (context.phase === "paused") return `${title}に挑戦中。ただいま休憩中です。続きの観戦はこちら。\n${tags}`;
  return `${title}に挑戦中！ライブ観戦はこちら。\n${tags}`;
}

export async function getShareOrigin(): Promise<string> {
  if (!["localhost", "127.0.0.1"].includes(location.hostname)) return location.origin;
  try {
    const response = await fetch("/api/local-address");
    if (response.ok) {
      const address = await response.json() as { address: string; port: number };
      return `http://${address.address}:${address.port}`;
    }
  } catch {}
  return location.origin;
}

export async function shareLive(context: LiveShareContext) {
  const shareId = createUuid();
  const state: SharePanelState = { kind: "live", gameId: context.gameId, targetId: context.cabinetId, shareId, title: "観戦に招待", text: liveShareText(context), url: "", status: "loading" };
  updatePanel(state);
  recordSharingEvent("share_opened", state);
  window.dispatchEvent(new CustomEvent("before-live-share", { detail: context }));
  const origin = await getShareOrigin();
  if (panel !== state) return;
  const url = new URL(`/cabinets/${encodeURIComponent(context.cabinetId)}`, origin);
  url.searchParams.set("game", context.gameId);
  url.searchParams.set("watch", "1");
  url.searchParams.set("ref", "share");
  url.searchParams.set("shareId", shareId);
  updatePanel({ ...state, url: url.toString(), status: "ready" });
}

export function resultShareText(result: SharedResult, viewer = false): string {
  const presentation = presentResult(result);
  return viewer ? `${result.playerName}さんの${presentation.title}のプレイ結果。${presentation.headline} / ${presentation.details.join(" / ")}\n${shareTags(result.gameId)}` : presentation.text;
}

export async function openResultShare(draft: SharedResultDraft, save: () => Promise<SharedResult>, viewer = false) {
  const presentation = presentResult(draft);
  const state: SharePanelState = { kind: "result", gameId: draft.gameId, targetId: draft.id, shareId: createUuid(), title: "結果を共有", text: presentation.text, url: "", status: "loading" };
  updatePanel(state);
  recordSharingEvent("share_opened", state);
  try {
    const [result, origin] = await Promise.all([save(), getShareOrigin()]);
    if (panel !== state) return;
    const url = new URL(`/results/${result.id}`, origin);
    url.searchParams.set("ref", "share");
    url.searchParams.set("shareId", state.shareId);
    updatePanel({ ...state, text: resultShareText(result, viewer), url: url.toString(), result, status: "ready" });
  } catch {
    if (panel === state) updatePanel({ ...state, status: "error", retry: () => void openResultShare(draft, save, viewer) });
  }
}
