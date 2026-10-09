import type { Exchange, Grade, Match, Resolution, Side } from "./core";
import type { CpuStage } from "./campaign";
import type { Score } from "./score";

export type Phase = "countdown" | "intro" | "playing" | "paused" | "impact" | "finished";
export type Engine = { elapsedPlayMs?: number; comboFlash?: { combo: number; at: number; turn: number }; score?: Score; cpuStage?: CpuStage; phase: Phase; mode: "cpu" | "local" | "online"; match: Match; selected: number; exchange: Exchange | null; seconds: number; outcome: Resolution | null; impactElapsed: number; feedback: string; cpu: Grade[]; flash: { side: Side; grade: Grade; at: number } | null; inputWarning: { side: Side; at: number; message: string } | null };
