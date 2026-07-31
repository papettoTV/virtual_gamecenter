import { createCabinetClient } from "../../realtime/cabinet-client";
import {
  fetchScoreRanking,
  submitRankingEntry,
} from "../../features/ranking/ranking-client";
import {
  capturePlayCredit,
  releasePlayCredit,
  reservePlayCredit,
} from "../../features/platform/platform-client";
import {
  calculateAttackCost,
  calculateNextInvincibleTime,
  LEVEL_UP_INVINCIBLE_TIME,
} from "./core";
import {
  playAttackSound,
  playBossAttackSound,
  playBossHitSound,
  playExplosionSound,
  playGrazeSound,
} from "./audio";

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
const spectatorGameBackButton = document.querySelector("#spectator-game-back");
const cabinetStatusLabel = document.querySelector("#cabinet-status-label");
const cabinetSummary = document.querySelector("#cabinet-summary");
const cabinetDescription = document.querySelector("#cabinet-description");
const cabinetRoleLabel = document.querySelector("#cabinet-role-label");
const cabinetIdLabel = document.querySelector("#cabinet-id-label");
const copyCabinetUrlButton = document.querySelector("#copy-cabinet-url");
const cabinetCopyStatus = document.querySelector("#cabinet-copy-status");
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
const rankingSubmitHeading = document.querySelector("#ranking-submit-heading");
const rankingSubmitList = document.querySelector("#ranking-submit-list");
const rankingResult = document.querySelector("#ranking-result");
const rankingList = document.querySelector("#ranking-list");
const rankingRefresh = document.querySelector("#ranking-refresh");
const challengeRequestButton = document.querySelector("#challenge-request");
const spectatorStatusText = document.querySelector("#spectator-status-text");
const spectatorViewLabel = document.querySelector("#spectator-view-label");
const spectatorSwitchPlayer = document.querySelector("#spectator-switch-player");
const versusStatus = document.querySelector("#versus-status");
const versusOverlay = document.querySelector("#versus-overlay");
const versusEyebrow = document.querySelector("#versus-eyebrow");
const versusTitle = document.querySelector("#versus-title");
const versusMessage = document.querySelector("#versus-message");
const versusCountdown = document.querySelector("#versus-countdown");
const versusPrimary = document.querySelector("#versus-primary");
const versusSecondary = document.querySelector("#versus-secondary");
const versusDanger = document.querySelector("#versus-danger");

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
const MAX_LIVES = 3;
const AUTO_ATTACK_COOLDOWN = 0.45;
const ATTACK_BULLET_COLOR = "#ff4e8a";
const BOSS_ATTACK_INTERVAL = 10;
const BOSS_MAX_HP = 100;
const BOSS_RADIUS = 34;
const BOSS_INVINCIBLE_COST = 0.22;
const BOSS_DAMAGE_COOLDOWN = 0.12;
const BOSS_HIT_STOP_TIME = 0.1;
const BOSS_ATTACK_TELEGRAPH_TIME = 0;
const BOSS_ATTACK_RECOVERY_TIME = 0.7;
const BOSS_ARRIVAL_WAIT_TIME = 2.4;
const BOSS_ARRIVAL_DURATION = 5;
const BOSS_BULLET_SPEED_SCALE = 0.88;
const BOSS_ATTACK_DENSITY_INTERVAL_SCALE = 1.12;
const MAX_ACTIVE_BULLETS_PER_FIELD = 260;
const BULLET_GLOW_REDUCE_THRESHOLD = 140;
const BULLET_GLOW_DISABLE_THRESHOLD = 210;
const BOSS_BONUS_ATTACK_PATTERN = { id: "bonusStream", duration: 4.8, shotInterval: 0.08 };
const BOSS_ATTACK_PATTERNS = [
  { id: "fan", duration: 4.2, shotInterval: 0.48 },
  { id: "aimedBurst", duration: 4, shotInterval: 0.55 },
  { id: "centerPressure", duration: 5, shotInterval: 0.38 },
];
const HIT_INVINCIBLE_TIME = 2.2;
const INVINCIBLE_RING_INNER_RADIUS = 18;
const INVINCIBLE_RING_INNER_SCALE = 28;
const INVINCIBLE_RING_OUTER_RADIUS = 24;
const INVINCIBLE_RING_OUTER_SCALE = 42;
const PLAYER_SPEED_SCALE = 0.75;
const BULLET_SPEED_SCALE = 0.75;
const ATTACK_BULLET_COUNT_SCALE = 0.35;
const ATTACK_BULLET_CLEAR_BONUS = 0.15;
const BASE_BULLET_DENSITY_SCALE = 0.88;
const BASE_BULLET_CLEAR_BONUS = 0.25;
const INVINCIBLE_WARNING_TIME = 0.5;
const MAX_PARTICLES = 180;
const MAX_SNAPSHOT_BUFFERED_BYTES = 256 * 1024;
const MOTION_FRAME_INTERVAL = 0.1;
const KEYFRAME_INTERVAL = 1;
const EVENT_FLUSH_INTERVAL = 0.05;
const SPECTATOR_POSITION_CORRECTION = 18;
const SPECTATOR_BULLET_CORRECTION = 24;
const HIT_DEBUG_ENABLED = false;
const PLAYER_TILT_MAX = 1;
const PLAYER_TILT_LERP = 0.2;
const BOSS_DEFEAT_SLOW_TIME = 2.2;
const BOSS_DEFEAT_SLOW_SCALE = 0.28;
const START_BULLET_DELAY = 2.0;
const HIT_MARKER_RADIUS = 3;
const CLEAR_TIME_BONUS_BASE = 600_000;
const CLIENT_VERSION = "prototype-score-ranking-1";

const BOSS_PHASES = [
  { level: 1, spawnLevel: 10, name: "BOSS LV1", shape: "circle", hp: 100, hitsToDefeat: 12, radius: 44, color: "#18051f" },
  { level: 2, spawnLevel: 20, name: "MID BOSS LV2", shape: "invertedTriangle", hp: 120, hitsToDefeat: 20, radius: 48, color: "#071722" },
  { level: 3, spawnLevel: 30, name: "LAST BOSS LV3", shape: "star", hp: 152, hitsToDefeat: 28, radius: 52, color: "#1c0628" },
];

const keys = new Set();
const particles = [];
const touchMove = { active: false, startX: 0, startY: 0, x: 0, y: 0 };
let bulletDensity = 2;
let playerHitboxEnabled = true;
let gaugeGrowthPerLevel = 30;
let lastHitDebug = null;
let lastTime = performance.now();
let elapsedRound = 0;
let slowMotionTimer = 0;
let bossHitStopTimer = 0;
let defeatedBossCount = 0;
let gameOver = false;
let paused = false;
let waitingForStart = false;
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
let latestViewerKeyframe = null;
let latestViewerMotion = null;
let previousViewerMotion = null;
let pendingViewerEvents = [];
let lastViewerSequence = 0;
let syncSequence = 0;
let motionFrameTimer = 0;
let keyframeTimer = 0;
let eventFlushTimer = 0;
let pendingSyncEvents = [];
let cabinetConnected = false;
let currentCabinetId = null;
let cabinetShareUrl = "";
let pendingCreatedSoloStart = false;
let spectatorPlayerIndex = 0;
let challengeQueueState = {
  waitingCount: 0,
  capacity: 5,
  position: null,
  status: "none",
};
let pendingChallenge = false;
let challengeReservationId = null;
let versusMatchId = null;
let versusSeat = null;
let versusPhase = "none";
let versusUiMode = "none";
let versusStartsAt = 0;
let versusStartedAt = 0;
let versusProgressTimer = 0;
let versusProgressSequence = 0;
let versusTerminalReported = false;
let versusResult = null;
let rematchDeadline = 0;
let rematchTimer = null;
let lastOpponentProgressSequence = 0;

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

const cabinetClient = createCabinetClient({
  onConnectionChange: (connected) => {
    cabinetConnected = connected;
    updateCabinetUi();
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
  bossHitStopTimer = 0;
  defeatedBossCount = 0;
  gameOver = false;
  paused = true;
  waitingForStart = true;
  updatePauseButton();
  clearGame = false;
  lastClearResult = null;
  rankingSubmittedForClear = false;
  debugRankingPreviewShown = false;
  rankingSubmitPanel?.classList.remove("is-visible");
  rankingSubmitPanel?.classList.remove("is-submitted");
  updateRankingSubmitState();
  resetBossProgress();
  resetOpponentBossProgress();
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
  boss.encounterState = "idle";
  boss.arrivalTimer = 0;
  boss.arrivalProgress = 0;
  boss.shieldAttackCharges = 0;
  boss.bonusUsed = false;
  boss.bonusPending = false;
  boss.bonusActive = false;
  boss.bonusStreamX = LEFT_X + FIELD_WIDTH / 2;
  boss.shieldHitsTaken = 0;
  boss.movementTime = 0;
  resetBossAttackState();
}

function resetOpponentBossProgress() {
  opponentBoss.active = false;
  opponentBoss.phaseIndex = 0;
  opponentBoss.nextSpawnLevel = BOSS_PHASES[0].spawnLevel;
  opponentBoss.x = RIGHT_X + FIELD_WIDTH / 2;
  opponentBoss.baseY = FIELD_TOP + FIELD_HEIGHT * 0.38;
  opponentBoss.y = opponentBoss.baseY;
  opponentBoss.radius = BOSS_PHASES[0].radius;
  opponentBoss.hp = 0;
  opponentBoss.maxHp = BOSS_PHASES[0].hp;
  opponentBoss.flash = 0;
  opponentBoss.encounterState = "idle";
  opponentBoss.arrivalProgress = 0;
}

function scheduleBossPhase(phaseIndex) {
  const phase = BOSS_PHASES[phaseIndex];
  boss.active = false;
  boss.phaseIndex = phaseIndex;
  boss.x = LEFT_X + FIELD_WIDTH / 2;
  boss.baseY = FIELD_TOP + FIELD_HEIGHT * 0.38;
  boss.y = boss.baseY;
  boss.radius = phase.radius;
  boss.hp = phase.hp;
  boss.maxHp = phase.hp;
  boss.damageCooldown = 0;
  boss.flash = 0;
  boss.encounterState = "waiting";
  boss.arrivalTimer = BOSS_ARRIVAL_WAIT_TIME;
  boss.arrivalProgress = 0;
  boss.shieldAttackCharges = 0;
  boss.bonusUsed = false;
  boss.bonusPending = false;
  boss.bonusActive = false;
  boss.bonusStreamX = boss.x;
  boss.shieldHitsTaken = 0;
  boss.movementTime = 0;
  resetBossAttackState();
  queueSyncEvent({ type: "bossState", boss: createBossSyncState() }, true);
}

function startBossEntrance() {
  boss.active = true;
  boss.encounterState = "entering";
  boss.arrivalTimer = BOSS_ARRIVAL_DURATION;
  boss.arrivalProgress = 0;
  boss.flash = 0;
  playBossAttackSound();
  queueSyncEvent({ type: "bossState", boss: createBossSyncState() }, true);
}

function completeBossEntrance() {
  boss.encounterState = "active";
  boss.arrivalTimer = 0;
  boss.arrivalProgress = 1;
  boss.flash = 0.65;
  boss.shieldAttackCharges = 0;
  boss.movementTime = 0;
  resetBossAttackState();
  queueSyncEvent({ type: "bossState", boss: createBossSyncState() }, true);
}

function resetBossAttackState() {
  boss.attackState = "telegraph";
  boss.attackPatternIndex = 0;
  boss.attackTimer = BOSS_ATTACK_TELEGRAPH_TIME;
  boss.attackShotTimer = 0;
  boss.attackStep = 0;
  boss.attackTargetX = players[0]?.x ?? LEFT_X + FIELD_WIDTH / 2;
  boss.attackTargetY = players[0]?.y ?? FIELD_BOTTOM - 58;
}

function isBossEncounterInProgress() {
  return boss.encounterState !== "idle";
}

resetGame();
syncScreenWithUrl();

if (selectGameButton) {
  selectGameButton.addEventListener("click", () => {
    enterCabinet(createCabinetId());
  });
}

window.addEventListener("create-solo-cabinet", () => {
  pendingCreatedSoloStart = true;
  enterCabinet(createCabinetId());
});

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
    returnToCabinet();
  });
}

if (spectatorGameBackButton) {
  spectatorGameBackButton.addEventListener("click", () => {
    returnToCabinet();
  });
}

if (startSoloButton) {
  startSoloButton.addEventListener("click", () => {
    startSoloPlay();
  });
}

if (challengeRequestButton) {
  challengeRequestButton.addEventListener("click", () => {
    openChallengeAction();
  });
}

spectatorSwitchPlayer?.addEventListener("click", () => {
  spectatorPlayerIndex = spectatorPlayerIndex === 0 ? 1 : 0;
  updateSpectatorViewSwitch();
});
window.addEventListener("resize", updateSpectatorViewSwitch);

versusPrimary?.addEventListener("click", () => handleVersusUiAction("primary"));
versusSecondary?.addEventListener("click", () => handleVersusUiAction("secondary"));
versusDanger?.addEventListener("click", () => handleVersusUiAction("danger"));

if (copyCabinetUrlButton) {
  copyCabinetUrlButton.addEventListener("click", copyCabinetUrl);
}

window.addEventListener("popstate", syncScreenWithUrl);

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
      rankingSubmitPanel?.classList.remove("is-submitted");
      updateRankingSubmitState();
    }
  });
}

if (gaugeGrowthDown && gaugeGrowthUp && gaugeGrowthValue && gaugeGrowthLabel) {
  gaugeGrowthDown.addEventListener("click", () => updateGaugeGrowth(-5));
  gaugeGrowthUp.addEventListener("click", () => updateGaugeGrowth(5));
}

canvas.addEventListener("pointerdown", (event) => {
  if (isCompactView() && (cabinetRole !== "spectator" || isVersusParticipant())) {
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
    if (cabinetRole !== "spectator" && !isVersusParticipant()) resetGame();
  });
}

if (clearRestart) {
  clearRestart.addEventListener("click", () => {
    if (cabinetRole !== "spectator" && !isVersusParticipant()) resetGame();
  });
}

if (touchPause) {
  touchPause.addEventListener("click", () => {
    if (cabinetRole === "spectator" && !isVersusParticipant()) return;
    togglePauseState();
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

async function requestVersusChallenge() {
  if (!currentCabinetId || cabinetRole !== "spectator" || challengeReservationId) return;
  if (challengeRequestButton) {
    challengeRequestButton.disabled = true;
    challengeRequestButton.textContent = "クレジット予約中…";
  }
  try {
    const reservation = await reservePlayCredit(currentCabinetId, "challenge");
    challengeReservationId = reservation.reservationId;
    window.dispatchEvent(new Event("platform-wallet-changed"));
    cabinetClient.send({
      type: "requestChallenge",
      reservationId: reservation.reservationId,
    });
    if (spectatorStatusText) spectatorStatusText.textContent = "対戦申し込みを送信しています。";
    updateChallengeButton();
  } catch {
    if (spectatorStatusText) spectatorStatusText.textContent = "クレジットを予約できませんでした。";
    challengeReservationId = null;
    updateChallengeButton();
  }
}

function openChallengeAction() {
  if (challengeQueueState.status === "pending" || challengeQueueState.status === "queued") {
    const queueLabel = challengeQueueState.status === "queued"
      ? `現在、あと${challengeQueueState.position}番目です。`
      : "現在、対戦承認待ちです。";
    showVersusOverlay(
      "対戦申し込みをキャンセルしますか？",
      `${queueLabel} 仮消費したクレジットは返却されます。`,
      "challengeCancelConfirm",
    );
    return;
  }
  if (challengeQueueState.status !== "none") return;
  showVersusOverlay(
    "対戦を申し込みますか？",
    `現在の対戦申し込み待ちは${challengeQueueState.waitingCount}人です。申し込み時に1クレジットを仮消費します。`,
    "challengeJoinConfirm",
  );
}

async function releaseVersusReservation(reservationId) {
  if (!reservationId) return;
  try {
    await releasePlayCredit(reservationId);
    window.dispatchEvent(new Event("platform-wallet-changed"));
  } catch {
    if (spectatorStatusText) spectatorStatusText.textContent = "クレジット状態を再読み込みしてください。";
  }
  if (challengeReservationId === reservationId) challengeReservationId = null;
}

async function captureVersusReservation(reservationId) {
  if (!reservationId) return;
  try {
    await capturePlayCredit(reservationId);
    window.dispatchEvent(new Event("platform-wallet-changed"));
  } catch {
    showVersusOverlay("Credit Error", "クレジットを確定できませんでした。再読み込みしてください。", "notice");
  }
  if (challengeReservationId === reservationId) challengeReservationId = null;
}

function handleVersusUiAction(action) {
  if (versusUiMode === "notice" && action === "secondary") {
    hideVersusOverlay();
    return;
  }
  if (versusUiMode === "challengeApproval") {
    cabinetClient.send({ type: "respondChallenge", accept: action === "primary" });
    hideVersusOverlay();
    if (action !== "primary") pendingChallenge = false;
    return;
  }
  if (versusUiMode === "challengeJoinConfirm") {
    if (action === "primary") void requestVersusChallenge();
    hideVersusOverlay();
    return;
  }
  if (versusUiMode === "challengeCancelConfirm") {
    if (action === "danger") {
      cabinetClient.send({ type: "cancelChallenge" });
      showVersusOverlay("キャンセル中", "対戦申し込みを取り消しています。", "waiting");
    } else if (action === "secondary") {
      hideVersusOverlay();
    }
    return;
  }
  if (versusUiMode === "ready" && action === "primary" && versusMatchId) {
    cabinetClient.send({ type: "versusReady", matchId: versusMatchId });
    showVersusOverlay("Ready", "相手のOKを待っています。", "waiting");
    return;
  }
  if (versusUiMode === "resultLoser") {
    if (action === "primary") void requestVersusRematch();
    else if (action === "secondary" && versusMatchId) {
      cabinetClient.send({ type: "declineRematch", matchId: versusMatchId });
    }
    return;
  }
  if (versusUiMode === "rematchWinner") {
    if (action === "primary" && versusMatchId) {
      cabinetClient.send({ type: "respondRematch", matchId: versusMatchId, accept: true });
    } else if (action === "secondary") {
      showVersusOverlay("Confirm", "本当に再挑戦を拒否しますか？", "rematchRejectConfirm");
    }
    return;
  }
  if (versusUiMode === "rematchRejectConfirm") {
    if (action === "danger" && versusMatchId) {
      cabinetClient.send({ type: "respondRematch", matchId: versusMatchId, accept: false });
    } else if (action === "secondary") {
      showVersusOverlay("Rematch", "相手が再挑戦を希望しています。", "rematchWinner");
    }
  }
}

async function requestVersusRematch() {
  if (!currentCabinetId || !versusMatchId || challengeReservationId) return;
  try {
    const reservation = await reservePlayCredit(currentCabinetId, "rematch");
    challengeReservationId = reservation.reservationId;
    window.dispatchEvent(new Event("platform-wallet-changed"));
    cabinetClient.send({
      type: "requestRematch",
      matchId: versusMatchId,
      reservationId: reservation.reservationId,
    });
    showVersusOverlay("Rematch", "再挑戦の承認を待っています。", "waiting");
  } catch {
    showVersusOverlay("Credit Error", "再挑戦用クレジットを予約できませんでした。", "resultLoser");
  }
}

function showVersusOverlay(title, message, mode) {
  versusUiMode = mode;
  versusOverlay?.classList.remove("is-hidden");
  if (versusEyebrow) versusEyebrow.textContent = mode === "resultLoser" || mode === "resultWinner" ? "Result" : "Versus";
  if (versusTitle) versusTitle.textContent = title;
  if (versusMessage) versusMessage.textContent = message;
  versusCountdown?.classList.add("is-hidden");
  versusPrimary?.classList.toggle(
    "is-hidden",
    !["challengeApproval", "challengeJoinConfirm", "ready", "resultLoser", "rematchWinner"].includes(mode),
  );
  versusSecondary?.classList.toggle(
    "is-hidden",
    ![
      "challengeApproval",
      "challengeJoinConfirm",
      "challengeCancelConfirm",
      "resultLoser",
      "rematchWinner",
      "rematchRejectConfirm",
      "notice",
    ].includes(mode),
  );
  versusDanger?.classList.toggle(
    "is-hidden",
    !["challengeCancelConfirm", "rematchRejectConfirm"].includes(mode),
  );
  if (versusPrimary) {
    const labels = {
      challengeApproval: "はい",
      challengeJoinConfirm: "申し込む",
      ready: "OK",
      resultLoser: "1クレジットで再挑戦",
      rematchWinner: "承諾する",
    };
    versusPrimary.textContent = labels[mode] ?? "OK";
  }
  if (versusSecondary) {
    const labels = {
      challengeApproval: "いいえ",
      challengeJoinConfirm: "やめる",
      challengeCancelConfirm: "戻る",
      resultLoser: "再挑戦しない",
      rematchWinner: "拒否する",
      rematchRejectConfirm: "戻る",
      notice: "閉じる",
    };
    versusSecondary.textContent = labels[mode] ?? "閉じる";
  }
  if (versusDanger) {
    versusDanger.textContent = mode === "challengeCancelConfirm" ? "申し込みを取り消す" : "拒否する";
  }
}

function hideVersusOverlay() {
  versusUiMode = "none";
  versusOverlay?.classList.add("is-hidden");
}

function showScreen(screen) {
  currentScreen = screen;
  document.body.classList.toggle("is-game-screen", screen === "game");
  arcadeScreen?.classList.toggle("is-hidden", screen !== "arcade");
  cabinetScreen?.classList.toggle("is-hidden", screen !== "cabinet");
  gameScreen?.classList.toggle("is-hidden", screen !== "game");
}

function createCabinetId() {
  const randomBytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(randomBytes);
  } else {
    for (let index = 0; index < randomBytes.length; index += 1) {
      randomBytes[index] = Math.floor(Math.random() * 256);
    }
  }
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40;
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80;
  const hex = [...randomBytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function enterCabinet(cabinetId, updateUrl = true) {
  if (!cabinetId) return;
  if (currentCabinetId && currentCabinetId !== cabinetId) cabinetClient.leave();
  currentCabinetId = cabinetId;
  cabinetRole = "joining";
  cabinetConnected = false;
  cabinetState = null;
  resetViewerSyncState();
  if (updateUrl) history.pushState({ cabinetId }, "", `/cabinets/${cabinetId}`);
  if (cabinetIdLabel) cabinetIdLabel.textContent = `Cabinet ${cabinetId.slice(0, 8)}`;
  updateCabinetShareUrl();
  updateCabinetUi();
  showScreen("cabinet");
  cabinetClient.join(cabinetId);
}

function startSoloPlay() {
  if (!cabinetConnected) {
    cabinetRole = "joining";
    updateCabinetUi();
    cabinetClient.join(currentCabinetId);
    return;
  }
  if (cabinetRole === "spectator") {
    startSpectating();
    return;
  }
  if (cabinetRole !== "player") return;
  resetGame();
  gameSessionActive = true;
  document.body.classList.remove("is-cabinet-spectator");
  document.body.classList.remove("is-spectator");
  spectatorBanner?.classList.add("is-hidden");
  resetHostSyncState();
  cabinetClient.send({ type: "startSolo" });
  broadcastGameKeyframe(true);
  lastTime = performance.now();
  showScreen("game");
}

function startSpectating() {
  resetGame();
  spectatorPlayerIndex = 0;
  gameSessionActive = true;
  document.body.classList.remove("is-cabinet-spectator");
  document.body.classList.add("is-spectator");
  spectatorBanner?.classList.remove("is-hidden");
  if (latestViewerKeyframe) applyViewerSnapshot(latestViewerKeyframe);
  for (const event of pendingViewerEvents) applyViewerEvent(event);
  pendingViewerEvents = [];
  if (latestViewerMotion) applyViewerMotion(latestViewerMotion, previousViewerMotion);
  lastTime = performance.now();
  showScreen("game");
  updateSpectatorViewSwitch();
}

function returnToCabinet() {
  if (isVersusParticipant()) {
    showVersusOverlay("対戦中", "対戦終了後に筐体画面へ戻れます。", "notice");
    return;
  }
  if (pendingChallenge && cabinetRole === "player") {
    showVersusOverlay("対戦申込あり", "対戦申込に回答してから筐体画面へ戻ってください。", "notice");
    return;
  }
  if (challengeReservationId && cabinetRole === "spectator") {
    cabinetClient.send({ type: "cancelChallenge" });
  }
  gameSessionActive = false;
  paused = false;
  waitingForStart = false;
  resetTouchMove();
  rankingSubmitPanel?.classList.remove("is-visible");
  rankingSubmitPanel?.classList.remove("is-submitted");
  if (cabinetRole === "player") cabinetClient.send({ type: "stopSolo" });
  document.body.classList.remove("is-spectator");
  document.body.classList.remove("is-cabinet-spectator");
  spectatorBanner?.classList.add("is-hidden");
  if (touchPause) touchPause.textContent = "一時停止";
  updateCabinetUi();
  showScreen("cabinet");
}

function leaveCabinet(updateUrl = true) {
  cabinetClient.leave();
  currentCabinetId = null;
  cabinetRole = "visitor";
  cabinetConnected = false;
  cabinetState = null;
  resetViewerSyncState();
  gameSessionActive = false;
  paused = false;
  waitingForStart = false;
  document.body.classList.remove("is-spectator");
  spectatorBanner?.classList.add("is-hidden");
  if (touchPause) touchPause.textContent = "一時停止";
  if (updateUrl) history.pushState({}, "", "/");
  if (cabinetSummary) cabinetSummary.textContent = "新しい筐体を作成 / Free Play";
  showScreen("arcade");
}

function syncScreenWithUrl() {
  const cabinetId = getCabinetIdFromPath();
  if (cabinetId) {
    enterCabinet(cabinetId, false);
    return;
  }
  if (currentCabinetId) leaveCabinet(false);
  else showScreen("arcade");
}

function getCabinetIdFromPath() {
  const match = window.location.pathname.match(/^\/cabinets\/([a-zA-Z0-9-]+)\/?$/);
  return match?.[1] ?? null;
}

async function updateCabinetShareUrl() {
  if (!currentCabinetId) return;
  let shareOrigin = window.location.origin;
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    try {
      const response = await fetch("/api/local-address");
      if (response.ok) {
        const localAddress = await response.json();
        shareOrigin = `http://${localAddress.address}:${localAddress.port}`;
      }
    } catch {
      shareOrigin = window.location.origin;
    }
  }
  cabinetShareUrl = `${shareOrigin}/cabinets/${currentCabinetId}`;
}

async function copyCabinetUrl() {
  if (!cabinetShareUrl) return;
  try {
    await navigator.clipboard.writeText(cabinetShareUrl);
  } catch {
    const copyTarget = document.createElement("textarea");
    copyTarget.value = cabinetShareUrl;
    copyTarget.setAttribute("readonly", "");
    copyTarget.style.position = "fixed";
    copyTarget.style.opacity = "0";
    document.body.append(copyTarget);
    copyTarget.select();
    document.execCommand("copy");
    copyTarget.remove();
  }
  if (cabinetCopyStatus) cabinetCopyStatus.textContent = "コピーしました。同じWi-Fiの端末で開けます。";
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
    if (pendingCreatedSoloStart && message.role === "player") {
      pendingCreatedSoloStart = false;
      window.setTimeout(() => startSoloButton?.click(), 0);
    }
    return;
  }

  if (message.type === "challengePending") {
    challengeReservationId = message.reservationId;
    challengeQueueState = {
      ...challengeQueueState,
      position: null,
      status: "pending",
    };
    if (spectatorStatusText) spectatorStatusText.textContent = "対戦承認待ちです。観戦を続けられます。";
    hideVersusOverlay();
    updateChallengeButton();
    return;
  }

  if (message.type === "challengeQueued") {
    challengeReservationId = message.reservationId;
    challengeQueueState = {
      ...challengeQueueState,
      waitingCount: message.waitingCount,
      position: message.position,
      status: "queued",
    };
    if (spectatorStatusText) {
      spectatorStatusText.textContent = `あと${message.position}番目で対戦スタートです。`;
    }
    hideVersusOverlay();
    updateChallengeButton();
    return;
  }

  if (message.type === "challengeQueueStatus") {
    challengeQueueState = message;
    updateChallengeButton();
    return;
  }

  if (message.type === "challengeReceived") {
    pendingChallenge = true;
    versusStatus?.classList.remove("is-hidden");
    showChallengeApprovalIfStopped();
    return;
  }

  if (message.type === "challengeRejected") {
    void releaseVersusReservation(message.reservationId);
    pendingChallenge = false;
    challengeQueueState = {
      ...challengeQueueState,
      position: null,
      status: "none",
    };
    versusStatus?.classList.add("is-hidden");
    if (spectatorStatusText) spectatorStatusText.textContent = `${message.reason} 観戦を続けられます。`;
    updateChallengeButton();
    hideVersusOverlay();
    return;
  }

  if (message.type === "challengeAccepted") {
    versusMatchId = message.matchId;
    versusSeat = message.seat;
    versusPhase = "accepted";
    pendingChallenge = false;
    challengeQueueState = {
      ...challengeQueueState,
      position: null,
      status: "matched",
    };
    versusStatus?.classList.add("is-hidden");
    if (message.reservationId) void captureVersusReservation(message.reservationId);
    showVersusOverlay("対戦承諾", "2秒後にReady確認へ進みます。", "waiting");
    window.setTimeout(() => prepareVersusReady(message.matchId), 2000);
    return;
  }

  if (message.type === "versusReadyState" && message.matchId === versusMatchId) {
    const ownReady = versusSeat === "host" ? message.hostReady : message.challengerReady;
    const opponentReady = versusSeat === "host" ? message.challengerReady : message.hostReady;
    if (ownReady && !opponentReady) showVersusOverlay("Ready", "相手のOKを待っています。", "waiting");
    return;
  }

  if (message.type === "versusCountdown" && message.matchId === versusMatchId) {
    beginVersusCountdown(message.startsAt);
    return;
  }

  if (message.type === "versusOpponentProgress" && message.matchId === versusMatchId) {
    if (message.seq <= lastOpponentProgressSequence) return;
    lastOpponentProgressSequence = message.seq;
    applyVersusOpponentProgress(message.progress);
    return;
  }

  if (message.type === "versusAttack" && message.matchId === versusMatchId) {
    applyVersusAttack(message.level, message.bossAttack);
    return;
  }

  if (message.type === "versusClearWaiting" && message.matchId === versusMatchId) {
    if (versusTerminalReported) {
      versusPhase = "clearWaiting";
      showVersusOverlay("CLEAR", "相手のゲーム終了を待っています。", "waiting");
    } else {
      versusStatus?.classList.remove("is-hidden");
      if (versusStatus) versusStatus.textContent = "相手はクリア済みです。ゲーム終了まで対戦を続けます。";
    }
    return;
  }

  if (message.type === "versusResult" && message.matchId === versusMatchId) {
    versusStatus?.classList.add("is-hidden");
    showVersusResult(message);
    return;
  }

  if (message.type === "rematchRequested" && message.matchId === versusMatchId) {
    rematchDeadline = message.deadline;
    showVersusOverlay("Rematch", "相手が再挑戦を希望しています。", "rematchWinner");
    return;
  }

  if (message.type === "rematchRejected" && message.matchId === versusMatchId) {
    void releaseVersusReservation(message.reservationId);
    showVersusOverlay("Rejected", "再挑戦を拒否されました。", "waiting");
    return;
  }

  if (message.type === "roleChanged") {
    cabinetRole = message.role;
    updateCabinetUi();
    return;
  }

  if (message.type === "versusEnded" && message.matchId === versusMatchId) {
    finishVersusLocally(message.nextRole, message.reason);
    return;
  }

  if (message.type === "viewerKeyframe") {
    if (message.seq <= lastViewerSequence) return;
    lastViewerSequence = message.seq;
    latestViewerKeyframe = message.snapshot;
    pendingViewerEvents = [];
    if (cabinetRole === "spectator" && !isVersusParticipant() && currentScreen === "game") {
      applyViewerSnapshot(message.snapshot);
    }
    return;
  }

  if (message.type === "viewerEvents") {
    if (message.seq <= lastViewerSequence) return;
    lastViewerSequence = message.seq;
    if (cabinetRole === "spectator" && !isVersusParticipant() && currentScreen === "game") {
      for (const event of message.events) applyViewerEvent(event);
    } else if (!isVersusParticipant()) {
      pendingViewerEvents.push(...message.events);
    }
    return;
  }

  if (message.type === "viewerMotionFrame") {
    if (message.seq <= lastViewerSequence) return;
    lastViewerSequence = message.seq;
    previousViewerMotion = latestViewerMotion;
    latestViewerMotion = message.frame;
    if (cabinetRole === "spectator" && !isVersusParticipant() && currentScreen === "game") {
      applyViewerMotion(message.frame, previousViewerMotion);
    }
    return;
  }

  if (message.type === "playerLeft" && cabinetRole === "spectator") {
    gameSessionActive = false;
    resetViewerSyncState();
    showScreen("cabinet");
    if (cabinetRoleLabel) cabinetRoleLabel.textContent = "プレイヤーが筐体を離れました。";
    return;
  }

  if (message.type === "error" && cabinetRoleLabel) cabinetRoleLabel.textContent = message.message;
}

function showChallengeApprovalIfStopped() {
  if (!pendingChallenge || cabinetRole !== "player") return;
  if (paused || gameOver || clearGame) {
    showVersusOverlay("対戦を受けますか？", "対戦を開始すると現在のソロプレイは終了します。", "challengeApproval");
  }
}

function prepareVersusReady(matchId) {
  if (versusMatchId !== matchId) return;
  resetGame();
  gameSessionActive = true;
  versusPhase = "ready";
  players[0].label = "YOU";
  players[1].label = "RIVAL";
  players[1].cpu = false;
  document.body.classList.remove("is-spectator");
  spectatorBanner?.classList.add("is-hidden");
  showScreen("game");
  showVersusOverlay("Ready?", "OKを押すと相手の準備完了を待ちます。", "ready");
}

function beginVersusCountdown(startsAt) {
  versusPhase = "countdown";
  versusStartsAt = startsAt;
  showVersusOverlay("Battle Start", "", "countdown");
  versusCountdown?.classList.remove("is-hidden");
  const updateCountdown = () => {
    if (versusPhase !== "countdown") return;
    const remaining = Math.max(0, versusStartsAt - Date.now());
    const count = Math.ceil(remaining / 1000);
    if (versusCountdown) versusCountdown.textContent = count > 0 ? String(count) : "0";
    if (remaining <= 0) {
      startVersusGameplay();
      return;
    }
    window.setTimeout(updateCountdown, 50);
  };
  updateCountdown();
}

function startVersusGameplay() {
  resetGame();
  players[0].label = "YOU";
  players[1].label = "RIVAL";
  players[1].cpu = false;
  paused = false;
  waitingForStart = false;
  gameOver = false;
  clearGame = false;
  versusPhase = "playing";
  versusStartedAt = performance.now();
  versusProgressTimer = 0;
  versusProgressSequence = 0;
  versusTerminalReported = false;
  lastOpponentProgressSequence = 0;
  hideVersusOverlay();
}

function showVersusResult(message) {
  versusPhase = "result";
  versusResult = message;
  paused = true;
  gameOver = true;
  const won = message.winner === versusSeat;
  const draw = message.winner === "draw";
  const title = draw ? "DRAW" : won ? "WINNER" : "LOSER";
  const description = `${message.reason} ${formatVersusResultScores(message)}`;
  if (draw) {
    showVersusOverlay(title, description, "resultWinner");
    if (versusSeat === "host" && versusMatchId) {
      window.setTimeout(() => {
        if (versusPhase === "result" && versusMatchId) {
          cabinetClient.send({ type: "declineRematch", matchId: versusMatchId });
        }
      }, 3000);
    }
  } else if (won) {
    showVersusOverlay(title, description, "resultWinner");
  } else {
    rematchDeadline = Date.now() + 10000;
    showVersusOverlay(title, `${description} 10秒以内に再挑戦できます。`, "resultLoser");
    startRematchTimer();
  }
}

function formatVersusResultScores(message) {
  const own = versusSeat === "host" ? message.host : message.challenger;
  const opponent = versusSeat === "host" ? message.challenger : message.host;
  return `SCORE ${own?.score ?? 0} - ${opponent?.score ?? 0}`;
}

function startRematchTimer() {
  if (rematchTimer) window.clearInterval(rematchTimer);
  rematchTimer = window.setInterval(() => {
    if (versusPhase !== "result" || !versusMatchId) {
      window.clearInterval(rematchTimer);
      rematchTimer = null;
      return;
    }
    const seconds = Math.max(0, Math.ceil((rematchDeadline - Date.now()) / 1000));
    if (versusMessage) {
      const base = versusMessage.textContent?.replace(/\s残り\d+秒$/, "") ?? "";
      versusMessage.textContent = `${base} 残り${seconds}秒`;
    }
    if (seconds <= 0) {
      window.clearInterval(rematchTimer);
      rematchTimer = null;
      cabinetClient.send({ type: "declineRematch", matchId: versusMatchId });
    }
  }, 250);
}

function finishVersusLocally(nextRole, reason) {
  if (rematchTimer) window.clearInterval(rematchTimer);
  rematchTimer = null;
  versusPhase = "none";
  versusMatchId = null;
  versusSeat = null;
  versusResult = null;
  versusTerminalReported = false;
  players[1].cpu = true;
  hideVersusOverlay();
  cabinetRole = nextRole;
  if (nextRole === "player") {
    startSoloPlay();
  } else {
    document.body.classList.add("is-spectator");
    spectatorBanner?.classList.remove("is-hidden");
    if (spectatorStatusText) spectatorStatusText.textContent = `${reason} 観戦モードに戻りました。`;
    startSpectating();
  }
}

function updateCabinetUi() {
  const statusLabels = {
    empty: "空き",
    occupied: "開始待ち",
    soloPlaying: "ソロプレイ中",
    challengePending: "対戦承認待ち",
    versusReady: "対戦準備中",
    versusPlaying: "対戦中",
    result: "対戦結果",
  };
  const statusLabel = statusLabels[cabinetState?.status] ?? "接続中";
  document.body.classList.toggle("is-cabinet-spectator", cabinetRole === "spectator");
  if (cabinetStatusLabel) cabinetStatusLabel.textContent = statusLabel;
  updateChallengeButton();
  updateSpectatorViewSwitch();
  if (!startSoloButton) return;

  if (!cabinetConnected) {
    startSoloButton.disabled = false;
    startSoloButton.textContent = "再接続する";
    if (cabinetDescription) {
      cabinetDescription.textContent = "筐体サーバーに接続できません。ローカルサーバーのURLから開いてください。";
    }
    if (cabinetRoleLabel) cabinetRoleLabel.textContent = "サーバー未接続";
    return;
  }

  if (cabinetRole === "player") {
    const canStart = cabinetState?.status === "occupied" || cabinetState?.status === "soloPlaying";
    startSoloButton.disabled = !canStart;
    startSoloButton.textContent = canStart ? "ゲームスタート" : statusLabel;
    if (cabinetDescription) {
      cabinetDescription.textContent = "この筐体に着席しています。フリープレイでソロプレイを開始できます。";
    }
    if (cabinetRoleLabel) cabinetRoleLabel.textContent = "あなたがプレイヤーです";
    return;
  }

  if (cabinetRole === "spectator") {
    const canWatch = ["soloPlaying", "challengePending", "versusPlaying"].includes(cabinetState?.status);
    startSoloButton.disabled = !canWatch;
    startSoloButton.textContent = canWatch ? "観戦する" : "プレイ開始を待っています";
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

function updateChallengeButton() {
  if (!challengeRequestButton) return;
  const challengeOpen = [
    "soloPlaying",
    "challengePending",
    "versusReady",
    "versusPlaying",
    "result",
  ].includes(cabinetState?.status);
  const visible =
    cabinetRole === "spectator"
    && !isVersusParticipant()
    && challengeOpen;
  challengeRequestButton.classList.toggle("is-hidden", !visible);
  if (!visible) return;

  if (challengeQueueState.status === "pending") {
    challengeRequestButton.disabled = false;
    challengeRequestButton.textContent = "対戦承認待ち・キャンセル";
    return;
  }
  if (challengeQueueState.status === "queued") {
    challengeRequestButton.disabled = false;
    challengeRequestButton.textContent = `あと${challengeQueueState.position}番目・キャンセル`;
    if (spectatorStatusText) {
      spectatorStatusText.textContent = `あと${challengeQueueState.position}番目で対戦スタートです。`;
    }
    return;
  }

  const full = challengeQueueState.waitingCount >= challengeQueueState.capacity;
  challengeRequestButton.disabled = full || Boolean(challengeReservationId);
  challengeRequestButton.textContent = full
    ? `対戦申し込み待ち満員（${challengeQueueState.capacity}人）`
    : challengeReservationId
      ? "クレジット予約中…"
      : "1クレジットで対戦申込";
}

function isVersusSpectator() {
  return (
    cabinetRole === "spectator"
    && !isVersusParticipant()
    && ["versusPlaying", "result"].includes(cabinetState?.status)
  );
}

function updateSpectatorViewSwitch() {
  const canSwitch = isVersusSpectator() && isCompactView();
  if (!canSwitch) spectatorPlayerIndex = 0;
  spectatorSwitchPlayer?.classList.toggle("is-hidden", !canSwitch);
  if (spectatorSwitchPlayer) {
    spectatorSwitchPlayer.textContent =
      spectatorPlayerIndex === 0 ? "プレイヤーBを見る" : "プレイヤーAを見る";
    spectatorSwitchPlayer.setAttribute("aria-pressed", spectatorPlayerIndex === 1 ? "true" : "false");
  }
  if (spectatorViewLabel) {
    spectatorViewLabel.textContent = canSwitch
      ? `観戦中: プレイヤー${spectatorPlayerIndex === 0 ? "A" : "B"}`
      : "観戦中";
  }
}

function resetHostSyncState() {
  motionFrameTimer = 0;
  keyframeTimer = 0;
  eventFlushTimer = 0;
  pendingSyncEvents = [];
}

function resetViewerSyncState() {
  latestViewerKeyframe = null;
  latestViewerMotion = null;
  previousViewerMotion = null;
  pendingViewerEvents = [];
  lastViewerSequence = 0;
}

function nextSyncSequence() {
  syncSequence += 1;
  return syncSequence;
}

function updateViewerSync(delta) {
  if (cabinetRole !== "player") return;
  motionFrameTimer += delta;
  keyframeTimer += delta;
  eventFlushTimer += delta;

  if (pendingSyncEvents.length > 0 && eventFlushTimer >= EVENT_FLUSH_INTERVAL) {
    flushSyncEvents();
  }
  if (motionFrameTimer >= MOTION_FRAME_INTERVAL) {
    motionFrameTimer %= MOTION_FRAME_INTERVAL;
    broadcastMotionFrame();
  }
  if (keyframeTimer >= KEYFRAME_INTERVAL) {
    keyframeTimer %= KEYFRAME_INTERVAL;
    broadcastGameKeyframe();
  }
}

function broadcastMotionFrame(force = false) {
  if (cabinetRole !== "player") return;
  if (!force && cabinetClient.getBufferedAmount() > MAX_SNAPSHOT_BUFFERED_BYTES) return;
  cabinetClient.send({
    type: "gameMotionFrame",
    seq: nextSyncSequence(),
    frame: createViewerMotionFrame(),
  });
}

function broadcastGameKeyframe(force = false) {
  if (cabinetRole !== "player") return;
  if (!force && cabinetClient.getBufferedAmount() > MAX_SNAPSHOT_BUFFERED_BYTES) return;
  flushSyncEvents();
  cabinetClient.send({
    type: "gameKeyframe",
    seq: nextSyncSequence(),
    snapshot: createViewerSnapshot(),
  });
}

function queueSyncEvent(event, flush = false) {
  if (cabinetRole !== "player" || !gameSessionActive) return;
  pendingSyncEvents.push(event);
  if (flush) flushSyncEvents();
}

function flushSyncEvents() {
  if (cabinetRole !== "player" || pendingSyncEvents.length === 0) {
    eventFlushTimer = 0;
    return;
  }
  const events = pendingSyncEvents;
  pendingSyncEvents = [];
  eventFlushTimer = 0;
  cabinetClient.send({
    type: "gameEvents",
    seq: nextSyncSequence(),
    events,
  });
}

function createViewerSnapshot() {
  return {
    capturedAt: performance.now(),
    elapsedRound,
    gameOver,
    clearGame,
    paused,
    waitingForStart,
    defeatedBossCount,
    players: players.map((player) => ({
      label: player.label,
      color: player.color,
      cpu: player.cpu,
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
        enteredField: bullet.enteredField,
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
      encounterState: boss.encounterState,
      arrivalTimer: boss.arrivalTimer,
      arrivalProgress: boss.arrivalProgress,
      attackState: boss.attackState,
      attackPatternIndex: boss.attackPatternIndex,
      attackTimer: boss.attackTimer,
      attackShotTimer: boss.attackShotTimer,
      attackStep: boss.attackStep,
      attackTargetX: boss.attackTargetX,
      attackTargetY: boss.attackTargetY,
      shieldAttackCharges: boss.shieldAttackCharges,
      bonusUsed: boss.bonusUsed,
      bonusPending: boss.bonusPending,
      bonusActive: boss.bonusActive,
      bonusStreamX: boss.bonusStreamX,
      shieldHitsTaken: boss.shieldHitsTaken,
      movementTime: boss.movementTime,
    },
    opponentBoss: createOpponentBossSyncState(),
  };
}

function createViewerMotionFrame() {
  return {
    capturedAt: performance.now(),
    elapsedRound,
    gameOver,
    clearGame,
    paused,
    waitingForStart,
    defeatedBossCount,
    slowMotionTimer,
    players: players.map(({ bullets: _bullets, grazeIds: _grazeIds, ...player }) => ({
      label: player.label,
      color: player.color,
      cpu: player.cpu,
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
    })),
    boss: createBossSyncState(),
    opponentBoss: createOpponentBossSyncState(),
  };
}

function createBossSyncState() {
  return {
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
    encounterState: boss.encounterState,
    arrivalTimer: boss.arrivalTimer,
    arrivalProgress: boss.arrivalProgress,
    attackState: boss.attackState,
    attackPatternIndex: boss.attackPatternIndex,
    attackTimer: boss.attackTimer,
    attackShotTimer: boss.attackShotTimer,
    attackStep: boss.attackStep,
    attackTargetX: boss.attackTargetX,
    attackTargetY: boss.attackTargetY,
    shieldAttackCharges: boss.shieldAttackCharges,
    bonusUsed: boss.bonusUsed,
    bonusPending: boss.bonusPending,
    bonusActive: boss.bonusActive,
    bonusStreamX: boss.bonusStreamX,
    shieldHitsTaken: boss.shieldHitsTaken,
    movementTime: boss.movementTime,
  };
}

function createOpponentBossSyncState() {
  return {
    active: opponentBoss.active,
    phaseIndex: opponentBoss.phaseIndex,
    nextSpawnLevel: opponentBoss.nextSpawnLevel,
    x: opponentBoss.x,
    y: opponentBoss.y,
    baseY: opponentBoss.baseY,
    radius: opponentBoss.radius,
    hp: opponentBoss.hp,
    maxHp: opponentBoss.maxHp,
    flash: opponentBoss.flash,
    encounterState: opponentBoss.encounterState,
    arrivalProgress: opponentBoss.arrivalProgress,
  };
}

function applyViewerSnapshot(snapshot) {
  elapsedRound = snapshot.elapsedRound;
  gameOver = snapshot.gameOver;
  clearGame = snapshot.clearGame;
  paused = snapshot.paused;
  waitingForStart = snapshot.waitingForStart ?? false;
  updatePauseButton();
  defeatedBossCount = snapshot.defeatedBossCount;
  snapshot.players.forEach((snapshotPlayer, index) => {
    const player = players[index];
    const { bullets, x, y, ...playerState } = snapshotPlayer;
    Object.assign(player, playerState);
    if (!latestViewerMotion) {
      player.x = x;
      player.y = y;
    }
    player.spectatorTargetX = x;
    player.spectatorTargetY = y;
    player.spectatorVx = player.spectatorVx ?? 0;
    player.spectatorVy = player.spectatorVy ?? 0;
    syncSpectatorBullets(player, bullets, player.bullets.length === 0);
  });
  const { x: bossX, y: bossY, ...bossState } = snapshot.boss;
  Object.assign(boss, bossState);
  if (!latestViewerMotion) {
    boss.x = bossX;
    boss.y = bossY;
  }
  boss.spectatorTargetX = bossX;
  boss.spectatorTargetY = bossY;
  boss.spectatorVx = boss.spectatorVx ?? 0;
  boss.spectatorVy = boss.spectatorVy ?? 0;
  applyViewerOpponentBoss(snapshot.opponentBoss);
}

function applyViewerMotion(frame, previousFrame = null) {
  const frameDelta = Math.max(0.001, (frame.capturedAt - (previousFrame?.capturedAt ?? frame.capturedAt)) / 1000);
  elapsedRound = frame.elapsedRound;
  gameOver = frame.gameOver;
  clearGame = frame.clearGame;
  paused = frame.paused;
  waitingForStart = frame.waitingForStart ?? false;
  updatePauseButton();
  defeatedBossCount = frame.defeatedBossCount;
  slowMotionTimer = frame.slowMotionTimer;
  frame.players.forEach((framePlayer, index) => {
    const player = players[index];
    const previousPlayer = previousFrame?.players[index];
    const { x, y, ...playerState } = framePlayer;
    Object.assign(player, playerState);
    player.spectatorTargetX = x;
    player.spectatorTargetY = y;
    player.spectatorVx = previousPlayer ? (x - previousPlayer.x) / frameDelta : 0;
    player.spectatorVy = previousPlayer ? (y - previousPlayer.y) / frameDelta : 0;
  });
  const { x: bossX, y: bossY, ...bossState } = frame.boss;
  const previousBoss = previousFrame?.boss;
  Object.assign(boss, bossState);
  boss.spectatorTargetX = bossX;
  boss.spectatorTargetY = bossY;
  boss.spectatorVx = previousBoss ? (bossX - previousBoss.x) / frameDelta : 0;
  boss.spectatorVy = previousBoss ? (bossY - previousBoss.y) / frameDelta : 0;
  applyViewerOpponentBoss(frame.opponentBoss, previousFrame?.opponentBoss, frameDelta);
}

function applyViewerOpponentBoss(snapshotBoss, previousBoss = null, frameDelta = 1) {
  if (!snapshotBoss) {
    resetOpponentBossProgress();
    return;
  }
  const { x, y, ...bossState } = snapshotBoss;
  Object.assign(opponentBoss, bossState);
  opponentBoss.spectatorTargetX = x;
  opponentBoss.spectatorTargetY = y;
  opponentBoss.spectatorVx = previousBoss ? (x - previousBoss.x) / frameDelta : 0;
  opponentBoss.spectatorVy = previousBoss ? (y - previousBoss.y) / frameDelta : 0;
  if (!latestViewerMotion) {
    opponentBoss.x = x;
    opponentBoss.y = y;
  }
}

function applyViewerEvent(event) {
  if (event.type === "bulletSpawn") {
    const player = players[event.playerIndex];
    if (!player || player.bullets.some((bullet) => bullet.id === event.bullet.id)) return;
    player.bullets.push({
      ...event.bullet,
      spectatorTargetX: event.bullet.x,
      spectatorTargetY: event.bullet.y,
    });
    return;
  }
  if (event.type === "bulletsCleared") {
    for (const player of players) {
      player.bullets = [];
      player.grazeIds.clear();
    }
    return;
  }
  if (event.type === "bossState") {
    const { x, y, ...bossState } = event.boss;
    Object.assign(boss, bossState);
    boss.spectatorTargetX = x;
    boss.spectatorTargetY = y;
    return;
  }
  if (event.type === "bossDefeated") {
    createExplosion(event.x, event.y, event.color);
    return;
  }
  if (event.type === "pauseChanged") {
    paused = event.paused;
    waitingForStart = event.waitingForStart ?? false;
    updatePauseButton();
    return;
  }
  if (event.type === "gameState") {
    gameOver = event.gameOver;
    clearGame = event.clearGame;
    defeatedBossCount = event.defeatedBossCount;
    slowMotionTimer = event.slowMotionTimer;
  }
}

function syncSpectatorBullets(player, snapshotBullets, immediate) {
  const currentBullets = new Map(player.bullets.map((bullet) => [bullet.id, bullet]));
  player.bullets = snapshotBullets.map((snapshotBullet) => {
    const bullet = currentBullets.get(snapshotBullet.id) ?? { ...snapshotBullet };
    const currentX = bullet.x;
    const currentY = bullet.y;
    Object.assign(bullet, snapshotBullet);
    if (!immediate && currentBullets.has(snapshotBullet.id)) {
      bullet.x = currentX;
      bullet.y = currentY;
    }
    bullet.spectatorTargetX = snapshotBullet.x;
    bullet.spectatorTargetY = snapshotBullet.y;
    return bullet;
  });
}

function updateSpectatorView(delta) {
  if (paused) return;
  const correctionRatio = Math.min(1, delta * SPECTATOR_POSITION_CORRECTION);
  const bulletCorrectionRatio = Math.min(1, delta * SPECTATOR_BULLET_CORRECTION);
  if (!gameOver) elapsedRound += delta;

  for (const player of players) {
    player.spectatorTargetX = (player.spectatorTargetX ?? player.x) + (player.spectatorVx ?? 0) * delta;
    player.spectatorTargetY = (player.spectatorTargetY ?? player.y) + (player.spectatorVy ?? 0) * delta;
    player.x += (player.spectatorTargetX - player.x) * correctionRatio;
    player.y += (player.spectatorTargetY - player.y) * correctionRatio;
    player.invincible = Math.max(0, player.invincible - delta);
    player.levelUpInvincible = Math.max(0, player.levelUpInvincible - delta);

    for (const bullet of player.bullets) {
      bullet.spectatorTargetX = (bullet.spectatorTargetX ?? bullet.x) + bullet.vx * delta;
      bullet.spectatorTargetY = (bullet.spectatorTargetY ?? bullet.y) + bullet.vy * delta;
      bullet.x += (bullet.spectatorTargetX - bullet.x) * bulletCorrectionRatio;
      bullet.y += (bullet.spectatorTargetY - bullet.y) * bulletCorrectionRatio;
      bullet.age += delta;
      if (isPointInsidePlayerField(player, bullet.x, bullet.y)) {
        bullet.enteredField = true;
      }
      if (
        bullet.type !== "bossAttack" &&
        (bullet.x < player.fieldX + 20 || bullet.x > player.fieldX + FIELD_WIDTH - 20)
      ) {
        bullet.vx *= -1;
        bullet.spectatorTargetX = bullet.x;
      }
    }
    player.bullets = player.bullets.filter((bullet) => shouldKeepBullet(player, bullet));
  }

  boss.spectatorTargetX = (boss.spectatorTargetX ?? boss.x) + (boss.spectatorVx ?? 0) * delta;
  boss.spectatorTargetY = (boss.spectatorTargetY ?? boss.y) + (boss.spectatorVy ?? 0) * delta;
  boss.x += (boss.spectatorTargetX - boss.x) * correctionRatio;
  boss.y += (boss.spectatorTargetY - boss.y) * correctionRatio;
  opponentBoss.spectatorTargetX =
    (opponentBoss.spectatorTargetX ?? opponentBoss.x) + (opponentBoss.spectatorVx ?? 0) * delta;
  opponentBoss.spectatorTargetY =
    (opponentBoss.spectatorTargetY ?? opponentBoss.y) + (opponentBoss.spectatorVy ?? 0) * delta;
  opponentBoss.x += (opponentBoss.spectatorTargetX - opponentBoss.x) * correctionRatio;
  opponentBoss.y += (opponentBoss.spectatorTargetY - opponentBoss.y) * correctionRatio;
  updateParticles(getGameDelta(delta));
}

window.addEventListener("keydown", (event) => {
  if (cabinetRole === "spectator" && !isVersusParticipant()) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (currentScreen === "game" && !gameOver) {
      togglePauseState();
    }
    return;
  }
  keys.add(event.code);
  if (event.code === "KeyR" && currentScreen === "game" && !isVersusParticipant()) startSoloPlay();
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
  if (cabinetRole === "spectator" && !isVersusParticipant()) {
    updateSpectatorView(delta);
    return;
  }
  if (versusPhase === "playing" || versusPhase === "clearWaiting") {
    updateVersusGame(delta);
    return;
  }
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
    if (!gameOver && !isBossEncounterInProgress()) spawnBaseBullets(player, gameDelta);
    updateBullets(player, gameDelta);
    updateGrazeAndHits(player);
  }

  tryAutoAttack(players[0], players[1]);
  if (!isBossEncounterInProgress()) tryAutoAttack(players[1], players[0]);
  updateBoss(gameDelta);
  updateDebugRankingPreview();

  updateParticles(gameDelta);
  slowMotionTimer = Math.max(0, slowMotionTimer - delta);
  bossHitStopTimer = Math.max(0, bossHitStopTimer - delta);
  updateViewerSync(delta);
  if (gameOver) showChallengeApprovalIfStopped();
}

function updateVersusGame(delta) {
  if (versusPhase === "clearWaiting" || paused || gameOver) {
    updateVersusProgressSync(delta);
    updateViewerSync(delta);
    return;
  }

  elapsedRound += delta;
  const gameDelta = getGameDelta(delta);
  const livesBeforeUpdate = players[0].lives;
  updateHuman(players[0], gameDelta);
  updatePlayerState(players[0], gameDelta);
  if (!isBossEncounterInProgress()) spawnBaseBullets(players[0], gameDelta);
  updateBullets(players[0], gameDelta);
  updateGrazeAndHits(players[0]);
  tryAutoAttack(players[0], players[1]);
  updateBoss(gameDelta);
  updateParticles(gameDelta);
  slowMotionTimer = Math.max(0, slowMotionTimer - delta);
  bossHitStopTimer = Math.max(0, bossHitStopTimer - delta);

  if (players[0].lives < livesBeforeUpdate) {
    reportVersusTerminal("lifeLost");
  }
  updateVersusProgressSync(delta);
  updateViewerSync(delta);
}

function updateVersusProgressSync(delta) {
  if (!versusMatchId || !["playing", "clearWaiting"].includes(versusPhase)) return;
  versusProgressTimer -= delta;
  if (versusProgressTimer > 0) return;
  versusProgressTimer = 0.1;
  versusProgressSequence += 1;
  cabinetClient.send({
    type: "versusProgress",
    matchId: versusMatchId,
    seq: versusProgressSequence,
    progress: createVersusProgress(),
  });
}

function createVersusProgress() {
  const player = players[0];
  return {
    elapsedRound,
    clearGame,
    player: {
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
        enteredField: bullet.enteredField,
      })),
    },
    boss: createBossSyncState(),
  };
}

function applyVersusOpponentProgress(progress) {
  if (!progress?.player) return;
  const offsetX = RIGHT_X - LEFT_X;
  const remotePlayer = progress.player;
  const { bullets = [], x, y, ...playerState } = remotePlayer;
  Object.assign(players[1], playerState);
  players[1].label = "RIVAL";
  players[1].cpu = false;
  players[1].x = x + offsetX;
  players[1].y = y;
  players[1].bullets = bullets.map((bullet) => ({
    ...bullet,
    x: bullet.x + offsetX,
  }));

  if (progress.boss) {
    const defeated = opponentBoss.active && opponentBoss.hp > 0 && (!progress.boss.active || progress.boss.hp <= 0);
    if (defeated) {
      createExplosion(opponentBoss.x, opponentBoss.y, "#ffd166");
      playExplosionSound();
      queueSyncEvent({
        type: "bossDefeated",
        x: opponentBoss.x,
        y: opponentBoss.y,
        color: "#ffd166",
      });
    }
    Object.assign(opponentBoss, progress.boss);
    opponentBoss.x = progress.boss.x + offsetX;
    opponentBoss.baseY = progress.boss.baseY;
    opponentBoss.y = progress.boss.y;
  }
}

function reportVersusTerminal(reason) {
  if (!versusMatchId || versusTerminalReported) return;
  versusTerminalReported = true;
  paused = true;
  const clearTimeMs = reason === "cleared" ? Math.round(elapsedRound * 1000) : null;
  const score = reason === "cleared"
    ? players[0].score + calculateClearTimeBonus(clearTimeMs)
    : players[0].score;
  cabinetClient.send({
    type: "versusTerminal",
    matchId: versusMatchId,
    report: {
      reason,
      score,
      clearTimeMs,
      matchElapsedMs: Math.round(performance.now() - versusStartedAt),
    },
  });
}

function applyVersusAttack(level, bossAttack) {
  if (versusPhase !== "playing") return;
  if (bossAttack) {
    addBossBullets(players[0], level);
    playBossAttackSound();
  }
  addStandardAttackBullets(players[0], level, 1, 0);
  players[0].attackFlash = 0.55;
}

function togglePauseState() {
  if (gameOver) return;
  if (isVersusParticipant()) return;
  if (waitingForStart) {
    waitingForStart = false;
    paused = false;
  } else {
    paused = !paused;
  }
  updatePauseButton();
  queueSyncEvent({ type: "pauseChanged", paused, waitingForStart }, true);
  broadcastMotionFrame(true);
  showChallengeApprovalIfStopped();
}

function isVersusParticipant() {
  return Boolean(versusMatchId && versusSeat && versusPhase !== "none");
}

function updatePauseButton() {
  if (!touchPause) return;
  touchPause.textContent = waitingForStart ? "ゲーム開始" : paused ? "再開" : "一時停止";
}

function getGameDelta(delta) {
  if (bossHitStopTimer > 0) return delta * 0.08;
  return slowMotionTimer > 0 ? delta * BOSS_DEFEAT_SLOW_SCALE : delta;
}

function updateBoss(delta) {
  checkBossSpawn();
  if (boss.encounterState === "waiting") {
    boss.arrivalTimer = Math.max(0, boss.arrivalTimer - delta);
    if (boss.arrivalTimer <= 0) startBossEntrance();
    return;
  }
  if (boss.encounterState === "entering") {
    updateBossEntrance(delta);
    return;
  }
  if (boss.encounterState !== "active" || !boss.active) return;
  updateBossMovement(delta);
  boss.damageCooldown = Math.max(0, boss.damageCooldown - delta);
  boss.flash = Math.max(0, boss.flash - delta);
  if (gameOver || boss.hp <= 0) return;
  updateBossAttack(delta);

  const player = players[0];
  const touchingBoss = Math.hypot(player.x - boss.x, player.y - boss.y) < boss.radius + getInvincibleRingDamageRadius(player);
  const hasUnusedShieldAttack = boss.shieldAttackCharges > 0;
  const waitingForBonusAttack = boss.bonusPending && !boss.bonusActive;
  if (
    !touchingBoss ||
    player.levelUpInvincible <= 0 ||
    !hasUnusedShieldAttack ||
    waitingForBonusAttack ||
    boss.damageCooldown > 0
  ) {
    return;
  }

  const phase = BOSS_PHASES[boss.phaseIndex];
  boss.shieldHitsTaken += 1;
  boss.hp = boss.shieldHitsTaken >= phase.hitsToDefeat
    ? 0
    : boss.maxHp * (1 - boss.shieldHitsTaken / phase.hitsToDefeat);
  boss.shieldAttackCharges -= 1;
  boss.damageCooldown = BOSS_DAMAGE_COOLDOWN;
  boss.flash = 0.14;
  bossHitStopTimer = BOSS_HIT_STOP_TIME;
  if (!boss.bonusUsed && !boss.bonusPending && !boss.bonusActive && boss.hp > 0) {
    boss.bonusPending = true;
    boss.attackTimer = Math.min(boss.attackTimer, 0.7);
  }
  queueSyncEvent({ type: "bossState", boss: createBossSyncState() });
  player.hitInvincible = player.levelUpInvincible > 0 || player.invincible > 0;
  player.score += 250;
  burst(boss.x, boss.y, "#ffd166", 8);
  playBossHitSound();
  if (boss.hp <= 0) {
    handleBossDefeated();
  }
}

function updateBossEntrance(delta) {
  boss.arrivalTimer = Math.max(0, boss.arrivalTimer - delta);
  const progress = 1 - boss.arrivalTimer / BOSS_ARRIVAL_DURATION;
  boss.arrivalProgress = boss.arrivalTimer <= 0 && players[0].levelUpInvincible > 0
    ? 0.94
    : clamp(progress, 0, 1);
  if (boss.arrivalTimer > 0 || players[0].levelUpInvincible > 0) return;
  completeBossEntrance();
}

function updateBossAttack(delta) {
  boss.attackTimer -= delta;

  if (boss.attackState === "telegraph") {
    if (boss.attackTimer > 0) return;
    const pattern = getCurrentBossAttackPattern();
    boss.attackState = "active";
    boss.attackTimer = pattern.duration;
    boss.attackShotTimer = 0;
    boss.attackStep = 0;
    boss.flash = 0.24;
    playBossAttackSound();
    queueSyncEvent({ type: "bossState", boss: createBossSyncState() }, true);
    return;
  }

  if (boss.attackState === "recovery") {
    if (boss.attackTimer > 0) return;
    beginNextBossAttack();
    return;
  }

  const pattern = getCurrentBossAttackPattern();
  boss.attackShotTimer -= delta;
  while (boss.attackShotTimer <= 0 && boss.attackTimer > 0) {
    spawnBossAttackPattern(pattern.id);
    boss.attackShotTimer += getBossAttackShotInterval(pattern);
    boss.attackStep += 1;
  }

  if (boss.attackTimer <= 0) {
    boss.attackState = "recovery";
    boss.attackTimer = BOSS_ATTACK_RECOVERY_TIME;
    boss.attackShotTimer = 0;
    queueSyncEvent({ type: "bossState", boss: createBossSyncState() }, true);
  }
}

function beginNextBossAttack() {
  if (boss.bonusPending) {
    boss.bonusPending = false;
    boss.bonusActive = true;
    boss.bonusUsed = true;
    const player = players[0];
    const fieldCenter = player.fieldX + FIELD_WIDTH / 2;
    const direction = player.x <= fieldCenter ? 1 : -1;
    boss.bonusStreamX = clamp(
      player.x + direction * 24,
      player.fieldX + FIELD_MARGIN + 12,
      player.fieldX + FIELD_WIDTH - FIELD_MARGIN - 12,
    );
  } else {
    if (boss.bonusActive) boss.bonusActive = false;
    boss.attackPatternIndex = (boss.attackPatternIndex + 1) % BOSS_ATTACK_PATTERNS.length;
  }
  boss.attackState = "telegraph";
  boss.attackTimer = BOSS_ATTACK_TELEGRAPH_TIME;
  boss.attackShotTimer = 0;
  boss.attackStep = 0;
  boss.attackTargetX = players[0].x;
  boss.attackTargetY = players[0].y;
  queueSyncEvent({ type: "bossState", boss: createBossSyncState() }, true);
}

function getCurrentBossAttackPattern() {
  return boss.bonusActive ? BOSS_BONUS_ATTACK_PATTERN : BOSS_ATTACK_PATTERNS[boss.attackPatternIndex];
}

function getBossAttackShotInterval(pattern) {
  const firstBossMultiplier = boss.phaseIndex === 0 ? 1.25 : 1;
  const densityMultiplier = pattern.id === "bonusStream" ? 1 : BOSS_ATTACK_DENSITY_INTERVAL_SCALE;
  return pattern.shotInterval * firstBossMultiplier * densityMultiplier;
}

function spawnBossAttackPattern(patternId) {
  if (patternId === "fan") {
    spawnBossFanAttack();
    return;
  }
  if (patternId === "aimedBurst") {
    spawnBossAimedBurst();
    return;
  }
  if (patternId === "centerPressure") {
    spawnBossCenterPressure();
    return;
  }
  spawnBossBonusStream();
}

function spawnBossFanAttack() {
  const phaseScale = 1 + boss.phaseIndex * 0.18;
  const count = [7, 9, 11][boss.phaseIndex];
  const spread = 1.45;
  const speed = 128 * phaseScale * BOSS_BULLET_SPEED_SCALE;
  const originY = boss.y + boss.radius * 0.5;

  for (let index = 0; index < count; index += 1) {
    const ratio = count === 1 ? 0 : index / (count - 1) - 0.5;
    const angle = Math.PI / 2 + ratio * spread;
    addBullet(
      players[0],
      boss.x,
      originY,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      7,
      "#d92b52",
      "bossAttack",
      { shape: "diamond" },
    );
  }
}

function spawnBossAimedBurst() {
  const phaseScale = 1 + boss.phaseIndex * 0.2;
  const angle = Math.atan2(boss.attackTargetY - boss.y, boss.attackTargetX - boss.x);
  const speed = (154 + boss.attackStep * 7) * phaseScale * BOSS_BULLET_SPEED_SCALE;
  const count = [4, 6, 7][boss.phaseIndex];
  const spread = 0.34 + boss.phaseIndex * 0.05;

  for (let index = 0; index < count; index += 1) {
    const ratio = count === 1 ? 0 : index / (count - 1) - 0.5;
    const bulletAngle = angle + ratio * spread;
    addBullet(
      players[0],
      boss.x,
      boss.y + boss.radius * 0.35,
      Math.cos(bulletAngle) * speed,
      Math.sin(bulletAngle) * speed,
      7,
      "#ff6b4a",
      "bossAttack",
      { shape: "line", rotation: bulletAngle - Math.PI / 2 },
    );
  }
}

function spawnBossCenterPressure() {
  const phaseScale = 1 + boss.phaseIndex * 0.18;
  const centerCount = [7, 9, 11][boss.phaseIndex];
  const centerSpread = 0.38;
  const centerSpeed = 148 * phaseScale * BOSS_BULLET_SPEED_SCALE;
  const originY = boss.y + boss.radius * 0.34;

  for (let index = 0; index < centerCount; index += 1) {
    const ratio = centerCount === 1 ? 0 : index / (centerCount - 1) - 0.5;
    const angle = Math.PI / 2 + ratio * centerSpread;
    addBullet(
      players[0],
      boss.x,
      originY,
      Math.cos(angle) * centerSpeed,
      Math.sin(angle) * centerSpeed,
      9,
      "#a62cff",
      "bossAttack",
      { shape: "pill" },
    );
  }

  const edgeSpeed = 164 * phaseScale * BOSS_BULLET_SPEED_SCALE;
  const edgeOffset = Math.sin(boss.attackStep * 0.78) * 16;
  for (const side of [-1, 1]) {
    const targetX =
      side < 0
        ? players[0].fieldX + FIELD_MARGIN + 24 + edgeOffset
        : players[0].fieldX + FIELD_WIDTH - FIELD_MARGIN - 24 - edgeOffset;
    const targetY = FIELD_BOTTOM - 54;
    const angle = Math.atan2(targetY - originY, targetX - boss.x);
    addBullet(
      players[0],
      boss.x + side * boss.radius * 0.16,
      originY,
      Math.cos(angle) * edgeSpeed,
      Math.sin(angle) * edgeSpeed,
      7,
      "#cf78ff",
      "bossAttack",
      { shape: "spinner" },
    );
  }
}

function spawnBossBonusStream() {
  const phaseScale = 1 + boss.phaseIndex * 0.12;
  const originX = boss.x;
  const originY = boss.y + boss.radius * 0.28;
  const targetY = FIELD_BOTTOM - FIELD_MARGIN;
  const angle = Math.atan2(targetY - originY, boss.bonusStreamX - originX);
  const speed = 212 * phaseScale * BOSS_BULLET_SPEED_SCALE;
  addBullet(
    players[0],
    originX,
    originY,
    Math.cos(angle) * speed,
    Math.sin(angle) * speed,
    7,
    "#ffd166",
    "bossAttack",
    { shape: "circle" },
  );
}

function checkBossSpawn() {
  if (isBossEncounterInProgress() || clearGame || boss.phaseIndex >= BOSS_PHASES.length) return;
  if (players[0].level >= boss.nextSpawnLevel) {
    scheduleBossPhase(boss.phaseIndex);
  }
}

function updateBossMovement(delta) {
  const phase = BOSS_PHASES[boss.phaseIndex];
  if (phase.level === 1) return;

  boss.movementTime += delta;
  const minX = LEFT_X + FIELD_MARGIN + boss.radius;
  const maxX = LEFT_X + FIELD_WIDTH - FIELD_MARGIN - boss.radius;
  const centerX = (minX + maxX) / 2;
  const movementEase = smoothstep(clamp(boss.movementTime / 1.5, 0, 1));
  boss.x = centerX + Math.sin(boss.movementTime * 0.55) * ((maxX - minX) / 2) * movementEase;
  boss.y = boss.baseY;

  if (phase.level === 3) {
    boss.y += Math.sin(boss.movementTime * 4.4) * 24 * movementEase;
  }
}

function handleBossDefeated() {
  slowMotionTimer = BOSS_DEFEAT_SLOW_TIME;
  defeatedBossCount += 1;
  queueSyncEvent({
    type: "bossDefeated",
    x: boss.x,
    y: boss.y,
    color: "#ffd166",
  });
  createExplosion(boss.x, boss.y, "#ffd166");
  playExplosionSound();
  clearAllBullets();
  boss.active = false;
  boss.encounterState = "idle";
  boss.arrivalTimer = 0;
  boss.arrivalProgress = 0;

  const nextPhaseIndex = boss.phaseIndex + 1;
  if (nextPhaseIndex >= BOSS_PHASES.length) {
    clearGame = true;
    gameOver = true;
    queueSyncEvent(
      {
        type: "gameState",
        gameOver,
        clearGame,
        defeatedBossCount,
        slowMotionTimer,
      },
      true,
    );
    if (isVersusParticipant()) {
      reportVersusTerminal("cleared");
    } else {
      recordClearResult();
      showChallengeApprovalIfStopped();
    }
    return;
  }

  boss.phaseIndex = nextPhaseIndex;
  boss.nextSpawnLevel = players[0].level + 10;
  boss.hp = 0;
  boss.maxHp = BOSS_PHASES[nextPhaseIndex].hp;
  boss.damageCooldown = 0;
  boss.flash = 0;
  queueSyncEvent({ type: "bossState", boss: createBossSyncState() }, true);
}

function clearAllBullets() {
  for (const player of players) {
    player.bullets = [];
    player.grazeIds.clear();
  }
  queueSyncEvent({ type: "bulletsCleared" }, true);
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
  showRankingRegistration();
}

function showRankingRegistration(debugMessage = "") {
  const clearTimeMs = Math.round(elapsedRound * 1000);
  const playScore = players[0].score;
  const timeBonus = calculateClearTimeBonus(clearTimeMs);
  const totalScore = playScore + timeBonus;
  lastClearResult = {
    clearTimeMs,
    playScore,
    timeBonus,
    score: totalScore,
    maxLevel: players[0].level,
  };
  rankingSubmittedForClear = false;
  rankingSubmitPanel?.classList.remove("is-submitted");
  if (rankingSubmitHeading) rankingSubmitHeading.textContent = "ランキング登録";
  if (rankingSubmitList) rankingSubmitList.innerHTML = "";
  if (rankingResult) {
    const prefix = debugMessage ? `${debugMessage} ` : "";
    rankingResult.textContent =
      `${prefix}SCORE ${formatScore(totalScore)} ` +
      `（プレイ ${formatScore(playScore)} + タイムボーナス ${formatScore(timeBonus)}）`;
  }
  rankingSubmitPanel?.classList.add("is-visible");
  updateRankingSubmitState();
}

function calculateClearTimeBonus(clearTimeMs) {
  return Math.max(0, CLEAR_TIME_BONUS_BASE - clearTimeMs);
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
    await submitRankingEntry({
      playerName,
      clearTimeMs: lastClearResult.clearTimeMs,
      score: lastClearResult.score,
      maxLevel: lastClearResult.maxLevel,
      defeatedBossCount,
      clientVersion: CLIENT_VERSION,
    });
    rankingSubmittedForClear = true;
    setRankingMessage("登録しました。");
    rankingSubmitPanel?.classList.add("is-submitted");
    if (rankingSubmitHeading) rankingSubmitHeading.textContent = "スコアランキング";
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
  const targets = getRankingListTargets();
  for (const target of targets) setRankingListMessage(target, "読み込み中...");

  try {
    renderRanking(await fetchScoreRanking(20, CLIENT_VERSION));
  } catch (error) {
    console.warn(error);
    for (const target of targets) setRankingListMessage(target, "ランキングAPI未接続");
  }
}

function renderRanking(rankings) {
  for (const target of getRankingListTargets()) renderRankingInto(target, rankings);
}

function getRankingListTargets() {
  const targets = rankingList ? [rankingList] : [];
  if (rankingSubmittedForClear && rankingSubmitList) targets.push(rankingSubmitList);
  return targets;
}

function setRankingListMessage(target, message) {
  target.innerHTML = "";
  const item = document.createElement("li");
  item.textContent = message;
  target.append(item);
}

function renderRankingInto(target, rankings) {
  target.innerHTML = "";
  if (rankings.length === 0) {
    setRankingListMessage(target, "まだ登録がありません");
    return;
  }

  for (const ranking of rankings) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = ranking.player_name;
    const detail = document.createTextNode(
      ` SCORE ${formatScore(ranking.score)} / TIME ${formatRankingTime(ranking.clear_time_ms)} / LV ${ranking.max_level}`,
    );
    item.append(name, detail);
    target.append(item);
  }
}

function setRankingMessage(message) {
  if (rankingResult) rankingResult.textContent = message;
}

function formatRankingTime(milliseconds) {
  const totalSeconds = milliseconds / 1000;
  return `${totalSeconds.toFixed(2)}s`;
}

function formatScore(score) {
  return Math.round(score).toLocaleString("ja-JP");
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
  if (player === players[0] && boss.encounterState === "active" && player.levelUpInvincible <= 0) {
    boss.shieldAttackCharges = 0;
  }
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
  const densityScale =
    (bulletDensity / 2)
    * BASE_BULLET_DENSITY_SCALE
    * (1 + defeatedBossCount * BASE_BULLET_CLEAR_BONUS);
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
  if (player.bullets.length >= MAX_ACTIVE_BULLETS_PER_FIELD) return;
  const bullet = {
    id: nextBulletId++,
    x,
    y,
    vx: vx * BULLET_SPEED_SCALE,
    vy: vy * BULLET_SPEED_SCALE,
    radius,
    color,
    type,
    age: 0,
    enteredField: isPointInsidePlayerField(player, x, y),
    ...options,
  };
  player.bullets.push(bullet);
  queueSyncEvent({
    type: "bulletSpawn",
    playerIndex: player === players[0] ? 0 : 1,
    bullet: {
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
      enteredField: bullet.enteredField,
    },
  });
}

function updateBullets(player, delta) {
  for (const bullet of player.bullets) {
    bullet.age += delta;
    bullet.x += bullet.vx * delta;
    bullet.y += bullet.vy * delta;
    if (isPointInsidePlayerField(player, bullet.x, bullet.y)) {
      bullet.enteredField = true;
    }
    if (
      bullet.type !== "bossAttack" &&
      (bullet.x < player.fieldX + 20 || bullet.x > player.fieldX + FIELD_WIDTH - 20)
    ) {
      bullet.vx *= -1;
    }
  }
  player.bullets = player.bullets.filter((bullet) => shouldKeepBullet(player, bullet));
}

function isPointInsidePlayerField(player, x, y) {
  return x >= player.fieldX && x <= player.fieldX + FIELD_WIDTH && y >= FIELD_TOP && y <= FIELD_BOTTOM;
}

function shouldKeepBullet(player, bullet) {
  if (bullet.enteredField) {
    return isPointInsidePlayerField(player, bullet.x, bullet.y);
  }
  return (
    bullet.y <= FIELD_BOTTOM &&
    bullet.x > player.fieldX - 48 &&
    bullet.x < player.fieldX + FIELD_WIDTH + 48
  );
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
  const attackingBoss = isBossEncounterInProgress() && attacker === players[0];
  attacker.gauge -= attackCost;
  attacker.level += 1;
  attacker.levelUpInvincible = getNextInvincibleTime(attacker.levelUpInvincible);
  attacker.levelUpFlash = 0.42;
  attacker.attackFlash = 0.35;
  attacker.attackCooldown = AUTO_ATTACK_COOLDOWN;
  if (!attackingBoss) defender.attackFlash = 0.55;
  playAttackSound();

  if (boss.encounterState === "active" && attacker === players[0]) {
    boss.shieldAttackCharges += 1;
  }
  if (attackingBoss) return;

  const shouldSendBoss = attacker.level >= attacker.nextBossLevel;
  if (shouldSendBoss) {
    attacker.nextBossLevel += BOSS_ATTACK_INTERVAL;
  }

  if (isVersusParticipant() && versusPhase === "playing" && attacker === players[0]) {
    cabinetClient.send({
      type: "versusAttack",
      matchId: versusMatchId,
      attackId: crypto.randomUUID(),
      level: attacker.level,
      bossAttack: shouldSendBoss,
    });
    return;
  }

  if (shouldSendBoss) {
    addBossBullets(defender, attacker.level);
    playBossAttackSound();
  }
  addStandardAttackBullets(defender, attacker.level, attacker.multiplier, defeatedBossCount);
}

function addStandardAttackBullets(defender, level, multiplier = 1, clearedBosses = 0) {
  const levelBonus = Math.floor((level - 1) / 6);
  const waves = 1;
  for (let wave = 0; wave < waves; wave += 1) {
    const center = defender.fieldX + FIELD_WIDTH / 2 + randomRange(-90, 90);
    const y = FIELD_TOP - 36 - wave * 22;
    const attackScale = ATTACK_BULLET_COUNT_SCALE + clearedBosses * ATTACK_BULLET_CLEAR_BONUS;
    const count = Math.max(2, Math.ceil((4 + Math.floor(multiplier) + levelBonus) * attackScale));
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
  return calculateAttackCost(player.level, gaugeGrowthPerLevel);
}

function getNextInvincibleTime(currentTime) {
  return calculateNextInvincibleTime(currentTime);
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
    if (isVersusParticipant() || isVersusSpectator()) drawOpponentBoss();
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
  const playerIndex = isVersusSpectator() ? spectatorPlayerIndex : 0;
  const selectedPlayer = players[playerIndex];
  const otherPlayer = players[playerIndex === 0 ? 1 : 0];
  withCompactWorldTransform(selectedPlayer, () => {
    drawField(selectedPlayer);
    if (playerIndex === 0) drawBoss();
    else drawOpponentBoss();
    drawBullets(selectedPlayer);
    drawPlayer(selectedPlayer);
    drawParticles();
  });

  drawPlayerHud(selectedPlayer);
  drawOpponentInfoHud(otherPlayer);
  if (playerIndex === 0) drawBossSpawnHint();
  drawCenterInfo();
}

function withCompactWorldTransform(player, drawCallback) {
  context.save();
  const visibleSourceWidth = HEIGHT * (canvas.clientWidth / Math.max(1, canvas.clientHeight));
  const horizontalScale = visibleSourceWidth / FIELD_WIDTH;
  const verticalScale = (HEIGHT - 92) / FIELD_HEIGHT;
  const scale = clamp(Math.min(horizontalScale, verticalScale), 0.82, 1.05);
  const focusX = player.fieldX + FIELD_WIDTH / 2;
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
  const entering = boss.encounterState === "entering";
  const entranceProgress = entering ? boss.arrivalProgress : 1;
  const visualRadius = boss.radius * (0.68 + entranceProgress * 0.32);
  const pulse = 0.5 + Math.sin(elapsedRound * 3.2) * 0.16;
  const flash = boss.flash > 0 ? 1 : 0;

  if (entering) drawBossArrivalShadow(entranceProgress);
  context.globalAlpha = entering ? 0.08 + entranceProgress * 0.92 : 1;

  context.strokeStyle = "rgba(255, 51, 85, 0.38)";
  context.lineWidth = 2;
  context.shadowBlur = 22;
  context.shadowColor = "#ff3355";
  for (let index = 0; index < 10; index += 1) {
    const angle = elapsedRound * 0.18 + (Math.PI * 2 * index) / 10;
    const innerRadius = visualRadius + 9 + pulse * 4;
    const outerRadius = visualRadius + 22;
    context.beginPath();
    context.moveTo(boss.x + Math.cos(angle) * innerRadius, boss.y + Math.sin(angle) * innerRadius);
    context.lineTo(boss.x + Math.cos(angle) * outerRadius, boss.y + Math.sin(angle) * outerRadius);
    context.stroke();
  }

  context.shadowBlur = 34 + flash * 28;
  context.shadowColor = flash ? "#ffffff" : "#ff3355";
  context.fillStyle = flash ? "#ffffff" : phase.color;
  context.strokeStyle = "#8f1739";
  context.lineWidth = 5;
  drawBossShape(phase.shape, boss.x, boss.y, visualRadius + pulse * 5);

  context.shadowBlur = 0;
  const coreGradient = context.createRadialGradient(boss.x, boss.y, 1, boss.x, boss.y, visualRadius * 0.52);
  coreGradient.addColorStop(0, flash ? "#ffffff" : "#ffeff3");
  coreGradient.addColorStop(0.18, "#ff3355");
  coreGradient.addColorStop(0.56, "#5d071d");
  coreGradient.addColorStop(1, "rgba(20, 0, 8, 0)");
  context.fillStyle = coreGradient;
  context.beginPath();
  context.arc(boss.x, boss.y, visualRadius * 0.54, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#fff4f6";
  context.shadowBlur = 16;
  context.shadowColor = "#ff3355";
  context.beginPath();
  context.ellipse(boss.x, boss.y, visualRadius * 0.34, visualRadius * 0.09, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#180008";
  context.beginPath();
  context.ellipse(boss.x, boss.y, visualRadius * 0.07, visualRadius * 0.1, 0, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;

  if (boss.encounterState !== "active") {
    context.restore();
    return;
  }

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

function drawOpponentBoss() {
  if (!opponentBoss.active || opponentBoss.hp <= 0) return;
  const phase = BOSS_PHASES[opponentBoss.phaseIndex] ?? BOSS_PHASES[0];
  const entering = opponentBoss.encounterState === "entering";
  const entranceProgress = entering ? opponentBoss.arrivalProgress : 1;
  const visualRadius = opponentBoss.radius * (0.68 + entranceProgress * 0.32);
  const pulse = 0.5 + Math.sin(elapsedRound * 3.2) * 0.16;
  const flash = opponentBoss.flash > 0 ? 1 : 0;

  context.save();
  context.globalAlpha = entering ? 0.08 + entranceProgress * 0.92 : 1;
  context.shadowBlur = 28 + flash * 22;
  context.shadowColor = flash ? "#ffffff" : "#ff3355";
  context.fillStyle = flash ? "#ffffff" : phase.color;
  context.strokeStyle = "#8f1739";
  context.lineWidth = 5;
  drawBossShape(phase.shape, opponentBoss.x, opponentBoss.y, visualRadius + pulse * 5);

  context.shadowBlur = 0;
  const coreGradient = context.createRadialGradient(
    opponentBoss.x,
    opponentBoss.y,
    1,
    opponentBoss.x,
    opponentBoss.y,
    visualRadius * 0.52,
  );
  coreGradient.addColorStop(0, flash ? "#ffffff" : "#ffeff3");
  coreGradient.addColorStop(0.18, "#ff3355");
  coreGradient.addColorStop(0.56, "#5d071d");
  coreGradient.addColorStop(1, "rgba(20, 0, 8, 0)");
  context.fillStyle = coreGradient;
  context.beginPath();
  context.arc(opponentBoss.x, opponentBoss.y, visualRadius * 0.54, 0, Math.PI * 2);
  context.fill();

  if (opponentBoss.encounterState === "active") {
    const barWidth = 260;
    const labelX = RIGHT_X + FIELD_WIDTH / 2;
    const barX = labelX - barWidth / 2;
    const hpRatio = clamp(opponentBoss.hp / Math.max(1, opponentBoss.maxHp), 0, 1);
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
  }
  context.restore();
}

function drawBossArrivalShadow(progress) {
  context.save();
  const shadowRadius = boss.radius * (2.25 - progress * 0.65);
  const shadowGradient = context.createRadialGradient(
    boss.x,
    boss.y,
    boss.radius * (0.2 + progress * 0.28),
    boss.x,
    boss.y,
    shadowRadius,
  );
  shadowGradient.addColorStop(0, `rgba(0, 0, 0, ${0.96 - progress * 0.46})`);
  shadowGradient.addColorStop(0.5, `rgba(10, 0, 14, ${0.9 - progress * 0.55})`);
  shadowGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = shadowGradient;
  context.shadowBlur = 46;
  context.shadowColor = "#000000";
  context.beginPath();
  context.arc(boss.x, boss.y, shadowRadius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawBossSpawnHint() {
  if (isBossEncounterInProgress() || clearGame || boss.phaseIndex >= BOSS_PHASES.length) return;
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

  if (isBossEncounterInProgress()) {
    const dangerPulse = 0.08 + (Math.sin(elapsedRound * 3.4) + 1) * 0.025;
    const dangerX = isCompactView() ? WIDTH / 2 : boss.x;
    const dangerGradient = context.createRadialGradient(dangerX, boss.y, 20, dangerX, boss.y, 440);
    dangerGradient.addColorStop(0, `rgba(110, 0, 30, ${dangerPulse + 0.08})`);
    dangerGradient.addColorStop(0.5, `rgba(55, 0, 20, ${dangerPulse})`);
    dangerGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = dangerGradient;
    context.fillRect(0, 0, WIDTH, HEIGHT);
  }

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
  context.save();
  roundRect(player.fieldX, FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT, 18);
  context.clip();
  const glowBlur = getBulletGlowBlur(player.bullets.length);
  for (const bullet of player.bullets) {
    context.save();
    if (bullet.type !== "base" && glowBlur > 0) {
      context.shadowBlur = glowBlur;
      context.shadowColor = bullet.color;
    }
    context.fillStyle = bullet.color;
    context.beginPath();
    drawBulletShape(bullet);
    context.restore();
  }
  context.restore();
}

function getBulletGlowBlur(bulletCount) {
  if (bulletCount >= BULLET_GLOW_DISABLE_THRESHOLD) return 0;
  if (bulletCount >= BULLET_GLOW_REDUCE_THRESHOLD) return 4;
  return 10;
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
  const isHitInvincible = player.invincible > 0 && !isLevelInvincible;
  const invincibleBlink = Math.floor(elapsedRound * 18) % 2 === 0;
  context.globalAlpha = isHitInvincible && invincibleBlink ? 0.45 : 1;
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
  const isWarning = isLevelInvincible && player.levelUpInvincible <= INVINCIBLE_WARNING_TIME;
  const markerAlpha = isWarning && invincibleBlink ? 0.25 : 1;
  context.globalAlpha *= markerAlpha;
  context.fillStyle = isLevelInvincible
    ? "#d9fdff"
    : isHitInvincible
      ? "#ffd166"
      : "#ff3355";
  context.strokeStyle = "rgba(255,255,255,0.72)";
  context.lineWidth = 1;
  if (isLevelInvincible || isHitInvincible) {
    context.shadowBlur = isLevelInvincible ? 16 : 10;
    context.shadowColor = isLevelInvincible ? "#69f7ff" : "#ffd166";
  }
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
  if (cabinetRole === "spectator") {
    context.font = "600 20px system-ui";
    context.fillText("プレイヤーが続けるか辞めるか選ぶのを待っています", WIDTH / 2, HEIGHT / 2 + (clearGame ? -72 : 18));
  } else if (!clearGame) {
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
  const compact = isCompactView();
  const title = waitingForStart ? "READY" : "PAUSED";
  const action = waitingForStart ? "Spaceでゲーム開始" : "Spaceで再開";
  const instructionX = WIDTH / 2 - (compact ? 165 : 195);
  const instructions = [
    "移動: 矢印キー / WASD",
    "低速移動: Shift",
    "ボス攻撃: 無敵シールドを当てる",
  ];

  context.fillStyle = "rgba(0,0,0,0.7)";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#f4f7ff";
  context.textAlign = "center";
  context.font = `800 ${compact ? 52 : 64}px system-ui`;
  context.fillText(title, WIDTH / 2, HEIGHT / 2 - 126);
  context.fillStyle = "#69f7ff";
  context.font = `800 ${compact ? 22 : 24}px system-ui`;
  context.fillText(action, WIDTH / 2, HEIGHT / 2 - 76);
  context.fillStyle = "#f4f7ff";
  context.font = `600 ${compact ? 15 : 17}px system-ui`;
  context.textAlign = "left";
  instructions.forEach((instruction, index) => {
    context.fillText(instruction, instructionX, HEIGHT / 2 - 18 + index * 31);
  });
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

function smoothstep(value) {
  return value * value * (3 - 2 * value);
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
