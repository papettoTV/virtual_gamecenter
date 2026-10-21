import type { GameMode } from "./game";

export interface PlayModeEnvironment {
  APP_ENV?: string;
  LOCAL_MULTIPLAYER_ENABLED?: string;
}

export const PUBLIC_GAME_MODES: readonly GameMode[] = ["solo"];
export const GAME_MODE_UNAVAILABLE = "game_mode_unavailable";
export const GAME_MODE_UNAVAILABLE_MESSAGE = "無料ベータ期間中はソロプレイと観戦のみ利用できます。";

export function availableGameModes(environment: PlayModeEnvironment = {}): readonly GameMode[] {
  return environment.APP_ENV === "local" && environment.LOCAL_MULTIPLAYER_ENABLED === "true"
    ? ["solo", "versus"] : PUBLIC_GAME_MODES;
}

export function isGameModeAvailable(mode: unknown, environment: PlayModeEnvironment = {}): boolean {
  return availableGameModes(environment).some(available => available === mode);
}

export function isSoloOrSpectatorCommand(type: string): boolean {
  return ["joinCabinet", "leaveCabinet", "clockPing", "refreshDotWaveProfile", "startReceipt",
    "startSolo", "stopSolo", "gameKeyframe", "gameEvents", "gameMotionFrame",
    "cancelChallenge", "declineRematch"].includes(type);
}
