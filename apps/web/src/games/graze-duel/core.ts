export const ATTACK_BASE_COST = 420;
export const LEVEL_UP_INVINCIBLE_TIME = 2.4;
export const INVINCIBLE_CHAIN_EXTENSION = 0.4;

export function calculateAttackCost(level: number, growthPerLevel: number): number {
  return ATTACK_BASE_COST + Math.max(0, level - 1) * growthPerLevel;
}

export function calculateNextInvincibleTime(currentTime: number): number {
  if (currentTime <= 0) return LEVEL_UP_INVINCIBLE_TIME;
  return Math.min(
    LEVEL_UP_INVINCIBLE_TIME,
    currentTime + INVINCIBLE_CHAIN_EXTENSION,
  );
}
