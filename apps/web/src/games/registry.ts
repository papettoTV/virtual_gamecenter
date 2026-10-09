import type { ComponentType } from "react";
import type { CanvasGameModule } from "../game-sdk/contracts";
import { BUZZ_BARRIER, DEEP_SEA_SALVAGE, DOT_WAVE, type GameId } from "../domain/game";

export type GameRegistration =
  | { kind: "canvas"; load: () => Promise<CanvasGameModule> }
  | { kind: "react"; load: () => Promise<{ Component: ComponentType }> };

const registrations: Record<GameId, GameRegistration> = {
  [BUZZ_BARRIER.id]: { kind: "canvas", load: () => import("./graze-duel/runtime") },
  [DOT_WAVE.id]: { kind: "react", load: () => import("./dot-wave/entry") },
  [DEEP_SEA_SALVAGE.id]: { kind: "canvas", load: () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("modelCatalog") === "1") return import("./deep-sea-salvage/model-catalog-preview");
    if (params.get("threePreview") === "1") return import("./deep-sea-salvage/three-preview");
    return import("./deep-sea-salvage/runtime");
  } },
};

export function getGameRegistration(gameId: GameId): GameRegistration {
  const registration = registrations[gameId];
  if (!registration) throw new Error(`game_runtime_not_registered:${gameId}`);
  return registration;
}
