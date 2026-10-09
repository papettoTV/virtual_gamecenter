import { MAX_HULL } from "./core";
import type { Phase, BossPass, Fish, Hazard } from "./live-state";
import type { TerrainCourse } from "./terrain";

export function createState(width: number, terrainCourse: TerrainCourse) {
  return {
    phase: "ready" as Phase,
    paused: true,
    collectionOpen: false,
    returnToResult: false,
    elapsed: 0,
    subX: width / 2,
    subDepth: 0,
    maxDepth: 0,
    subVx: 0,
    subVDepth: 0,
    subHeading: 0,
    subHeadingTarget: 0,
    invincible: 0,
    hull: MAX_HULL,
    power: 100,
    earnedScore: 0,
    finalScore: 0,
    finalSubtotal: 0,
    cleared: false,
    retryCount: 0,
    nextFishId: 1,
    nextHazardId: 1,
    nextBossDepth: 4_000,
    bossProgress: 0,
    boss: { active: false, x: 0, depth: 0, baseDepth: 0, direction: 1, flash: 0, wobbleAmplitude: 0, wobbleFrequency: 0, wobblePhase: 0 } as BossPass,
    bossClearTimer: 0,
    hullBreakTimer: 0,
    hullBreakTitle: "船体が大破した",
    bossGaugeVisible: false,
    fishes: [] as Fish[],
    hazards: [] as Hazard[],
    terrainCourse,
    targetFishIds: new Set<number>(),
    visitedChunks: new Set<number>(),
    discovered: new Set<string>(),
    researchCounts: new Map<string, number>(),
    message: "P / 画面下のボタンで潜航開始",
    messageTimer: 99,
    hazardMessageCooldown: 0,
  };
}

export type State = ReturnType<typeof createState>;
