export type CabinetStatus =
  | "empty"
  | "occupied"
  | "soloPlaying"
  | "challengePending"
  | "versusReady"
  | "versusPlaying"
  | "result";

export type CabinetRole = "visitor" | "player" | "spectator";

export interface CabinetState {
  cabinetId: string;
  gameId: string;
  status: CabinetStatus;
  freePlay: boolean;
  playerCount: number;
  spectatorCount: number;
  updatedAt: number;
}

export type CabinetAction =
  | { type: "PLAYER_JOINED" }
  | { type: "SPECTATOR_JOINED" }
  | { type: "SPECTATOR_LEFT" }
  | { type: "START_SOLO" }
  | { type: "STOP_SOLO" }
  | { type: "PLAYER_LEFT" };

export function createCabinetState(cabinetId: string, now = Date.now()): CabinetState {
  return {
    cabinetId,
    gameId: "graze-duel",
    status: "empty",
    freePlay: true,
    playerCount: 0,
    spectatorCount: 0,
    updatedAt: now,
  };
}

export function reduceCabinetState(
  state: CabinetState,
  action: CabinetAction,
  now = Date.now(),
): CabinetState {
  switch (action.type) {
    case "PLAYER_JOINED":
      if (state.playerCount > 0) return state;
      return { ...state, status: "occupied", playerCount: 1, updatedAt: now };
    case "SPECTATOR_JOINED":
      return { ...state, spectatorCount: state.spectatorCount + 1, updatedAt: now };
    case "SPECTATOR_LEFT":
      return {
        ...state,
        spectatorCount: Math.max(0, state.spectatorCount - 1),
        updatedAt: now,
      };
    case "START_SOLO":
      if (state.playerCount === 0) return state;
      return { ...state, status: "soloPlaying", updatedAt: now };
    case "STOP_SOLO":
      if (state.playerCount === 0) return state;
      return { ...state, status: "occupied", updatedAt: now };
    case "PLAYER_LEFT":
      return {
        ...state,
        status: "empty",
        playerCount: 0,
        updatedAt: now,
      };
  }
}

export function assignCabinetRole(state: CabinetState): CabinetRole {
  return state.playerCount === 0 ? "player" : "spectator";
}
