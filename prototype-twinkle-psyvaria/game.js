import { createCabinetClient } from "./cabinet-client.js";

const canvas = document.querySelector("#game");
const context = canvas.getContext("2d");
const arcadeScreen = document.querySelector("#arcade-screen");
const cabinetScreen = document.querySelector("#cabinet-screen");
const gameScreen = document.querySelector("#game-screen");
const selectGameButton = document.querySelector("#select-game");
const startSoloButton = document.querySelector("#start-solo");
const backToArcadeButton = document.querySelector("#back-to-arcade");
const cabinetBreadcrumbArcade = document.querySelector("#cabinet-breadcrumb-arcade");
const gameBackToArcadeButton = document.querySelector("#game-back-to-arcade");
const cabinetStatusLabel = document.querySelector("#cabinet-status-label");
const cabinetSummary = document.querySelector("#cabinet-summary");
const cabinetDescription = document.querySelector("#cabinet-description");
const cabinetRoleLabel = document.querySelector("#cabinet-role-label");
const spectatorBanner = document.querySelector("#spectator-banner");
const bulletDensityInput = document.querySelector("#bullet-density");
const bulletDensityValue = document.querySelector("#bullet-density-value");
const playerHitboxToggle = document.querySelector("#player-hitbox-toggle");
const debugRankingPreviewToggle = document.querySelector("#debug-ranking-preview-toggle");
const gaugeGrowthDown = document.querySelector("#gauge-growth-down");
const gaugeGrowthUp = document.querySelector("#gauge-growth-up");
const gaugeGrowthValue = document.querySelector("#gauge-growth-value");
const gaugeGrowthLabel = document.querySelector("#gauge-growth-label");
const touchRestart = document.querySelector("#touch-restart");
const touchPause = document.querySelector("#touch-pause");
const clearRestart = document.querySelector("#clear-restart");
const rankingNameInput = document.querySelector("#ranking-name");
const rankingSubmitButton = document.querySelector("#ranking-submit");
const rankingSubmitPanel = document.querySelector("#ranking-submit-panel");
const rankingResult = document.querySelector("#ranking-result");
const rankingList = document.querySelector("#ranking-list");
const rankingRefresh = document.querySelector("#ranking-refresh");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const FIELD_MARGIN = 34;
const FIELD_TOP = 74;
const FIELD_BOTTOM = HEIGHT - 30;
const FIELD_WIDTH = 392;
const FIELD_HEIGHT = FIELD_BOTTOM - FIELD_TOP;
const LEFT_X = 44;
const RIGHT_X = WIDTH - LEFT_X - FIELD_WIDTH;
const PLAYER_RADIUS = 7;
const HIT_RADIUS = 1;
const GRAZE_RADIUS = 24;
const ATTACK_COST = 420;
const MAX_LIVES = 3;
const AUTO_ATTACK_COOLDOWN = 0.45;
const ATTACK_BULLET_COLOR = "#ff4e8a";
const BOSS_ATTACK_INTERVAL = 10;
const LEVEL_UP_INVINCIBLE_TIME = 2.4;
const INVINCIBLE_CHAIN_EXTENSION = 0.4;
const BOSS_MAX_HP = 100;
const BOSS_RADIUS = 34;
const BOSS_CONTACT_DAMAGE = 4;
const BOSS_INVINCIBLE_COST = 0.22;
const BOSS_DAMAGE_COOLDOWN = 0.12;
const HIT_INVINCIBLE_TIME = 2.2;
const INVINCIBLE_RING_INNER_RADIUS = 18;
const INVINCIBLE_RING_INNER_SCALE = 28;
const INVINCIBLE_RING_OUTER_RADIUS = 24;
const INVINCIBLE_RING_OUTER_SCALE = 42;
const PLAYER_SPEED_SCALE = 0.75;
const BULLET_SPEED_SCALE = 0.75;
const ATTACK_BULLET_COUNT_SCALE = 0.35;
const ATTACK_BULLET_CLEAR_BONUS = 0.15;
const BASE_BULLET_CLEAR_BONUS = 0.25;
const INVINCIBLE_WARNING_TIME = 0.5;
const MAX_PARTICLES = 180;
const HIT_DEBUG_ENABLED = false;
const PLAYER_TILT_MAX = 1;
const PLAYER_TILT_LERP = 0.2;
const BOSS_DEFEAT_SLOW_TIME = 2.2;
const BOSS_DEFEAT_SLOW_SCALE = 0.28;
const START_BULLET_DELAY = 2.0;
const HIT_MARKER_RADIUS = 3;
const CLIENT_VERSION = "prototype-boss-rush-1";
const DEFAULT_RANKING_API_BASE = "https://graze-duel-ranking-api.aegfrompsbt.workers.dev";
const RANKING_API_BASE = localStorage.getItem("grazeDuelRankingApiBase") || DEFAULT_RANKING_API_BASE;

const BOSS_PHASES = [
  { level: 1, spawnLevel: 10, name: "BOSS LV1", shape: "circle", hp: 25, radius: 34, color: "#5a1f65" },
  { level: 2, spawnLevel: 20, name: "MID BOSS LV2", shape: "invertedTriangle", hp: 30, radius: 38, color: "#245f7a" },
  { level: 3, spawnLevel: 30, name: "LAST BOSS LV3", shape: "star", hp: 38, radius: 42, color: "#6d2a8f" },
];

const keys = new Set();
const particles = [];
const touchMove = { active: false, startX: 0, startY: 0, x: 0, y: 0 };
let audioContext = null;
let bulletDensity = 2;
let playerHitboxEnabled = true;
let gaugeGrowthPerLevel = 30;
let lastHitDebug = null;
let lastTime = performance.now();
let elapsedRound = 0;
let slowMotionTimer = 0;
let defeatedBossCount = 0;
let gameOver = false;
let paused = false;
let nextBulletId = 1;
let clearGame = false;
let lastClearResult = null;
let rankingSubmittedForClear = false;
let debugRankingPreviewEnabled = false;
let debugRankingPreviewShown = false;
let currentScreen = "arcade";
let gameSessionActive = false;
let cabinetRole = "visitor";
let cabinetState = null;
let latestViewerSnapshot = null;
let snapshotSequence = 0;
let snapshotTimer = 0;

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
};

const players = [
  createPlayer("YOU", LEFT_X, "#69f7ff", false),
  createPlayer("CPU", RIGHT_X, "#ff4e8a", true),
];

const cabinetClient = createCabinetClient({
  onConnectionChange: (connected) => {
    if (!connected && cabinetSummary) cabinetSummary.textContent = "筐体1: 再接続中 / Free Play";
  },
  onMessage: handleCabinetMessage,
  onError: (message) => {
    if (cabinetRoleLabel) cabinetRoleLabel.textContent = message;
  },
});

if (isLocalDevelopment()) {
  document.body.classList.add("is-local-dev");
}

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

function resetGame() {
  for (const player of players) {
    player.x = player.fieldX + FIELD_WIDTH / 2;
    player.y = FIELD_BOTTOM - 58;
    player.lives = MAX_LIVES;
    player.score = 0;
    player.gauge = 0;
    player.level = 1;
    player.nextBossLevel = BOSS_ATTACK_INTERVAL;
    player.combo = 0;
    player.multiplier = 1;
    player.comboTimer = 0;
    player.invincible = 1.5;
    player.levelUpInvincible = 0;
    player.barrierRatio = 0;
    player.hitInvincible = false;
    player.bullets = [];
    player.enemyTimer = 0;
    player.basePattern = null;
    player.basePatternShotsLeft = 0;
    player.basePatternBreakTimer = 0;
    player.attackFlash = 0;
    player.attackCooldown = 0;
    player.levelUpFlash = 0;
    player.tilt = 0;
    player.targetTilt = 0;
    player.grazeIds.clear();
  }
  particles.length = 0;
  lastHitDebug = null;
  elapsedRound = 0;
  slowMotionTimer = 0;
  defeatedBossCount = 0;
  gameOver = false;
  paused = false;
  if (touchPause) touchPause.textContent = "一時停止";
  clearGame = false;
  lastClearResult = null;
  rankingSubmittedForClear = false;
  debugRankingPreviewShown = false;
  rankingSubmitPanel?.classList.remove("is-visible");
  updateRankingSubmitState();
  resetBossProgress();
}

function resetBossProgress() {
  boss.active = false;
  boss.phaseIndex = 0;
  boss.nextSpawnLevel = BOSS_PHASES[0].spawnLevel;
  boss.x = LEFT_X + FIELD_WIDTH / 2;
  boss.baseY = FIELD_TOP + FIELD_HEIGHT * 0.38;
  boss.y = boss.baseY;
  boss.radius = BOSS_PHASES[0].radius;
  boss.hp = 0;
  boss.maxHp = BOSS_PHASES[0].hp;
  boss.damageCooldown = 0;
  boss.flash = 0;
}

function startBossPhase(phaseIndex) {
  const phase = BOSS_PHASES[phaseIndex];
  boss.active = true;
  boss.phaseIndex = phaseIndex;
  boss.x = LEFT_X + FIELD_WIDTH / 2;
  boss.baseY = FIELD_TOP + FIELD_HEIGHT * 0.38;
  boss.y = boss.baseY;
  boss.radius = phase.radius;
  boss.hp = phase.hp;
  boss.maxHp = phase.hp;
  boss.damageCooldown = 0;
  boss.flash = 0;
}

resetGame();
showScreen("arcade");

if (selectGameButton) {
  selectGameButton.addEventListener("click", () => {
    enterCabinet();
  });
}

if (backToArcadeButton) {
  backToArcadeButton.addEventListener("click", () => {
    leaveCabinet();
  });
}

if (cabinetBreadcrumbArcade) {
  cabinetBreadcrumbArcade.addEventListener("click", () => {
    leaveCabinet();
  });
}

if (gameBackToArcadeButton) {
  gameBackToArcadeButton.addEventListener("click", () => {
    leaveCabinet();
  });
}

if (startSoloButton) {
  startSoloButton.addEventListener("click", () => {
    startSoloPlay();
  });
}

if (bulletDensityInput && bulletDensityValue) {
  bulletDensityInput.addEventListener("input", () => {
    bulletDensity = Number(bulletDensityInput.value);
    bulletDensityValue.textContent = String(bulletDensity);
  });
}

if (playerHitboxToggle) {
  playerHitboxToggle.addEventListener("change", () => {
    playerHitboxEnabled = playerHitboxToggle.checked;
  });
}

if (debugRankingPreviewToggle) {
  debugRankingPreviewToggle.addEventListener("change", () => {
    debugRankingPreviewEnabled = debugRankingPreviewToggle.checked;
    debugRankingPreviewShown = false;
    if (!debugRankingPreviewEnabled && !clearGame) {
      lastClearResult = null;
      rankingSubmittedForClear = false;
      rankingSubmitPanel?.classList.remove("is-visible");
      updateRankingSubmitState();
    }
  });
}

if (gaugeGrowthDown && gaugeGrowthUp && gaugeGrowthValue && gaugeGrowthLabel) {
  gaugeGrowthDown.addEventListener("click", () => updateGaugeGrowth(-5));
  gaugeGrowthUp.addEventListener("click", () => updateGaugeGrowth(5));
}

canvas.addEventListener("pointerdown", (event) => {
  if (isCompactView() && cabinetRole !== "spectator") {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    touchMove.active = true;
    touchMove.startX = event.clientX;
    touchMove.startY = event.clientY;
    updateTouchMove(event);
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (touchMove.active) {
    event.preventDefault();
    updateTouchMove(event);
  }
});

canvas.addEventListener("pointerup", resetTouchMove);
canvas.addEventListener("pointercancel", resetTouchMove);

if (touchRestart) {
  touchRestart.addEventListener("click", () => {
    if (cabinetRole !== "spectator") resetGame();
  });
}

if (clearRestart) {
  clearRestart.addEventListener("click", () => {
    if (cabinetRole !== "spectator") resetGame();
  });
}

if (touchPause) {
  touchPause.addEventListener("click", () => {
    if (cabinetRole === "spectator") return;
    if (!gameOver) paused = !paused;
    touchPause.textContent = paused ? "再開" : "一時停止";
    broadcastViewerSnapshot(0, true);
  });
}

if (rankingSubmitButton) {
  rankingSubmitButton.addEventListener("click", () => {
    submitRanking();
  });
}

if (rankingRefresh) {
  rankingRefresh.addEventListener("click", () => {
    loadRanking();
  });
}

if (rankingNameInput) {
  rankingNameInput.addEventListener("input", updateRankingSubmitState);
}

function updateGaugeGrowth(delta) {
  gaugeGrowthPerLevel = clamp(gaugeGrowthPerLevel + delta, 0, 200);
  gaugeGrowthValue.textContent = String(gaugeGrowthPerLevel);
  gaugeGrowthLabel.textContent = String(gaugeGrowthPerLevel);
}

function showScreen(screen) {
  currentScreen = screen;
  document.body.classList.toggle("is-game-screen", screen === "game");
  arcadeScreen?.classList.toggle("is-hidden", screen !== "arcade");
  cabinetScreen?.classList.toggle("is-hidden", screen !== "cabinet");
  gameScreen?.classList.toggle("is-hidden", screen !== "game");
  if (cabinetStatusLabel) {
    cabinetStatusLabel.textContent = gameSessionActive ? "ソロプレイ中" : "空き";
  }
}

function enterCabinet() {
  cabinetRole = "joining";
  latestViewerSnapshot = null;
  updateCabinetUi();
  showScreen("cabinet");
  cabinetClient.join();
}

function startSoloPlay() {
  if (cabinetRole === "spectator") {
    startSpectating();
    return;
  }
  if (cabinetRole !== "player") return;
  resetGame();
  gameSessionActive = true;
  document.body.classList.remove("is-spectator");
  spectatorBanner?.classList.add("is-hidden");
  snapshotTimer = 0;
  cabinetClient.send({ type: "startSolo" });
  lastTime = performance.now();
  showScreen("game");
}

function startSpectating() {
  resetGame();
  gameSessionActive = true;
  document.body.classList.add("is-spectator");
  spectatorBanner?.classList.remove("is-hidden");
  if (latestViewerSnapshot) applyViewerSnapshot(latestViewerSnapshot);
  lastTime = performance.now();
  showScreen("game");
}

function leaveCabinet() {
  cabinetClient.leave();
  cabinetRole = "visitor";
  latestViewerSnapshot = null;
  gameSessionActive = false;
  paused = false;
  document.body.classList.remove("is-spectator");
  spectatorBanner?.classList.add("is-hidden");
  if (touchPause) touchPause.textContent = "一時停止";
  showScreen("arcade");
}

function handleCabinetMessage(message) {
  if (message.type === "cabinetState") {
    cabinetState = message.state;
    updateCabinetUi();
    return;
  }

  if (message.type === "joinedCabinet") {
    cabinetRole = message.role;
    updateCabinetUi();
    return;
  }

  if (message.type === "viewerSnapshot") {
    latestViewerSnapshot = message.snapshot;
    if (cabinetRole === "spectator" && currentScreen === "game") applyViewerSnapshot(message.snapshot);
    return;
  }

  if (message.type === "playerLeft" && cabinetRole === "spectator") {
    gameSessionActive = false;
    latestViewerSnapshot = null;
    showScreen("cabinet");
    if (cabinetRoleLabel) cabinetRoleLabel.textContent = "プレイヤーが筐体を離れました。";
    return;
  }

  if (message.type === "error" && cabinetRoleLabel) cabinetRoleLabel.textContent = message.message;
}

function updateCabinetUi() {
  const statusLabels = {
    empty: "空き",
    occupied: "開始待ち",
    soloPlaying: "ソロプレイ中",
  };
  const statusLabel = statusLabels[cabinetState?.status] ?? "接続中";
  const spectatorCount = cabinetState?.spectatorCount ?? 0;

  if (cabinetSummary) {
    const spectators = spectatorCount > 0 ? `・観戦 ${spectatorCount}人` : "";
    cabinetSummary.textContent = `筐体1: ${statusLabel}${spectators} / Free Play`;
  }
  if (cabinetStatusLabel) cabinetStatusLabel.textContent = statusLabel;
  if (!startSoloButton) return;

  if (cabinetRole === "player") {
    startSoloButton.disabled = false;
    startSoloButton.textContent = "ゲームスタート";
    if (cabinetDescription) {
      cabinetDescription.textContent = "筐体1に着席しています。フリープレイでソロプレイを開始できます。";
    }
    if (cabinetRoleLabel) cabinetRoleLabel.textContent = "あなたがプレイヤーです";
    return;
  }

  if (cabinetRole === "spectator") {
    startSoloButton.disabled = cabinetState?.status !== "soloPlaying";
    startSoloButton.textContent = cabinetState?.status === "soloPlaying" ? "観戦する" : "プレイ開始を待っています";
    if (cabinetDescription) {
      cabinetDescription.textContent = "この筐体は使用中です。プレイヤーのゲームをリアルタイムで観戦できます。";
    }
    if (cabinetRoleLabel) cabinetRoleLabel.textContent = "あなたは観戦者です";
    return;
  }

  startSoloButton.disabled = true;
  startSoloButton.textContent = "筐体に接続中";
  if (cabinetRoleLabel) cabinetRoleLabel.textContent = "接続中";
}

function broadcastViewerSnapshot(delta, force = false) {
  if (cabinetRole !== "player") return;
  snapshotTimer += delta;
  if (!force && snapshotTimer < 0.1) return;
  snapshotTimer = force ? 0 : snapshotTimer % 0.1;
  snapshotSequence += 1;
  cabinetClient.send({
    type: "gameSnapshot",
    seq: snapshotSequence,
    snapshot: createViewerSnapshot(),
  });
}

function createViewerSnapshot() {
  return {
    elapsedRound,
    gameOver,
    clearGame,
    paused,
    defeatedBossCount,
    players: players.map((player) => ({
      x: player.x,
      y: player.y,
      lives: player.lives,
      score: player.score,
      gauge: player.gauge,
      level: player.level,
      combo: player.combo,
      multiplier: player.multiplier,
      invincible: player.invincible,
      levelUpInvincible: player.levelUpInvincible,
      barrierRatio: player.barrierRatio,
      hitInvincible: player.hitInvincible,
      attackFlash: player.attackFlash,
      levelUpFlash: player.levelUpFlash,
      tilt: player.tilt,
      bullets: player.bullets.map((bullet) => ({
        id: bullet.id,
        x: bullet.x,
        y: bullet.y,
        vx: bullet.vx,
        vy: bullet.vy,
        radius: bullet.radius,
        color: bullet.color,
        type: bullet.type,
        age: bullet.age,
        shape: bullet.shape,
        rotation: bullet.rotation,
      })),
    })),
    boss: {
      active: boss.active,
      phaseIndex: boss.phaseIndex,
      nextSpawnLevel: boss.nextSpawnLevel,
      x: boss.x,
      y: boss.y,
      baseY: boss.baseY,
      radius: boss.radius,
      hp: boss.hp,
      maxHp: boss.maxHp,
      flash: boss.flash,
    },
  };
}

function applyViewerSnapshot(snapshot) {
  elapsedRound = snapshot.elapsedRound;
  gameOver = snapshot.gameOver;
  clearGame = snapshot.clearGame;
  paused = snapshot.paused;
  defeatedBossCount = snapshot.defeatedBossCount;
  snapshot.players.forEach((snapshotPlayer, index) => {
    const { bullets, ...playerState } = snapshotPlayer;
    Object.assign(players[index], playerState);
    players[index].bullets = bullets;
  });
  Object.assign(boss, snapshot.boss);
}

window.addEventListener("keydown", (event) => {
  if (cabinetRole === "spectator") return;
  if (event.code === "Space") {
    event.preventDefault();
    if (currentScreen === "game" && !gameOver) {
      paused = !paused;
      if (touchPause) touchPause.textContent = paused ? "再開" : "一時停止";
      broadcastViewerSnapshot(0, true);
    }
    return;
  }
  keys.add(event.code);
  if (event.code === "KeyR" && currentScreen === "game") startSoloPlay();
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

function loop(now) {
  const delta = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;
  update(delta);
  draw();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
loadRanking();

function update(delta) {
  if (currentScreen !== "game" || !gameSessionActive) return;
  if (cabinetRole === "spectator") return;
  if (paused) return;

  if (!gameOver) elapsedRound += delta;
  const gameDelta = getGameDelta(delta);
  if (players[0].lives <= 0) {
    gameOver = true;
  }

  updateHuman(players[0], gameDelta);
  updateCpu(players[1], players[0], gameDelta);

  for (const player of players) {
    updatePlayerState(player, gameDelta);
    if (!gameOver) spawnBaseBullets(player, gameDelta);
    updateBullets(player, gameDelta);
    updateGrazeAndHits(player);
  }

  tryAutoAttack(players[0], players[1]);
  tryAutoAttack(players[1], players[0]);
  updateBoss(gameDelta);
  updateDebugRankingPreview();

  updateParticles(gameDelta);
  slowMotionTimer = Math.max(0, slowMotionTimer - delta);
  broadcastViewerSnapshot(delta);
}

function getGameDelta(delta) {
  return slowMotionTimer > 0 ? delta * BOSS_DEFEAT_SLOW_SCALE : delta;
}

function updateBoss(delta) {
  checkBossSpawn();
  if (!boss.active) return;
  updateBossMovement();
  boss.damageCooldown = Math.max(0, boss.damageCooldown - delta);
  boss.flash = Math.max(0, boss.flash - delta);
  if (gameOver || boss.hp <= 0) return;

  const player = players[0];
  const touchingBoss = Math.hypot(player.x - boss.x, player.y - boss.y) < boss.radius + getInvincibleRingDamageRadius(player);
  if (!touchingBoss || player.levelUpInvincible <= 0 || boss.damageCooldown > 0) return;

  boss.hp = Math.max(0, boss.hp - BOSS_CONTACT_DAMAGE);
  boss.damageCooldown = BOSS_DAMAGE_COOLDOWN;
  boss.flash = 0.14;
  player.hitInvincible = player.levelUpInvincible > 0 || player.invincible > 0;
  player.score += 250;
  burst(boss.x, boss.y, "#ffd166", 8);
  playBossHitSound();
  if (boss.hp <= 0) {
    handleBossDefeated();
  }
}

function checkBossSpawn() {
  if (boss.active || clearGame || boss.phaseIndex >= BOSS_PHASES.length) return;
  if (players[0].level >= boss.nextSpawnLevel) {
    startBossPhase(boss.phaseIndex);
    boss.flash = 0.65;
  }
}

function updateBossMovement() {
  const phase = BOSS_PHASES[boss.phaseIndex];
  if (phase.level === 1) return;

  const minX = LEFT_X + FIELD_MARGIN + boss.radius;
  const maxX = LEFT_X + FIELD_WIDTH - FIELD_MARGIN - boss.radius;
  const travel = (Math.sin(elapsedRound * 0.55) + 1) / 2;
  boss.x = minX + (maxX - minX) * travel;
  boss.y = boss.baseY;

  if (phase.level === 3) {
    boss.y += Math.sin(elapsedRound * 4.4) * 24;
  }
}

function handleBossDefeated() {
  slowMotionTimer = BOSS_DEFEAT_SLOW_TIME;
  defeatedBossCount += 1;
  createExplosion(boss.x, boss.y, "#ffd166");
  playExplosionSound();
  clearAllBullets();

  const nextPhaseIndex = boss.phaseIndex + 1;
  if (nextPhaseIndex >= BOSS_PHASES.length) {
    clearGame = true;
    gameOver = true;
    recordClearResult();
    return;
  }

  boss.active = false;
  boss.phaseIndex = nextPhaseIndex;
  boss.nextSpawnLevel = players[0].level + 10;
  boss.hp = 0;
  boss.maxHp = BOSS_PHASES[nextPhaseIndex].hp;
  boss.damageCooldown = 0;
  boss.flash = 0;
}

function clearAllBullets() {
  for (const player of players) {
    player.bullets = [];
    player.grazeIds.clear();
  }
}

function updateDebugRankingPreview() {
  if (!debugRankingPreviewEnabled || debugRankingPreviewShown || clearGame || gameOver || elapsedRound < 3) return;
  debugRankingPreviewShown = true;
  clearGame = true;
  gameOver = true;
  clearAllBullets();
  showRankingRegistration("デバッグ: ゲーム開始3秒後のランキング登録表示です。");
}

function recordClearResult() {
  showRankingRegistration(`クリアタイム ${formatRankingTime(Math.round(elapsedRound * 1000))} を登録できます。`);
}

function showRankingRegistration(message) {
  lastClearResult = {
    clearTimeMs: Math.round(elapsedRound * 1000),
    score: players[0].score,
    maxLevel: players[0].level,
  };
  rankingSubmittedForClear = false;
  if (rankingResult) rankingResult.textContent = message;
  rankingSubmitPanel?.classList.add("is-visible");
  updateRankingSubmitState();
}

function isLocalDevelopment() {
  const hostname = window.location.hostname;
  return (
    window.location.protocol === "file:" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function updateRankingSubmitState() {
  if (!rankingSubmitButton) return;
  const hasName = Boolean(rankingNameInput?.value.trim());
  rankingSubmitButton.disabled = !lastClearResult || rankingSubmittedForClear || !hasName;
}

async function submitRanking() {
  if (!lastClearResult || rankingSubmittedForClear || !rankingNameInput) return;
  const playerName = rankingNameInput.value.trim();
  if (!playerName) {
    updateRankingSubmitState();
    return;
  }

  setRankingMessage("登録中です。");
  rankingSubmitButton.disabled = true;

  try {
    const response = await fetch(`${RANKING_API_BASE}/api/ranking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerName,
        clearTimeMs: lastClearResult.clearTimeMs,
        score: lastClearResult.score,
        maxLevel: lastClearResult.maxLevel,
        clientVersion: CLIENT_VERSION,
      }),
    });

    if (!response.ok) throw new Error(`ranking post failed: ${response.status}`);
    rankingSubmittedForClear = true;
    setRankingMessage("登録しました。");
    updateRankingSubmitState();
    await loadRanking();
  } catch (error) {
    console.warn(error);
    setRankingMessage("ランキングAPIに接続できません。Cloudflare Worker設定後に登録できます。");
    updateRankingSubmitState();
  }
}

async function loadRanking() {
  if (!rankingList) return;
  rankingList.innerHTML = "";
  const loadingItem = document.createElement("li");
  loadingItem.textContent = "読み込み中...";
  rankingList.append(loadingItem);

  try {
    const response = await fetch(`${RANKING_API_BASE}/api/ranking?type=time&limit=20`);
    if (!response.ok) throw new Error(`ranking get failed: ${response.status}`);
    const data = await response.json();
    renderRanking(data.rankings ?? []);
  } catch (error) {
    console.warn(error);
    rankingList.innerHTML = "";
    const item = document.createElement("li");
    item.textContent = "ランキングAPI未接続";
    rankingList.append(item);
  }
}

function renderRanking(rankings) {
  if (!rankingList) return;
  rankingList.innerHTML = "";
  if (rankings.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "まだ登録がありません";
    rankingList.append(emptyItem);
    return;
  }

  for (const ranking of rankings) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = ranking.player_name;
    const detail = document.createTextNode(
      ` ${formatRankingTime(ranking.clear_time_ms)} / SCORE ${ranking.score} / LV ${ranking.max_level}`,
    );
    item.append(name, detail);
    rankingList.append(item);
  }
}

function setRankingMessage(message) {
  if (rankingResult) rankingResult.textContent = message;
}

function formatRankingTime(milliseconds) {
  const totalSeconds = milliseconds / 1000;
  return `${totalSeconds.toFixed(2)}s`;
}

function getInvincibleRingRatio(player) {
  return player.levelUpInvincible / LEVEL_UP_INVINCIBLE_TIME;
}

function getInvincibleRingDamageRadius(player) {
  if (player.levelUpInvincible <= 0) return 0;
  return INVINCIBLE_RING_OUTER_RADIUS + getInvincibleRingRatio(player) * INVINCIBLE_RING_OUTER_SCALE;
}

function tryAutoAttack(attacker, defender) {
  if (gameOver || attacker.lives <= 0) return;
  if (attacker.gauge >= getAttackCost(attacker) && attacker.attackCooldown <= 0) {
    tryAttack(attacker, defender);
  }
}

function updateHuman(player, delta) {
  if (gameOver) return;
  let moveX = 0;
  let moveY = 0;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) moveX -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) moveX += 1;
  if (keys.has("ArrowUp") || keys.has("KeyW")) moveY -= 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) moveY += 1;
  if (touchMove.active) {
    moveX += touchMove.x;
    moveY += touchMove.y;
  }
  movePlayer(player, moveX, moveY, keys.has("ShiftLeft") || keys.has("ShiftRight"), delta);
}

function updateTouchMove(event) {
  const maxDistance = 72;
  const rawX = event.clientX - touchMove.startX;
  const rawY = event.clientY - touchMove.startY;
  const distance = Math.hypot(rawX, rawY);
  const limitedDistance = Math.min(distance, maxDistance);
  const angle = Math.atan2(rawY, rawX);
  const stickX = Math.cos(angle) * limitedDistance;
  const stickY = Math.sin(angle) * limitedDistance;

  touchMove.x = maxDistance === 0 ? 0 : stickX / maxDistance;
  touchMove.y = maxDistance === 0 ? 0 : stickY / maxDistance;
}

function resetTouchMove() {
  touchMove.active = false;
  touchMove.startX = 0;
  touchMove.startY = 0;
  touchMove.x = 0;
  touchMove.y = 0;
}

function updateCpu(player, opponent, delta) {
  if (gameOver) return;
  player.cpuThink -= delta;
  if (player.cpuThink <= 0) {
    player.cpuThink = 0.18 + Math.random() * 0.18;
    const closest = findClosestBullet(player);
    if (closest) {
      const desiredOffset = closest.x < player.x ? GRAZE_RADIUS * 0.75 : -GRAZE_RADIUS * 0.75;
      player.cpuTargetX = closest.x + desiredOffset;
      player.cpuTargetY = closest.y + 28;
    } else {
      player.cpuTargetX = player.fieldX + FIELD_WIDTH / 2 + Math.sin(elapsedRound * 1.6) * 90;
      player.cpuTargetY = FIELD_BOTTOM - 120;
    }
  }

  const moveX = Math.sign((player.cpuTargetX ?? player.x) - player.x);
  const moveY = Math.sign((player.cpuTargetY ?? player.y) - player.y);
  movePlayer(player, moveX, moveY, true, delta);

  if (player.gauge >= getAttackCost(player) && player.attackCooldown <= 0) {
    tryAttack(player, opponent);
  }
}

function movePlayer(player, moveX, moveY, slow, delta) {
  const length = Math.hypot(moveX, moveY) || 1;
  const speed = (slow ? 155 : 255) * PLAYER_SPEED_SCALE;
  player.targetTilt = clamp(moveX, -1, 1) * PLAYER_TILT_MAX;
  player.x += (moveX / length) * speed * delta;
  player.y += (moveY / length) * speed * delta;
  player.x = clamp(player.x, player.fieldX + FIELD_MARGIN, player.fieldX + FIELD_WIDTH - FIELD_MARGIN);
  player.y = clamp(player.y, FIELD_TOP + FIELD_MARGIN, FIELD_BOTTOM - FIELD_MARGIN);
}

function updatePlayerState(player, delta) {
  player.hitInvincible = player.invincible > 0 || player.levelUpInvincible > 0;
  player.comboTimer = Math.max(0, player.comboTimer - delta);
  if (player.comboTimer <= 0) {
    player.combo = 0;
    player.multiplier = 1;
    player.grazeIds.clear();
  }
  player.invincible = Math.max(0, player.invincible - delta);
  player.levelUpInvincible = Math.max(0, player.levelUpInvincible - delta);
  player.barrierRatio += (getInvincibleRingRatio(player) - player.barrierRatio) * Math.min(1, delta * 12);
  player.attackFlash = Math.max(0, player.attackFlash - delta);
  player.attackCooldown = Math.max(0, player.attackCooldown - delta);
  player.levelUpFlash = Math.max(0, player.levelUpFlash - delta);
  player.tilt += (player.targetTilt - player.tilt) * PLAYER_TILT_LERP;
}

function spawnBaseBullets(player, delta) {
  if (elapsedRound < START_BULLET_DELAY) return;
  player.basePatternBreakTimer = Math.max(0, player.basePatternBreakTimer - delta);
  if (player.basePatternBreakTimer > 0) return;
  player.enemyTimer -= delta;
  if (player.enemyTimer > 0) return;

  const intensity = 1 + elapsedRound / 45;
  const densityScale = (bulletDensity / 2) * (1 + defeatedBossCount * BASE_BULLET_CLEAR_BONUS);
  player.enemyTimer = Math.max(0.08, (0.46 - intensity * 0.045 - Math.random() * 0.08) / densityScale);
  const bulletBatch = Math.max(1, Math.floor(densityScale));
  const extraChance = densityScale - bulletBatch;
  const spawnCount = bulletBatch + (Math.random() < extraChance ? 1 : 0);

  for (let index = 0; index < spawnCount; index += 1) {
    spawnBaseBulletPattern(player, intensity);
  }
}

function spawnBaseBulletPattern(player, intensity) {
  const pattern = getBaseBulletPattern(player);

  if (pattern === "straight") spawnStraightBullet(player, intensity);
  if (pattern === "aimed") spawnAimedBullet(player, intensity);
  if (pattern === "diagonal") spawnDiagonalBullet(player, intensity);
  if (pattern === "triple") spawnTripleBullet(player, intensity);
  if (pattern === "fan") spawnFanBullets(player, intensity);
  if (pattern === "curtain") spawnCurtainBullets(player, intensity);
  if (pattern === "aimedStream") spawnAimedStreamBullets(player, intensity);
}

function getBaseBulletPattern(player) {
  if (!player.basePattern || player.basePatternShotsLeft <= 0) {
    player.basePattern = weightedRandom([
      ["straight", 0.21],
      ["aimed", 0.19],
      ["diagonal", 0.16],
      ["triple", 0.17],
      ["fan", 0.15],
      ["curtain", 0.07],
      ["aimedStream", 0.05],
    ]);
    player.basePatternShotsLeft = Math.floor(randomRange(18, 31));
  }
  player.basePatternShotsLeft -= 1;
  if (player.basePatternShotsLeft <= 0) {
    player.basePatternBreakTimer = randomRange(1.8, 3.0);
  }
  return player.basePattern;
}

function spawnStraightBullet(player, intensity) {
  const x = randomFieldX(player, 52);
  const speed = randomBaseBulletSpeed(intensity);
  addBullet(player, x, FIELD_TOP - 12, 0, speed, 7, "#9ca7ff", "base", { shape: "circle" });
}

function spawnAimedBullet(player, intensity) {
  const x = randomFieldX(player, 52);
  const y = FIELD_TOP - 12;
  const targetX = player.x + randomRange(-18, 18);
  const targetY = player.y + randomRange(-18, 18);
  const angle = Math.atan2(targetY - y, targetX - x);
  const speed = randomBaseBulletSpeed(intensity) * randomRange(0.92, 1.18);
  addBullet(player, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 7, "#ffdf7e", "base", { shape: "spinner" });
}

function spawnDiagonalBullet(player, intensity) {
  const fromLeft = Math.random() < 0.5;
  const x = fromLeft ? player.fieldX + 34 : player.fieldX + FIELD_WIDTH - 34;
  const y = FIELD_TOP - 12;
  const speed = randomBaseBulletSpeed(intensity) * randomRange(0.9, 1.2);
  const targetX = player.x + randomRange(-16, 16);
  const targetY = player.y + randomRange(-16, 16);
  const angle = Math.atan2(targetY - y, targetX - x);
  addBullet(player, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 7, "#b8ff7a", "base", { shape: "line", rotation: angle - Math.PI / 2 });
}

function spawnTripleBullet(player, intensity) {
  const x = randomFieldX(player, 64);
  const speed = randomBaseBulletSpeed(intensity) * randomRange(0.85, 1.15);
  const spacing = randomRange(18, 30);
  const vx = randomRange(-18, 18);
  for (let index = 0; index < 3; index += 1) {
    addBullet(player, x, FIELD_TOP - 12 - index * spacing, vx, speed * (1 + index * 0.03), 6, "#d7b8ff", "base", { shape: "line" });
  }
}

function spawnFanBullets(player, intensity) {
  const x = randomFieldX(player, 84);
  const y = FIELD_TOP - 14;
  const count = 5 + Math.floor(Math.random() * 3);
  const speed = randomBaseBulletSpeed(intensity) * randomRange(0.78, 1.05);
  const centerAngle = Math.PI / 2 + randomRange(-0.12, 0.12);
  const spread = randomRange(0.42, 0.72);

  for (let index = 0; index < count; index += 1) {
    const ratio = count === 1 ? 0 : index / (count - 1) - 0.5;
    const angle = centerAngle + ratio * spread;
    addBullet(player, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 6, "#9cf7ff", "base", { shape: "circle" });
  }
}

function spawnCurtainBullets(player, intensity) {
  const gapCenter = randomFieldX(player, 90);
  const gapWidth = randomRange(92, 128);
  const spacing = randomRange(48, 64);
  const speed = randomBaseBulletSpeed(intensity) * randomRange(0.72, 0.96);

  for (let x = player.fieldX + 58; x <= player.fieldX + FIELD_WIDTH - 58; x += spacing) {
    if (Math.abs(x - gapCenter) < gapWidth / 2) continue;
    addBullet(player, x, FIELD_TOP - 12, randomRange(-10, 10), speed, 6, "#c8d2ff", "base", { shape: "spinner" });
  }
}

function spawnAimedStreamBullets(player, intensity) {
  const originX = randomFieldX(player, 64);
  const originY = FIELD_TOP - 12;
  const targetX = player.x + randomRange(-14, 14);
  const targetY = player.y + randomRange(-14, 14);
  const angle = Math.atan2(targetY - originY, targetX - originX);
  const speed = randomBaseBulletSpeed(intensity) * randomRange(0.88, 1.1);

  for (let index = 0; index < 4; index += 1) {
    addBullet(
      player,
      originX - Math.cos(angle) * index * 18,
      originY - Math.sin(angle) * index * 18,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      5.5,
      "#ffb0a8",
      "base",
      { shape: "pill" },
    );
  }
}

function randomFieldX(player, margin) {
  return player.fieldX + margin + Math.random() * (FIELD_WIDTH - margin * 2);
}

function randomBaseBulletSpeed(intensity) {
  return 90 + Math.random() * 90 + intensity * randomRange(8, 18);
}

function addBullet(player, x, y, vx, vy, radius, color, type, options = {}) {
  player.bullets.push({
    id: nextBulletId++,
    x,
    y,
    vx: vx * BULLET_SPEED_SCALE,
    vy: vy * BULLET_SPEED_SCALE,
    radius,
    color,
    type,
    age: 0,
    ...options,
  });
}

function updateBullets(player, delta) {
  for (const bullet of player.bullets) {
    bullet.age += delta;
    bullet.x += bullet.vx * delta;
    bullet.y += bullet.vy * delta;
    if (bullet.x < player.fieldX + 20 || bullet.x > player.fieldX + FIELD_WIDTH - 20) bullet.vx *= -1;
  }
  player.bullets = player.bullets.filter((bullet) => bullet.y < FIELD_BOTTOM + 48);
}

function updateGrazeAndHits(player) {
  if (gameOver || player.lives <= 0) return;

  for (const bullet of player.bullets) {
    const distance = Math.hypot(player.x - bullet.x, player.y - bullet.y);
    if (distance < bullet.radius + HIT_RADIUS && !player.hitInvincible && (player.cpu || playerHitboxEnabled)) {
      logHitDebug(player, bullet, distance);
      if (player.cpu) {
        burst(player.x, player.y, player.color, 12);
        player.invincible = 0.18;
        continue;
      }
      player.lives -= 1;
      player.invincible = HIT_INVINCIBLE_TIME;
      player.combo = 0;
      player.multiplier = 1;
      player.gauge = Math.max(0, player.gauge - 240);
      burst(player.x, player.y, player.color, 16);
      createHitExplosion(player.x, player.y, player.color);
      playExplosionSound();
      break;
    }

    if (distance < bullet.radius + GRAZE_RADIUS && distance > bullet.radius + HIT_RADIUS && !player.grazeIds.has(bullet.id)) {
      player.grazeIds.add(bullet.id);
      player.combo += 1;
      player.comboTimer = 1.05;
      player.multiplier = 1 + Math.floor(player.combo / 5) * 0.5;
      const gaugeGain = Math.round(42 * player.multiplier);
      player.score += 42;
      player.gauge = Math.min(getAttackCost(player) * 3, player.gauge + gaugeGain);
      burst(player.x, player.y, player.color, 3);
      playGrazeSound(player.combo);
      if (player.gauge >= getAttackCost(player) && player.attackCooldown <= 0) {
        tryAutoAttack(player, getOpponent(player));
        player.hitInvincible = player.hitInvincible || player.levelUpInvincible > 0;
      }
    }
  }
}

function logHitDebug(player, bullet, distance) {
  if (!HIT_DEBUG_ENABLED) return;
  const debug = {
    time: elapsedRound.toFixed(3),
    player: player.label,
    invincible: player.invincible.toFixed(4),
    levelUpInvincible: player.levelUpInvincible.toFixed(4),
    hitInvincible: player.hitInvincible,
    level: player.level,
    gauge: Math.round(player.gauge),
    bulletType: bullet.type,
    distance: distance.toFixed(3),
    hitThreshold: (bullet.radius + HIT_RADIUS).toFixed(3),
  };
  lastHitDebug = debug;
  console.warn("HIT DEBUG", debug);
}

function getOpponent(player) {
  return player === players[0] ? players[1] : players[0];
}

function tryAttack(attacker, defender) {
  const attackCost = getAttackCost(attacker);
  if (gameOver || attacker.gauge < attackCost) return;
  attacker.gauge -= attackCost;
  attacker.level += 1;
  attacker.levelUpInvincible = getNextInvincibleTime(attacker.levelUpInvincible);
  attacker.levelUpFlash = 0.42;
  attacker.attackFlash = 0.35;
  attacker.attackCooldown = AUTO_ATTACK_COOLDOWN;
  defender.attackFlash = 0.55;
  playAttackSound();

  const shouldSendBoss = attacker.level >= attacker.nextBossLevel;
  if (shouldSendBoss) {
    attacker.nextBossLevel += BOSS_ATTACK_INTERVAL;
    addBossBullets(defender, attacker.level);
    playBossAttackSound();
  }

  const levelBonus = Math.floor((attacker.level - 1) / 6);
  const waves = 1;
  for (let wave = 0; wave < waves; wave += 1) {
    const center = defender.fieldX + FIELD_WIDTH / 2 + randomRange(-90, 90);
    const y = FIELD_TOP - 36 - wave * 22;
    const attackScale = ATTACK_BULLET_COUNT_SCALE + defeatedBossCount * ATTACK_BULLET_CLEAR_BONUS;
    const count = Math.max(2, Math.ceil((4 + Math.floor(attacker.multiplier) + levelBonus) * attackScale));
    for (let index = 0; index < count; index += 1) {
      const angle = -Math.PI / 2 + (index - (count - 1) / 2) * 0.16;
      const speed = 128 + wave * 12 + Math.random() * 24;
      addBullet(
        defender,
        center,
        y,
        Math.sin(angle) * speed + randomRange(-14, 14),
        Math.cos(angle) * speed + 160,
        7,
        ATTACK_BULLET_COLOR,
        "attack",
      );
    }
  }
}

function getAttackCost(player) {
  return ATTACK_COST + Math.max(0, player.level - 1) * gaugeGrowthPerLevel;
}

function getNextInvincibleTime(currentTime) {
  if (currentTime <= 0) return LEVEL_UP_INVINCIBLE_TIME;
  return Math.min(LEVEL_UP_INVINCIBLE_TIME, currentTime + INVINCIBLE_CHAIN_EXTENSION);
}

function addBossBullets(defender, level) {
  const centerX = defender.fieldX + FIELD_WIDTH / 2;
  const centerY = FIELD_TOP - 28;
  const count = 10 + Math.floor(level / 2);

  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    const speed = 58 + level * 2;
    addBullet(
      defender,
      centerX,
      centerY,
      Math.cos(angle) * speed * 0.55,
      Math.abs(Math.sin(angle)) * speed + 82,
      12,
      "#ffd166",
      "boss",
    );
  }

  for (let index = -2; index <= 2; index += 1) {
    addBullet(defender, centerX + index * 34, centerY - 18, index * 8, 118 + level * 2, 16, "#ff4e8a", "boss");
  }
}

function createLightningBolt(cx, cy, radius, angle, jaggedness) {
  const points = [];
  const segments = 7;
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const distance = radius * progress;
    const offset = index === 0 || index === segments ? 0 : randomRange(-jaggedness, jaggedness);
    const sideAngle = angle + Math.PI / 2;
    points.push({
      x: cx + Math.cos(angle) * distance + Math.cos(sideAngle) * offset,
      y: cy + Math.sin(angle) * distance + Math.sin(sideAngle) * offset,
    });
  }
  return points;
}

function findClosestBullet(player) {
  let closest = null;
  let best = Infinity;
  for (const bullet of player.bullets) {
    if (bullet.y < FIELD_TOP || bullet.y > FIELD_BOTTOM) continue;
    const distance = Math.hypot(player.x - bullet.x, player.y - bullet.y);
    if (distance < best) {
      best = distance;
      closest = bullet;
    }
  }
  return closest;
}

function updateParticles(delta) {
  for (const particle of particles) {
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.life -= delta;
  }
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    if (particles[index].life <= 0) particles.splice(index, 1);
  }
  if (particles.length > MAX_PARTICLES) {
    particles.splice(0, particles.length - MAX_PARTICLES);
  }
}

function burst(x, y, color, count) {
  if (particles.length > MAX_PARTICLES) return;
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomRange(40, 190);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life: randomRange(0.18, 0.55),
    });
  }
}

function createExplosion(x, y, color) {
  for (let index = 0; index < 48; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomRange(90, 420);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: index % 3 === 0 ? "#ffffff" : color,
      life: randomRange(0.35, 1.05),
      size: randomRange(3, 8),
    });
  }
}

function createHitExplosion(x, y, color) {
  for (let index = 0; index < 22; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomRange(70, 240);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: index % 4 === 0 ? "#ffffff" : color,
      life: randomRange(0.22, 0.56),
      size: randomRange(2, 5),
    });
  }
}

function draw() {
  if (currentScreen !== "game") return;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  drawBackground();
  if (isCompactView()) {
    drawCompactGame();
  } else {
    drawField(players[0]);
    drawField(players[1]);
    drawCenterInfo();
    drawBoss();
    drawBossSpawnHint();

    for (const player of players) {
      drawBullets(player);
      drawPlayer(player);
      drawPlayerHud(player);
    }
  }

  if (!isCompactView()) drawParticles();
  drawHitDebug();
  if (paused) drawPaused();
  if (gameOver) drawGameOver();
}

function isCompactView() {
  return window.innerWidth <= 720;
}

function drawCompactGame() {
  withCompactWorldTransform(() => {
    drawField(players[0]);
    drawBoss();
    drawBullets(players[0]);
    drawPlayer(players[0]);
    drawParticles();
  });

  drawPlayerHud(players[0]);
  drawOpponentInfoHud(players[1]);
  drawBossSpawnHint();
  drawCenterInfo();
}

function withCompactWorldTransform(drawCallback) {
  context.save();
  const scale = 1.44;
  const focusX = players[0].fieldX + FIELD_WIDTH / 2;
  const focusY = FIELD_TOP + FIELD_HEIGHT / 2;
  context.translate(WIDTH / 2, HEIGHT / 2 + 24);
  context.scale(scale, scale);
  context.translate(-focusX, -focusY);
  drawCallback();
  context.restore();
}

function drawBoss() {
  if (!boss.active || boss.hp <= 0) return;
  context.save();
  const phase = BOSS_PHASES[boss.phaseIndex];
  const pulse = 0.5 + Math.sin(elapsedRound * 4) * 0.16;
  const flash = boss.flash > 0 ? 1 : 0;

  context.shadowBlur = 30 + flash * 24;
  context.shadowColor = flash ? "#ffffff" : "#ffd166";
  context.fillStyle = flash ? "#ffffff" : phase.color;
  context.strokeStyle = "#ffd166";
  context.lineWidth = 4;
  drawBossShape(phase.shape, boss.x, boss.y, boss.radius + pulse * 5);

  context.shadowBlur = 0;
  context.fillStyle = "#ffd166";
  context.beginPath();
  context.arc(boss.x - 11, boss.y - 5, 5, 0, Math.PI * 2);
  context.arc(boss.x + 11, boss.y - 5, 5, 0, Math.PI * 2);
  context.fill();

  const barWidth = 260;
  const barX = LEFT_X + FIELD_WIDTH / 2 - barWidth / 2;
  const labelX = LEFT_X + FIELD_WIDTH / 2;
  const hpRatio = boss.hp / boss.maxHp;
  context.fillStyle = "rgba(0,0,0,0.46)";
  roundRect(barX, FIELD_TOP + 16, barWidth, 12, 8);
  context.fill();
  context.fillStyle = hpRatio > 0.35 ? "#ffd166" : "#ff4e8a";
  roundRect(barX, FIELD_TOP + 16, barWidth * hpRatio, 12, 8);
  context.fill();
  context.fillStyle = "#f4f7ff";
  context.font = "800 12px system-ui";
  context.textAlign = "center";
  context.fillText(phase.name, labelX, FIELD_TOP + 10);
  context.textAlign = "left";
  context.restore();
}

function drawBossSpawnHint() {
  if (boss.active || clearGame || boss.phaseIndex >= BOSS_PHASES.length) return;
  const nextPhase = BOSS_PHASES[boss.phaseIndex];
  const compact = isCompactView();
  const labelX = compact ? WIDTH / 2 : LEFT_X + FIELD_WIDTH / 2;
  const labelWidth = compact ? 220 : 248;
  const label = compact
    ? `${nextPhase.name} AT LV ${boss.nextSpawnLevel}`
    : `${nextPhase.name} APPEARS AT LV ${boss.nextSpawnLevel}`;
  context.save();
  context.fillStyle = "rgba(0,0,0,0.38)";
  roundRect(labelX - labelWidth / 2, FIELD_TOP + 14, labelWidth, 26, 10);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.78)";
  context.font = "800 12px system-ui";
  context.textAlign = "center";
  context.fillText(label, labelX, FIELD_TOP + 32);
  context.restore();
}

function drawBossShape(shape, x, y, radius) {
  context.beginPath();
  if (shape === "triangle" || shape === "invertedTriangle") {
    for (let index = 0; index < 3; index += 1) {
      const baseAngle = shape === "invertedTriangle" ? Math.PI / 2 : -Math.PI / 2;
      const angle = baseAngle + (Math.PI * 2 * index) / 3;
      const pointX = x + Math.cos(angle) * radius;
      const pointY = y + Math.sin(angle) * radius;
      if (index === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    }
    context.closePath();
  } else if (shape === "star") {
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 10;
      const pointRadius = index % 2 === 0 ? radius : radius * 0.46;
      const pointX = x + Math.cos(angle) * pointRadius;
      const pointY = y + Math.sin(angle) * pointRadius;
      if (index === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    }
    context.closePath();
  } else {
    context.arc(x, y, radius, 0, Math.PI * 2);
  }
  context.fill();
  context.stroke();
}

function drawBackground() {
  const gradient = context.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, "#070a19");
  gradient.addColorStop(1, "#101327");
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.strokeStyle = "rgba(255,255,255,0.045)";
  for (let y = (elapsedRound * 40) % 32; y < HEIGHT; y += 32) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WIDTH, y);
    context.stroke();
  }
}

function drawField(player) {
  context.save();
  context.fillStyle = "rgba(255,255,255,0.035)";
  context.strokeStyle = player.attackFlash > 0 ? player.color : "rgba(255,255,255,0.18)";
  context.lineWidth = player.attackFlash > 0 ? 4 : 2;
  roundRect(player.fieldX, FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT, 18);
  context.fill();
  context.stroke();

  context.fillStyle = "rgba(255,255,255,0.055)";
  for (let y = FIELD_TOP + ((elapsedRound * 70) % 48); y < FIELD_BOTTOM; y += 48) {
    context.fillRect(player.fieldX + 18, y, FIELD_WIDTH - 36, 1);
  }
  context.restore();
}

function drawBullets(player) {
  for (const bullet of player.bullets) {
    context.save();
    if (bullet.type !== "base") {
      context.shadowBlur = 10;
      context.shadowColor = bullet.color;
    }
    context.fillStyle = bullet.color;
    context.beginPath();
    drawBulletShape(bullet);
    context.restore();
  }
}

function drawBulletShape(bullet) {
  const shape = bullet.shape ?? "circle";
  if (shape === "diamond") {
    context.moveTo(bullet.x, bullet.y - bullet.radius * 1.25);
    context.lineTo(bullet.x + bullet.radius, bullet.y);
    context.lineTo(bullet.x, bullet.y + bullet.radius * 1.25);
    context.lineTo(bullet.x - bullet.radius, bullet.y);
    context.closePath();
    context.fill();
    return;
  }
  if (shape === "triangle") {
    context.moveTo(bullet.x, bullet.y - bullet.radius * 1.25);
    context.lineTo(bullet.x + bullet.radius * 1.1, bullet.y + bullet.radius);
    context.lineTo(bullet.x - bullet.radius * 1.1, bullet.y + bullet.radius);
    context.closePath();
    context.fill();
    return;
  }
  if (shape === "square") {
    context.rect(bullet.x - bullet.radius, bullet.y - bullet.radius, bullet.radius * 2, bullet.radius * 2);
    context.fill();
    return;
  }
  if (shape === "star") {
    for (let index = 0; index < 8; index += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 8;
      const radius = index % 2 === 0 ? bullet.radius * 1.35 : bullet.radius * 0.55;
      const x = bullet.x + Math.cos(angle) * radius;
      const y = bullet.y + Math.sin(angle) * radius;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
    return;
  }
  if (shape === "pill") {
    context.ellipse(bullet.x, bullet.y, bullet.radius * 0.75, bullet.radius * 1.45, 0, 0, Math.PI * 2);
    context.fill();
    return;
  }
  if (shape === "line") {
    context.ellipse(bullet.x, bullet.y, bullet.radius * 0.45, bullet.radius * 1.8, bullet.rotation ?? 0, 0, Math.PI * 2);
    context.fill();
    return;
  }
  if (shape === "spinner") {
    const rotation = Math.floor(bullet.age * 24) * 0.35;
    context.ellipse(bullet.x, bullet.y, bullet.radius * 0.65, bullet.radius * 1.35, rotation, 0, Math.PI * 2);
    context.fill();
    return;
  }
  const radius = shape === "smallCircle" ? bullet.radius * 0.82 : bullet.radius;
  context.arc(bullet.x, bullet.y, radius, 0, Math.PI * 2);
  context.fill();
}

function drawPlayer(player) {
  context.save();
  const isLevelInvincible = player.levelUpInvincible > 0;
  context.globalAlpha = player.invincible > 0 && !isLevelInvincible && Math.floor(elapsedRound * 18) % 2 === 0 ? 0.45 : 1;
  if (isLevelInvincible) {
    context.save();
    const invincibleRatio = player.barrierRatio;
    const pulse = 0.55 + Math.sin(elapsedRound * 18) * 0.22;
    const isWarning = player.levelUpInvincible <= INVINCIBLE_WARNING_TIME;
    const warningBlink = isWarning && Math.floor(elapsedRound * 18) % 2 === 0;
    const warningAlpha = warningBlink ? 0.28 : 1;
    context.globalAlpha *= warningAlpha;
    const barrierRadius = INVINCIBLE_RING_INNER_RADIUS + invincibleRatio * INVINCIBLE_RING_INNER_SCALE + pulse * 5;
    const barrierGradient = context.createRadialGradient(player.x, player.y, 0, player.x, player.y, barrierRadius);
    barrierGradient.addColorStop(0, "rgba(105, 247, 255, 0.46)");
    barrierGradient.addColorStop(0.48, "rgba(105, 247, 255, 0.28)");
    barrierGradient.addColorStop(1, "rgba(105, 247, 255, 0.12)");
    context.fillStyle = barrierGradient;
    context.beginPath();
    context.arc(player.x, player.y, barrierRadius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  if (player.levelUpFlash > 0) {
    drawLevelUpLightning(player);
  }
  context.strokeStyle = player.color;
  context.fillStyle = "#ffffff";
  context.shadowBlur = 20;
  context.shadowColor = player.color;
  const bankAmount = Math.abs(player.tilt);
  const bankScale = 1 - bankAmount * 0.48;
  const bankOffset = player.tilt * 4;
  context.translate(player.x, player.y);
  context.scale(bankScale, 1);
  context.beginPath();
  context.moveTo(bankOffset, -14);
  context.lineTo(-10, 12);
  context.lineTo(bankOffset * 0.35, 6);
  context.lineTo(10, 12);
  context.closePath();
  context.stroke();
  context.fill();
  context.scale(1 / bankScale, 1);
  context.translate(-player.x, -player.y);

  context.shadowBlur = 0;
  context.fillStyle = "#ff3355";
  context.strokeStyle = "rgba(255,255,255,0.72)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(player.x, player.y, HIT_MARKER_RADIUS, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawLevelUpLightning(player) {
  context.save();
  const progress = player.levelUpFlash / 0.42;
  const alpha = Math.min(1, progress * 1.4);
  const boltCount = 10;

  context.globalAlpha = alpha;
  context.fillStyle = `rgba(255, 255, 255, ${0.18 * alpha})`;
  context.shadowBlur = 44;
  context.shadowColor = player.color;
  context.beginPath();
  context.arc(player.x, player.y, 34 + (1 - progress) * 34, 0, Math.PI * 2);
  context.fill();

  for (let boltIndex = 0; boltIndex < boltCount; boltIndex += 1) {
    const angle = elapsedRound * 12 + (Math.PI * 2 * boltIndex) / boltCount + randomRange(-0.24, 0.24);
    const radius = randomRange(42, 86);
    const bolt = createLightningBolt(player.x, player.y, radius, angle, 16);

    context.strokeStyle = boltIndex % 2 === 0 ? "#ffffff" : player.color;
    context.lineWidth = boltIndex % 2 === 0 ? 4 : 2.4;
    context.shadowBlur = 24;
    context.shadowColor = player.color;
    context.beginPath();
    context.moveTo(bolt[0].x, bolt[0].y);
    for (const point of bolt.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }

  context.strokeStyle = "#ffffff";
  context.lineWidth = 5;
  context.globalAlpha = alpha * 0.7;
  context.beginPath();
  context.arc(player.x, player.y, 72 - progress * 22, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawPlayerHud(player) {
  if (isCompactView() && !player.cpu) {
    drawCompactPlayerHud(player);
    return;
  }

  const panelX = isCompactView() && !player.cpu ? 44 : player.fieldX;
  const panelY = 18;
  context.fillStyle = "rgba(0,0,0,0.3)";
  roundRect(panelX, panelY, FIELD_WIDTH, 44, 12);
  context.fill();

  context.fillStyle = player.color;
  context.font = "700 16px system-ui";
  context.fillText(player.label, panelX + 16, panelY + 28);

  context.fillStyle = "#f4f7ff";
  context.font = "600 14px system-ui";
  context.fillText(`SCORE ${player.score}`, panelX + 78, panelY + 28);
  context.fillText(`LV ${player.level}`, panelX + 190, panelY + 28);
  context.fillText(`x${player.multiplier.toFixed(1)} / ${player.combo}`, panelX + 250, panelY + 28);
  context.fillText(formatLives(player), panelX + 316, panelY + 28);

  const gaugeWidth = FIELD_WIDTH - 32;
  const attackCost = getAttackCost(player);
  const gaugeRatio = Math.min(1, player.gauge / attackCost);
  context.fillStyle = "rgba(255,255,255,0.14)";
  roundRect(panelX + 16, panelY + 34, gaugeWidth, 5, 5);
  context.fill();
  context.fillStyle = player.gauge >= attackCost ? player.color : "rgba(255,255,255,0.55)";
  roundRect(panelX + 16, panelY + 34, gaugeWidth * gaugeRatio, 5, 5);
  context.fill();

  if (player.gauge >= attackCost) {
    context.fillStyle = player.color;
    context.font = "800 12px system-ui";
    context.fillText("AUTO ATTACK", panelX + 16, panelY + 58);
  } else {
    context.fillStyle = "rgba(255,255,255,0.68)";
    context.font = "700 12px system-ui";
    context.fillText(`GAUGE ${Math.floor(player.gauge)} / ${attackCost}`, panelX + 16, panelY + 58);
  }
}

function drawCompactPlayerHud(player) {
  const visibleLeft = WIDTH / 2 - FIELD_WIDTH / 2;
  const panelY = 18;
  const leftPanelWidth = 150;
  const rightPanelX = WIDTH / 2 + 62;
  const rightPanelWidth = 134;

  context.save();
  context.fillStyle = "rgba(0,0,0,0.42)";
  roundRect(visibleLeft, panelY, leftPanelWidth, 58, 12);
  context.fill();
  roundRect(rightPanelX, panelY, rightPanelWidth, 58, 12);
  context.fill();

  context.fillStyle = player.color;
  context.font = "800 13px system-ui";
  context.fillText(player.label, visibleLeft + 12, panelY + 22);

  context.fillStyle = "#f4f7ff";
  context.font = "700 12px system-ui";
  context.fillText(`SCORE ${player.score}`, visibleLeft + 12, panelY + 42);

  const attackCost = getAttackCost(player);
  const gaugeRatio = Math.min(1, player.gauge / attackCost);
  context.fillStyle = "rgba(255,255,255,0.14)";
  roundRect(visibleLeft + 12, panelY + 48, leftPanelWidth - 24, 5, 5);
  context.fill();
  context.fillStyle = player.gauge >= attackCost ? player.color : "rgba(255,255,255,0.55)";
  roundRect(visibleLeft + 12, panelY + 48, (leftPanelWidth - 24) * gaugeRatio, 5, 5);
  context.fill();

  context.fillStyle = "#f4f7ff";
  context.font = "700 12px system-ui";
  context.fillText(`LV ${player.level}`, rightPanelX + 12, panelY + 22);
  context.fillText(formatLives(player), rightPanelX + 66, panelY + 22);

  context.fillStyle = "rgba(255,255,255,0.72)";
  context.font = "700 11px system-ui";
  context.fillText(`x${player.multiplier.toFixed(1)} / ${player.combo}`, rightPanelX + 12, panelY + 43);
  context.restore();
}

function formatLives(player) {
  if (player.cpu) return "♥∞";
  const filled = "♥".repeat(Math.max(0, player.lives));
  const empty = "♡".repeat(Math.max(0, MAX_LIVES - player.lives));
  return filled + empty;
}

function drawOpponentInfoHud(opponent) {
  const panelX = WIDTH - 244;
  const panelY = 18;
  const panelWidth = 200;
  const attackCost = getAttackCost(opponent);
  const gaugeRatio = Math.min(1, opponent.gauge / attackCost);

  context.save();
  context.fillStyle = "rgba(0,0,0,0.48)";
  roundRect(panelX, panelY, panelWidth, 72, 14);
  context.fill();

  context.fillStyle = opponent.color;
  context.font = "800 13px system-ui";
  context.fillText(`OPPONENT  LV ${opponent.level}`, panelX + 12, panelY + 22);

  context.fillStyle = "rgba(255,255,255,0.16)";
  roundRect(panelX + 12, panelY + 34, panelWidth - 24, 7, 7);
  context.fill();
  context.fillStyle = opponent.color;
  roundRect(panelX + 12, panelY + 34, (panelWidth - 24) * gaugeRatio, 7, 7);
  context.fill();

  context.fillStyle = "rgba(255,255,255,0.72)";
  context.font = "700 12px system-ui";
  context.fillText(`COMBO ${opponent.combo} / GAUGE ${Math.floor(opponent.gauge)} / ${attackCost}`, panelX + 12, panelY + 60);
  context.restore();
}

function drawCenterInfo() {
  context.fillStyle = "rgba(0,0,0,0.34)";
  roundRect(WIDTH / 2 - 48, 24, 96, 50, 16);
  context.fill();
  context.fillStyle = "#f4f7ff";
  context.font = "800 24px system-ui";
  context.textAlign = "center";
  context.fillText(`${Math.floor(elapsedRound)}s`, WIDTH / 2, 56);
  context.textAlign = "left";
}

function drawParticles() {
  for (const particle of particles) {
    context.save();
    context.globalAlpha = Math.max(0, particle.life * 2);
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.size ?? 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function drawGameOver() {
  const winner = getWinner();
  context.fillStyle = "rgba(0,0,0,0.68)";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#f4f7ff";
  context.textAlign = "center";
  context.font = "800 58px system-ui";
  context.fillText(winner, WIDTH / 2, HEIGHT / 2 + (clearGame ? -118 : -28));
  if (!clearGame) {
    context.font = "500 20px system-ui";
    context.fillText("Rキーでリスタート", WIDTH / 2, HEIGHT / 2 + 18);
  }
  context.textAlign = "left";
}

function drawHitDebug() {
  if (!lastHitDebug) return;
  context.save();
  context.fillStyle = "rgba(0,0,0,0.62)";
  roundRect(WIDTH / 2 - 205, HEIGHT - 76, 410, 46, 12);
  context.fill();
  context.fillStyle = "#ffd166";
  context.font = "700 13px system-ui";
  context.textAlign = "center";
  context.fillText(
    `HIT DEBUG  inv:${lastHitDebug.invincible}s  lvInv:${lastHitDebug.levelUpInvincible}s  hitInv:${lastHitDebug.hitInvincible}`,
    WIDTH / 2,
    HEIGHT - 48,
  );
  context.restore();
}

function drawPaused() {
  context.fillStyle = "rgba(0,0,0,0.56)";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#f4f7ff";
  context.textAlign = "center";
  context.font = "800 64px system-ui";
  context.fillText("PAUSED", WIDTH / 2, HEIGHT / 2 - 18);
  context.font = "500 20px system-ui";
  context.fillText("Spaceで再開 / Rでリスタート", WIDTH / 2, HEIGHT / 2 + 26);
  context.textAlign = "left";
}

function getWinner() {
  if (clearGame) return `ALL CLEAR  TIME ${Math.floor(elapsedRound)}s`;
  if (players[0].lives <= 0) return `SCORE ${players[0].score}`;
  return `SCORE ${players[0].score}`;
}

function roundRect(x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function weightedRandom(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

function playGrazeSound(combo) {
  const audio = getAudioContext();

  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gainNode = audio.createGain();
  const pitch = 520 + Math.min(combo, 24) * 18;

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(pitch, now);
  oscillator.frequency.exponentialRampToValueAtTime(pitch * 1.35, now + 0.045);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.045, now + 0.006);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

  oscillator.connect(gainNode);
  gainNode.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.06);
}

function playAttackSound() {
  const audio = getAudioContext();
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gainNode = audio.createGain();

  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(180, now);
  oscillator.frequency.exponentialRampToValueAtTime(760, now + 0.11);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

  oscillator.connect(gainNode);
  gainNode.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.18);
}

function playBossAttackSound() {
  const audio = getAudioContext();
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gainNode = audio.createGain();

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(92, now);
  oscillator.frequency.exponentialRampToValueAtTime(280, now + 0.22);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.11, now + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

  oscillator.connect(gainNode);
  gainNode.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.3);
}

function playBossHitSound() {
  const audio = getAudioContext();
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gainNode = audio.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(380, now);
  oscillator.frequency.exponentialRampToValueAtTime(120, now + 0.08);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.09, now + 0.008);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

  oscillator.connect(gainNode);
  gainNode.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.12);
}

function playExplosionSound() {
  const audio = getAudioContext();
  const now = audio.currentTime;
  const noiseLength = Math.floor(audio.sampleRate * 0.38);
  const buffer = audio.createBuffer(1, noiseLength, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < noiseLength; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / noiseLength);
  }

  const noise = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gainNode = audio.createGain();

  noise.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1200, now);
  filter.frequency.exponentialRampToValueAtTime(90, now + 0.35);
  gainNode.gain.setValueAtTime(0.16, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

  noise.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audio.destination);
  noise.start(now);
  noise.stop(now + 0.4);
}

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}
