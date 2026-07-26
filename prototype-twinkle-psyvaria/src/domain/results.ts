import type { GameId, GameMode } from "./game";

export interface GameResult {
  id: string;
  playSessionId: string | null;
  gameId: GameId;
  gameVersion: string;
  mode: GameMode;
  playerId: string | null;
  playerName: string;
  cleared: boolean;
  clearTimeMs: number | null;
  score: number;
  maxLevel: number;
  defeatedBossCount: number;
  endedAt: number;
}

export interface RankingEntry {
  player_name: string;
  clear_time_ms: number;
  score: number;
  max_level: number;
  created_at: string;
}
