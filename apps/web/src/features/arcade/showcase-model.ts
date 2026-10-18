import type { CabinetEntry } from "./CabinetDirectory";

const playingStatuses = new Set(["soloPlaying", "challengePending", "versusPlaying"]);

export function getShowcaseCabinets(cabinets: CabinetEntry[]) {
  return cabinets.filter(cabinet => playingStatuses.has(cabinet.status))
    .sort((first, second) => second.spectatorCount - first.spectatorCount
      || first.cabinetId.localeCompare(second.cabinetId));
}

export function livePreviewUrl(cabinet: CabinetEntry) {
  return `/cabinets/${encodeURIComponent(cabinet.cabinetId)}?game=${encodeURIComponent(cabinet.gameId)}&watch=1&preview=1`;
}
