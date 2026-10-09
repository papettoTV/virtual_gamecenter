export function createGameState(settings) {
  const { BOSS_PHASES, LEFT_X, RIGHT_X, FIELD_WIDTH, FIELD_TOP, FIELD_HEIGHT, FIELD_BOTTOM, BOSS_RADIUS, BOSS_ATTACK_TELEGRAPH_TIME, MAX_LIVES, BOSS_ATTACK_INTERVAL } = settings;
  const particles = [];
  const boss = {
    active: false,
    phaseIndex: 0,
    nextSpawnLevel: BOSS_PHASES[0].spawnLevel,
    x: LEFT_X + FIELD_WIDTH / 2,
    y: FIELD_TOP + FIELD_HEIGHT * 0.38,
    baseY: FIELD_TOP + FIELD_HEIGHT * 0.38,
    radius: BOSS_RADIUS,
    hp: BOSS_PHASES[0].hp,
    maxHp: BOSS_PHASES[0].hp,
    damageCooldown: 0,
    flash: 0,
    encounterState: "idle",
    arrivalTimer: 0,
    arrivalProgress: 0,
    attackState: "telegraph",
    attackPatternIndex: 0,
    attackTimer: BOSS_ATTACK_TELEGRAPH_TIME,
    attackShotTimer: 0,
    attackStep: 0,
    attackTargetX: LEFT_X + FIELD_WIDTH / 2,
    attackTargetY: FIELD_BOTTOM - 58,
    shieldAttackCharges: 0,
    bonusUsed: false,
    bonusPending: false,
    bonusActive: false,
    bonusStreamX: LEFT_X + FIELD_WIDTH / 2,
    shieldHitsTaken: 0,
    movementTime: 0,
  };

  const opponentBoss = {
    active: false,
    phaseIndex: 0,
    nextSpawnLevel: BOSS_PHASES[0].spawnLevel,
    x: RIGHT_X + FIELD_WIDTH / 2,
    y: FIELD_TOP + FIELD_HEIGHT * 0.38,
    baseY: FIELD_TOP + FIELD_HEIGHT * 0.38,
    radius: BOSS_RADIUS,
    hp: 0,
    maxHp: BOSS_PHASES[0].hp,
    flash: 0,
    encounterState: "idle",
    arrivalProgress: 0,
  };

  const players = [
    createPlayer("YOU", LEFT_X, "#69f7ff", false),
    createPlayer("CPU", RIGHT_X, "#ff4e8a", true),
  ];

  function createPlayer(label, x, color, cpu) {
    return {
      label,
      x,
      y: FIELD_BOTTOM - 58,
      fieldX: x,
      color,
      cpu,
      lives: MAX_LIVES,
      score: 0,
      gauge: 0,
      level: 1,
      nextBossLevel: BOSS_ATTACK_INTERVAL,
      combo: 0,
      multiplier: 1,
      comboTimer: 0,
      invincible: 0,
      levelUpInvincible: 0,
      barrierRatio: 0,
      hitInvincible: false,
      bullets: [],
      enemyTimer: 0,
      basePattern: null,
      basePatternShotsLeft: 0,
      basePatternBreakTimer: 0,
      attackFlash: 0,
      attackCooldown: 0,
      levelUpFlash: 0,
      grazeIds: new Set(),
      tilt: 0,
      targetTilt: 0,
      cpuDirection: 1,
      cpuThink: 0,
    };
  }

  return { players, boss, opponentBoss, particles };
}
