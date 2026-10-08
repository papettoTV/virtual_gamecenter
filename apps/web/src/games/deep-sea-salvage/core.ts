export type SeaLayer = 1 | 2 | 3;

export type FishPattern = "cruise" | "wave" | "dart" | "ambush";
// Behaviors belong to species, never to a random individual spawn.
export const FISH_PATTERNS = {
  "sun-sardine": "cruise", "glass-bream": "cruise", "ribbon-goby": "wave",
  "blue-puffer": "cruise", "coral-ray": "wave",
  "silver-hatchet": "cruise", "lantern-cod": "wave", "veil-squid": "dart",
  "saw-shrimp": "ambush", "moon-jelly": "wave",
  "abyss-eel": "wave", "black-fang": "ambush", "ghost-squid": "dart",
  "star-mouth": "ambush", "deep-ray": "cruise",
  "prism-fish": "dart", "crown-jelly": "wave", "comet-eel": "dart",
  "ruby-angler": "dart", "void-manta": "wave",
  "leviathan": "cruise",
} as const satisfies Record<string, FishPattern>;

export const LAYER_TWO_DEPTH = 1_500;
export const LAYER_THREE_DEPTH = 3_500;
export const DEFAULT_BOSS_START_DEPTH = 4_000;
export const DEFAULT_BOSS_INTERVAL = 800;
export const NORMAL_RESEARCH_RANGE = 150;
export const BOSS_RESEARCH_RANGE = 100;
export const BOSS_BODY_RADIUS_X = 330;
export const BOSS_BODY_RADIUS_Y = 118;
export const BOSS_TAIL = [[-280, 0], [-470, -150], [-420, 0], [-470, 150]] as const;
export const BOSS_DORSAL = [
  [-190, -88], [-168, -146], [-140, -101], [-106, -154], [-72, -104],
  [-30, -151], [8, -105], [52, -158], [88, -104], [132, -143], [166, -86],
] as const;
export const MAX_HULL = 3;

export function damageHull(hull: number, damage = 1): number {
  return Math.max(0, Math.min(MAX_HULL, hull - damage));
}

export function getBossWobbleDepth(baseDepth: number, elapsed: number, amplitude: number, frequency: number, phase: number): number {
  const primary = Math.sin(elapsed * frequency + phase) * amplitude;
  const secondary = Math.sin(elapsed * frequency * 2.17 + phase * .7) * amplitude * .28;
  return baseDepth + primary + secondary;
}

export function canFishCollide(completed: boolean, invincible: number): boolean {
  return !completed && invincible <= 0;
}

export function getFishSafetyVisual(completed: boolean, distance: number, fishRadius: number, time: number) {
  const nearby = !completed && distance < fishRadius + 16 + 65;
  return {
    color: completed ? "#75e8ef" : "#ff6266",
    alpha: completed ? .55 : nearby ? .65 + Math.sin(time * Math.PI * 2) * .25 : .48,
    lineWidth: nearby ? 2.5 : 1.5,
    showOutline: !completed,
    warning: nearby,
  };
}

export function getFishSpawnMultiplier(depth: number, bossStart: number, bossInterval: number): number {
  // Use the depth schedule, since chunks are generated well ahead of the player.
  const nextPass = bossStart + Math.max(0, Math.ceil((depth - bossStart) / Math.max(1, bossInterval))) * Math.max(1, bossInterval);
  return nextPass - depth <= 400 ? .5 : 1;
}

function circleTouchesPolygon(x: number, y: number, radius: number, points: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i]!; const [bx, by] = points[(i + 1) % points.length]!;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax; const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= radius) return true;
  }
  return inside;
}

const BOSS_BODY_OUTLINE: Array<readonly [number, number]> = Array.from({ length: 128 }, (_, i) => {
  const angle = i / 128 * Math.PI * 2;
  return [Math.cos(angle) * BOSS_BODY_RADIUS_X, Math.sin(angle) * BOSS_BODY_RADIUS_Y];
});

export function isBossBodyResearchable(playerX: number, playerY: number, bossX: number, bossY: number, direction: 1 | -1, viewportWidth: number, viewportHeight: number): boolean {
  const left = bossX - (direction === 1 ? 470 : BOSS_BODY_RADIUS_X);
  const right = bossX + (direction === 1 ? BOSS_BODY_RADIUS_X : 470);
  if (right < 0 || left > viewportWidth || bossY + 150 < 64 || bossY - 150 > viewportHeight) return false;
  const x = (playerX - bossX) * direction; const y = playerY - bossY;
  return circleTouchesPolygon(x, y, BOSS_RESEARCH_RANGE, BOSS_BODY_OUTLINE)
    || circleTouchesPolygon(x, y, BOSS_RESEARCH_RANGE, BOSS_TAIL);
}

export function isBossBodyColliding(playerX: number, playerY: number, radius: number, bossX: number, bossY: number, direction: 1 | -1): boolean {
  const x = (playerX - bossX) * direction; const y = playerY - bossY;
  return circleTouchesPolygon(x, y, radius, BOSS_BODY_OUTLINE)
    || circleTouchesPolygon(x, y, radius, BOSS_TAIL)
    || circleTouchesPolygon(x, y, radius, BOSS_DORSAL);
}
export const BASE_POWER_DRAIN = .228;
export const DANGER_RARE_RATE_MULTIPLIER = 6;
export const RESEARCH_REWARD_MULTIPLIERS = [1, .25, .1, 0] as const;
export const RETRY_SCORE_MULTIPLIERS = [1, .8, .65, .5] as const;

export function getRegularFishSpawnCount(random: number): number {
  // 1–3 fish (mean 2), down from 3–5 (mean 4) per depth chunk.
  return 1 + Math.min(2, Math.max(0, Math.floor(random * 3)));
}

export function getSubmarinePitch(depthVelocity: number, heading: number): number {
  // Canvas rotation must reverse when the bow points left.
  return Math.max(-.28, Math.min(.28, depthVelocity / 260)) * Math.cos(heading);
}

export function getSubmarineHeadingTarget(horizontalInput: number, currentHeading: number): number {
  if (horizontalInput < -.08) return Math.PI;
  if (horizontalInput > .08) return 0;
  return currentHeading;
}

export function getSubmarineLightLevel(depth: number): number {
  return Math.max(0, Math.min(1, 1 - depth / LAYER_THREE_DEPTH));
}

export function getSeaLayer(depth: number): SeaLayer {
  if (depth >= LAYER_THREE_DEPTH) return 3;
  if (depth >= LAYER_TWO_DEPTH) return 2;
  return 1;
}

export function getPowerDrainMultiplier(depth: number): number {
  if (depth <= LAYER_TWO_DEPTH) return 1;
  if (depth <= LAYER_THREE_DEPTH) return 1 + (depth - LAYER_TWO_DEPTH) / (LAYER_THREE_DEPTH - LAYER_TWO_DEPTH) * .35;
  return Math.min(1.6, 1.35 + (depth - LAYER_THREE_DEPTH) / 6_000 * .25);
}

export function getCurrentStrength(depth: number): number {
  if (depth < LAYER_TWO_DEPTH) return 0;
  if (depth < LAYER_THREE_DEPTH) return 18 + (depth - LAYER_TWO_DEPTH) / (LAYER_THREE_DEPTH - LAYER_TWO_DEPTH) * 16;
  return Math.min(52, 34 + (depth - LAYER_THREE_DEPTH) / 4_000 * 18);
}

export function getRareSpawnRate(baseRate: number, dangerousZone: boolean): number {
  return Math.min(1, Math.max(0, baseRate) * (dangerousZone ? DANGER_RARE_RATE_MULTIPLIER : 1));
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
