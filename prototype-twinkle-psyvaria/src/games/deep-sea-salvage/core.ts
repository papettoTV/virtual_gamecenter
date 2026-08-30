export type SeaLayer = 1 | 2 | 3;

export const LAYER_TWO_DEPTH = 1_500;
export const LAYER_THREE_DEPTH = 3_500;
export const DEFAULT_BOSS_START_DEPTH = 4_000;
export const DEFAULT_BOSS_INTERVAL = 800;
export const NORMAL_RESEARCH_RANGE = 150;
export const BOSS_RESEARCH_RANGE = 420;
export const RESEARCH_REWARD_MULTIPLIERS = [1, .25, .1, 0] as const;
export const RETRY_SCORE_MULTIPLIERS = [1, .8, .65, .5] as const;

export function getSeaLayer(depth: number): SeaLayer {
  if (depth >= LAYER_THREE_DEPTH) return 3;
  if (depth >= LAYER_TWO_DEPTH) return 2;
  return 1;
}

export function getResearchRewardMultiplier(completedCount: number): number {
  return RESEARCH_REWARD_MULTIPLIERS[Math.min(3, Math.max(0, completedCount))] ?? 0;
}

export function getRetryScoreMultiplier(retryCount: number): number {
  return RETRY_SCORE_MULTIPLIERS[Math.min(3, Math.max(0, retryCount))] ?? .5;
}

export function crossedBossDepth(maxDepth: number, nextBossDepth: number, bossActive: boolean): boolean {
  return !bossActive && maxDepth >= nextBossDepth;
}

export function calculateFinalScore({
  earnedScore,
  cleared,
  remainingPower,
  retryCount,
  bossScore = 12_000,
  powerPointValue = 100,
}: {
  earnedScore: number;
  cleared: boolean;
  remainingPower: number;
  retryCount: number;
  bossScore?: number;
  powerPointValue?: number;
}): { subtotal: number; multiplier: number; total: number } {
  const subtotal = Math.max(0, Math.floor(
    earnedScore + (cleared ? bossScore + Math.max(0, remainingPower) * powerPointValue : 0),
  ));
  const multiplier = getRetryScoreMultiplier(retryCount);
  return { subtotal, multiplier, total: Math.floor(subtotal * multiplier) };
}
