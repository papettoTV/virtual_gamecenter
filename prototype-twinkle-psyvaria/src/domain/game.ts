export type GameId = string;
export type GameMode = "solo" | "versus" | "coop";
export type PlaySessionStatus = "waitingStart" | "playing" | "finished" | "cancelled";

export interface GameDefinition {
  id: GameId;
  slug: string;
  title: string;
  localizedTitle: string;
  shortTitle: string;
  description: string;
  currentVersion: string;
  creditCost: number;
  iconUrl: string;
  promoVideoUrl: string;
  promoPosterUrl: string;
  status: "active" | "comingSoon";
}

export interface PlaySession {
  id: string;
  cabinetSessionId: string;
  gameId: GameId;
  gameVersion: string;
  mode: GameMode;
  status: PlaySessionStatus;
  startedAt: number | null;
  endedAt: number | null;
}

export const BUZZ_BARRIER: GameDefinition = {
  id: "graze-duel",
  slug: "buzz-barrier",
  title: "BUZZ BARRIER",
  localizedTitle: "バズバリア",
  shortTitle: "BB",
  description: "弾幕かすり・無敵体当たり・ボス撃破型シューティング",
  currentVersion: "prototype-score-ranking-1",
  creditCost: 1,
  iconUrl: "/assets/buzz-barrier-icon.png",
  promoVideoUrl: "/graze-duel-promo.mp4?v=20260801-actual",
  promoPosterUrl: "/graze-duel-promo-poster.jpg?v=20260801-actual",
  status: "active",
};

export const DEEP_SEA_SALVAGE: GameDefinition = {
  id: "deep-sea-salvage",
  slug: "deep-sea-salvage",
  title: "DEEP SEA SALVAGE",
  localizedTitle: "深海サルベージ",
  shortTitle: "DSS",
  description: "危険生物を観測し、海底遺跡の財宝を回収して帰還する深海探索ゲーム",
  currentVersion: "prototype-expedition-1",
  creditCost: 1,
  iconUrl: "/assets/deep-sea-salvage-icon.svg",
  promoVideoUrl: "",
  promoPosterUrl: "/assets/deep-sea-salvage-icon.svg",
  status: "active",
};

export const GAME_CATALOG: readonly GameDefinition[] = [BUZZ_BARRIER, DEEP_SEA_SALVAGE];
export const DEFAULT_GAME_ID: GameId = BUZZ_BARRIER.id;

export function getGameDefinition(gameId: string | null | undefined): GameDefinition | null {
  if (!gameId) return null;
  return GAME_CATALOG.find((game) => game.id === gameId || game.slug === gameId) ?? null;
}

export function getActiveGames(): readonly GameDefinition[] {
  return GAME_CATALOG.filter((game) => game.status === "active");
}

export function resolveGameDefinition(gameId: string | null | undefined): GameDefinition {
  return getGameDefinition(gameId) ?? BUZZ_BARRIER;
}
