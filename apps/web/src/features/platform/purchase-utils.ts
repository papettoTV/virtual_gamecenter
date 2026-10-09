import type { PendingPlayAction, PurchaseUnit } from "./platform-types";

export function getPurchaseCurrency(): "jpy" | "usd" {
  return navigator.language.toLowerCase().startsWith("ja") ? "jpy" : "usd";
}

export function formatPurchasePrice(unit: PurchaseUnit): string {
  return getPurchaseCurrency() === "jpy" ? `${unit * 100}円` : `$${unit}`;
}

export function storePendingPlayAction(action: PendingPlayAction | null) {
  if (!action) return;
  window.sessionStorage.setItem("vgc_pending_play_action", action);
}

export function restoreStoredPlayAction(
  setAction: (action: PendingPlayAction | null) => void,
): boolean {
  const stored = window.sessionStorage.getItem("vgc_pending_play_action");
  if (!stored) return false;
  const action = stored === "start" || stored === "start-solo"
    ? "start"
    : stored === "retry" || stored === "ranking-retry" || stored === "restartKey"
      ? "retry"
      : null;
  if (!action) return false;
  setAction(action);
  return true;
}

export function cleanPurchaseParams(url: URL) {
  url.searchParams.delete("purchase");
  url.searchParams.delete("session_id");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}
