export type GameId = "graze-duel";
export type GameMode = "solo" | "versus" | "coop";
export type PlaySessionStatus = "waitingStart" | "playing" | "finished" | "cancelled";

export interface GameDefinition {
  id: GameId;
  title: string;
  currentVersion: string;
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

export const GRAZE_DUEL: GameDefinition = {
  id: "graze-duel",
  title: "Graze Duel",
  currentVersion: "prototype-boss-rush-1",
};
