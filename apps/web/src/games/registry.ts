import { BUZZ_BARRIER, DEEP_SEA_SALVAGE, type GameId } from "../domain/game";

type GameRuntimeLoader = () => Promise<unknown>;

const runtimeLoaders: Record<GameId, GameRuntimeLoader> = {
  [BUZZ_BARRIER.id]: () => import("./graze-duel/runtime"),
  [DEEP_SEA_SALVAGE.id]: () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("modelCatalog") === "1") return import("./deep-sea-salvage/model-catalog-preview");
    if (params.get("threePreview") === "1") return import("./deep-sea-salvage/three-preview");
    return import("./deep-sea-salvage/runtime");
  },
};

const loadedRuntimes = new Map<GameId, Promise<unknown>>();

export function loadGameRuntime(gameId: GameId): Promise<unknown> {
  const existing = loadedRuntimes.get(gameId);
  if (existing) return existing;

  const loader = runtimeLoaders[gameId];
  if (!loader) return Promise.reject(new Error(`game_runtime_not_registered:${gameId}`));

  const loading = loader();
  loadedRuntimes.set(gameId, loading);
  return loading;
}
