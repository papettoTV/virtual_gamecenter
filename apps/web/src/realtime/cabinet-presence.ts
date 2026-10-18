export const CABINET_PRESENCE_EVENT = "pulbase-cabinet-presence";

export interface CabinetPresence {
  cabinetId: string;
  gameId: string;
  playerCount: number;
}

export function publishCabinetPresence(presence: CabinetPresence) {
  if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent<CabinetPresence>(CABINET_PRESENCE_EVENT, { detail: presence }));
  }
}
