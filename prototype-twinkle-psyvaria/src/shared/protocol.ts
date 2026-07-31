import type { CabinetRole, CabinetState } from "../domain/cabinet";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type GameSnapshot = { [key: string]: JsonValue };
export type GameMotionFrame = { [key: string]: JsonValue };
export type GameEvent = { type: string; [key: string]: JsonValue };
export type VersusSeat = "host" | "challenger";
export type VersusFinishReason = "lifeLost" | "cleared" | "disconnect";
export type VersusProgress = { [key: string]: JsonValue };
export interface VersusTerminalReport {
  reason: VersusFinishReason;
  score: number;
  clearTimeMs: number | null;
  matchElapsedMs: number;
}
export type ChallengeQueueClientStatus = "none" | "pending" | "queued" | "matched";

export type ClientMessage =
  | { type: "joinCabinet" }
  | { type: "startSolo" }
  | { type: "stopSolo" }
  | { type: "leaveCabinet" }
  | { type: "gameKeyframe"; seq: number; snapshot: GameSnapshot }
  | { type: "gameEvents"; seq: number; events: GameEvent[] }
  | { type: "gameMotionFrame"; seq: number; frame: GameMotionFrame }
  | { type: "requestChallenge"; reservationId: string }
  | { type: "cancelChallenge" }
  | { type: "respondChallenge"; accept: boolean }
  | { type: "versusReady"; matchId: string }
  | { type: "versusProgress"; matchId: string; seq: number; progress: VersusProgress }
  | { type: "versusAttack"; matchId: string; attackId: string; level: number; bossAttack: boolean }
  | { type: "versusTerminal"; matchId: string; report: VersusTerminalReport }
  | { type: "requestRematch"; matchId: string; reservationId: string }
  | { type: "respondRematch"; matchId: string; accept: boolean }
  | { type: "declineRematch"; matchId: string };

export type ServerMessage =
  | { type: "connected"; clientId: string }
  | { type: "joinedCabinet"; clientId: string; role: CabinetRole }
  | { type: "cabinetState"; state: CabinetState }
  | { type: "viewerKeyframe"; seq: number; snapshot: GameSnapshot }
  | { type: "viewerEvents"; seq: number; events: GameEvent[] }
  | { type: "viewerMotionFrame"; seq: number; frame: GameMotionFrame }
  | { type: "challengePending"; reservationId: string }
  | { type: "challengeQueued"; reservationId: string; position: number; waitingCount: number }
  | {
      type: "challengeQueueStatus";
      waitingCount: number;
      capacity: number;
      position: number | null;
      status: ChallengeQueueClientStatus;
    }
  | { type: "challengeReceived" }
  | { type: "challengeRejected"; reservationId: string; reason: string }
  | { type: "challengeAccepted"; matchId: string; seat: VersusSeat; reservationId: string | null }
  | { type: "versusReadyState"; matchId: string; hostReady: boolean; challengerReady: boolean }
  | { type: "versusCountdown"; matchId: string; startsAt: number }
  | { type: "versusOpponentProgress"; matchId: string; seq: number; progress: VersusProgress }
  | { type: "versusAttack"; matchId: string; attackId: string; level: number; bossAttack: boolean }
  | { type: "versusClearWaiting"; matchId: string }
  | {
      type: "versusResult";
      matchId: string;
      winner: VersusSeat | "draw";
      reason: string;
      host: VersusTerminalReport | null;
      challenger: VersusTerminalReport | null;
    }
  | { type: "rematchRequested"; matchId: string; deadline: number }
  | { type: "rematchRejected"; matchId: string; reservationId: string }
  | { type: "versusEnded"; matchId: string; nextRole: CabinetRole; reason: string }
  | { type: "roleChanged"; role: CabinetRole }
  | { type: "playerLeft" }
  | { type: "error"; message: string };
