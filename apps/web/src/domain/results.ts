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
  play_time_ms: number;
  cleared: number;
  score: number;
  max_level: number;
  defeated_boss_count: number;
  created_at: string;
}
