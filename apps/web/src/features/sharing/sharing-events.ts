import { createUuid } from "../../shared/id";

type SharingEvent = "share_opened" | "share_link_copied" | "share_target_opened" | "share_native_handoff" | "share_image_saved" | "result_viewed" | "play_started_from_result";
interface SharingSource {
  kind: "live" | "result";
  gameId: string;
  targetId: string;
  shareId: string;
}

export function recordSharingEvent(eventType: SharingEvent, source: SharingSource, channel?: string) {
  void fetch("/api/platform/sharing/events", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId: createUuid(), eventType, ...source, channel }),
  }).catch(() => {});
}

const RESULT_ATTRIBUTION_KEY = "pulbase_result_attribution";
export function recordResultViewed(gameId: string, resultId: string) {
  const shareId = new URL(location.href).searchParams.get("shareId") ?? "";
  const source = { kind: "result" as const, gameId, targetId: resultId, shareId };
  try {
    sessionStorage.setItem(RESULT_ATTRIBUTION_KEY, JSON.stringify({ ...source, timestamp: Date.now() }));
    const viewedKey = `pulbase_result_viewed:${resultId}:${shareId}`;
    if (sessionStorage.getItem(viewedKey)) return;
    sessionStorage.setItem(viewedKey, "1");
  } catch {}
  recordSharingEvent("result_viewed", source);
}

export function recordPlayStartedFromResult(gameId: string) {
  try {
    const raw = sessionStorage.getItem(RESULT_ATTRIBUTION_KEY);
    if (!raw) return;
    const source = JSON.parse(raw) as SharingSource & { timestamp: number };
    if (source.gameId !== gameId || Date.now() - source.timestamp > 24 * 60 * 60 * 1000) return;
    sessionStorage.removeItem(RESULT_ATTRIBUTION_KEY);
    recordSharingEvent("play_started_from_result", source);
  } catch {}
}
