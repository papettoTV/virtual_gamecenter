const PATTERNS = [
  ["straight", 0.21],
  ["aimed", 0.19],
  ["diagonal", 0.16],
  ["triple", 0.17],
  ["fan", 0.15],
  ["curtain", 0.07],
  ["aimedStream", 0.05],
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

// Each board owns its cursors. Timing, rendering, aiming and boss attacks must
// never consume the pattern stream, even when one board advances more often.
export function resetBaseBulletSequences(players, seed) {
  for (const player of players) {
    player.baseBulletPatternRandom = seededRandom(seed);
    player.baseBulletTimingRandom = seededRandom(seed ^ 0x9e3779b9);
    player.basePattern = null;
    player.basePatternShotsLeft = 0;
    player.basePatternBreakTimer = 0;
    player.enemyTimer = 0;
  }
}

export function getBaseBulletPattern(player) {
  const random = player.baseBulletPatternRandom;
  if (!player.basePattern || player.basePatternShotsLeft <= 0) {
    const total = PATTERNS.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = random() * total;
    player.basePattern = PATTERNS[PATTERNS.length - 1][0];
    for (const [pattern, weight] of PATTERNS) {
      roll -= weight;
      if (roll <= 0) {
        player.basePattern = pattern;
        break;
      }
    }
    player.basePatternShotsLeft = Math.floor(18 + random() * 13);
  }
  player.basePatternShotsLeft -= 1;
  if (player.basePatternShotsLeft <= 0) {
    player.basePatternBreakTimer = 1.8 + random() * 1.2;
  }
  return player.basePattern;
}
