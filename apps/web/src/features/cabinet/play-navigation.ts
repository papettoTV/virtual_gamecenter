import { createUuid } from "../../shared/id";
import { navigate } from "../../shared/navigation";

export function gamePlayUrl(gameId: string, cabinetId = createUuid()) {
  return `/cabinets/${encodeURIComponent(cabinetId)}?game=${encodeURIComponent(gameId)}&start=1`;
}

export function startNewGame(gameId: string) {
  navigate(gamePlayUrl(gameId));
}
