const WATCH_ATTRIBUTION_KEY = "vgc_watch_attribution";
const WATCH_EVENT_PREFIX = "vgc_watch_recorded:";
const ATTRIBUTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface WatchAttribution {
  gameId: string;
  cabinetId: string;
  shareId: string | null;
  watchedAt: number;
}

type EngagementEventType = "watch_started" | "share_created" | "play_started_from_watch";

export function createTrackedWatchUrl(url: string): { shareId: string; url: string } {
  const trackedUrl = new URL(url, window.location.origin);
  const shareId = crypto.randomUUID();
  trackedUrl.searchParams.set("watch", "1");
  trackedUrl.searchParams.set("ref", "share");
  trackedUrl.searchParams.set("shareId", shareId);
  return { shareId, url: trackedUrl.toString() };
}

export function recordWatchStarted(gameId: string, cabinetId: string): void {
  const storageKey = `${WATCH_EVENT_PREFIX}${cabinetId}`;
  const shareId = new URL(window.location.href).searchParams.get("shareId");
  const attribution: WatchAttribution = {
    gameId,
    cabinetId,
    shareId,
    watchedAt: Date.now(),
  };
  sessionStorage.setItem(WATCH_ATTRIBUTION_KEY, JSON.stringify(attribution));
  if (sessionStorage.getItem(storageKey)) return;
  sessionStorage.setItem(storageKey, "1");
  void postEngagementEvent("watch_started", gameId, cabinetId, shareId);
}

export function recordShareCreated(gameId: string, cabinetId: string, shareId: string): void {
  void postEngagementEvent("share_created", gameId, cabinetId, shareId);
}

export function recordPlayStartedFromWatch(gameId: string, cabinetId: string): void {
  const rawAttribution = sessionStorage.getItem(WATCH_ATTRIBUTION_KEY);
  if (!rawAttribution) return;
  sessionStorage.removeItem(WATCH_ATTRIBUTION_KEY);
  try {
    const attribution = JSON.parse(rawAttribution) as WatchAttribution;
    if (
      attribution.gameId !== gameId
      || Date.now() - attribution.watchedAt > ATTRIBUTION_MAX_AGE_MS
    ) return;
    void postEngagementEvent(
      "play_started_from_watch",
      gameId,
      cabinetId,
      attribution.shareId,
      attribution.cabinetId,
    );
  } catch {}
}

async function postEngagementEvent(
  eventType: EngagementEventType,
  gameId: string,
  cabinetId: string,
  shareId: string | null,
  sourceCabinetId?: string,
): Promise<void> {
  try {
    await fetch("/api/platform/engagement/events", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        eventType,
        gameId,
        cabinetId,
        shareId,
        sourceCabinetId,
      }),
    });
  } catch {}
}
