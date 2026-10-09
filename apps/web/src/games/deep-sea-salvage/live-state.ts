import { FISH_PATTERNS, type FishPattern } from "./core";
import type { TerrainCourse } from "./terrain";

export type Phase = "ready" | "dive" | "hull-break" | "boss-clear" | "result";
export type Fish = {
  id: number; speciesId: keyof typeof FISH_PATTERNS; x: number; depth: number; vx: number; baseDepth: number;
  phase: number; research: number; completed: boolean; flash: number; completionEffect: number;
  pattern: FishPattern; activated: boolean; alertTimer: number; inHollow: boolean; homeX: number;
};
export type BossPass = {
  active: boolean; x: number; depth: number; baseDepth: number; direction: 1 | -1; flash: number;
  wobbleAmplitude: number; wobbleFrequency: number; wobblePhase: number;
};
export type Hazard = {
  id: number; kind: "rock" | "kelp" | "vent"; x: number; depth: number; width: number; height: number;
  phase: number; dangerous: boolean; side?: -1 | 1; hollowDepth?: number; hollowHeight?: number;
  topWidth?: number; bottomWidth?: number;
};
export interface SalvageLiveState {
  runId: string;
  phase: Phase;
  paused: boolean;
  collectionOpen: boolean;
  elapsed: number;
  subX: number;
  subDepth: number;
  maxDepth: number;
  subVDepth: number;
  subHeading: number;
  invincible: number;
  hull: number;
  power: number;
  earnedScore: number;
  finalScore: number;
  cleared: boolean;
  retryCount: number;
  bossProgress: number;
  boss: BossPass;
  bossClearTimer: number;
  hullBreakTimer: number;
  hullBreakTitle: string;
  bossGaugeVisible: boolean;
  fishes: Fish[];
  targetFishIds: number[];
  discovered: string[];
  message: string;
  messageTimer: number;
}
export interface SalvageLiveWorld {
  terrainCourse: TerrainCourse;
  hazards: Hazard[];
}

export class SalvageLiveBuffer {
  private previous: SalvageLiveState | null = null;
  private current: SalvageLiveState | null = null;
  private receivedAt = 0;
  private interval = 1;
  private sequence = -1;

  push(state: SalvageLiveState, sequence: number, now: number): boolean {
    if (sequence <= this.sequence) return false;
    this.previous = this.current?.runId === state.runId && this.current.phase === state.phase ? this.current : null;
    this.interval = Math.max(1, Math.min(200, now - this.receivedAt));
    this.current = state;
    this.receivedAt = now;
    this.sequence = sequence;
    return true;
  }

  clear() {
    this.previous = this.current = null;
    this.sequence = -1;
  }

  sample(now: number): SalvageLiveState | null {
    const current = this.current;
    const previous = this.previous;
    if (!current || !previous || current.paused || current.collectionOpen) return current;
    const amount = Math.max(0, Math.min(1, (now - this.receivedAt) / this.interval));
    const mix = (before: number, after: number) => before + (after - before) * amount;
    const previousFish = new Map(previous.fishes.map(fish => [fish.id, fish]));
    return {
      ...current,
      elapsed: mix(previous.elapsed, current.elapsed),
      subX: mix(previous.subX, current.subX),
      subDepth: mix(previous.subDepth, current.subDepth),
      subHeading: mix(previous.subHeading, current.subHeading),
      hullBreakTimer: mix(previous.hullBreakTimer, current.hullBreakTimer),
      bossClearTimer: mix(previous.bossClearTimer, current.bossClearTimer),
      boss: previous.boss.active === current.boss.active ? {
        ...current.boss, x: mix(previous.boss.x, current.boss.x), depth: mix(previous.boss.depth, current.boss.depth),
      } : current.boss,
      fishes: current.fishes.map(fish => {
        const before = previousFish.get(fish.id);
        return before ? { ...fish, x: mix(before.x, fish.x), depth: mix(before.depth, fish.depth) } : fish;
      }),
    };
  }
}
