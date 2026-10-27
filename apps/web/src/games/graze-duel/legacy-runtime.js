import { createCabinetSession } from "../../game-sdk/cabinet-session";
import { GameLifetime } from "../../game-sdk/lifetime";
import { gameHost } from "../../game-sdk/game-host";
import { createUuid } from "../../shared/id";
import { renderResultSummary } from "../../features/game/result-summary";
import { resultSharing } from "../../features/sharing/result-sharing";
import { setLiveContext } from "../../features/sharing/share-service";
import { notifications } from "../../features/notifications/notifications";
import {
  fetchScoreRanking,
  loadRankingWithNotice,
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
import { createGrazeAudio } from "./audio";
import { BUZZ_BARRIER } from "../../domain/game";
import { recordWatchStarted } from "../../features/engagement/engagement-client";
import { createCanvasRenderer } from "./rendering/canvas-renderer";
import { createGameState } from "./state";
import { createSimulation } from "./simulation";
import { createInputController } from "./input";

/**
 * @param {import("../../game-sdk/contracts").GameContext} context
 * @returns {import("../../game-sdk/contracts").GameInstance}
 */
export function mountGame(context) {
  if (context.lifetime.disposed) {
    return { async play() { return false; }, async prepareSolo() {}, dispose() {} };
  }
  const scope = new GameLifetime();
  const releaseLifetime = context.lifetime.own(() => scope.dispose());
  scope.own(releaseLifetime);
  scope.own(() => {
    document.body.classList.remove("is-arcade-screen", "is-game-screen", "is-cabinet-spectator", "is-spectator", "is-local-dev");
    notifications.clearScope(BUZZ_BARRIER.id);
  });
  const audio = createGrazeAudio();
  const { playAttackSound, playBossAttackSound, playBossHitSound, playExplosionSound, playGrazeSound } = audio;
  scope.own(() => audio.dispose());
  const canvas = document.querySelector("#game");
  const arcadeScreen = document.querySelector("#arcade-screen");
  const cabinetScreen = document.querySelector("#cabinet-screen");
  const gameScreen = document.querySelector("#game-screen");
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
  const touchPause = document.querySelector("#touch-pause");
  const rankingAnotherGame = document.querySelector("#ranking-another-game");
  const rankingRetry = document.querySelector("#ranking-retry");
  const rankingNameInput = document.querySelector("#ranking-name");
  const rankingSubmitButton = document.querySelector("#ranking-submit");
  const rankingSubmitPanel = document.querySelector("#ranking-submit-panel");
  const rankingSubmitList = document.querySelector("#ranking-submit-list");
  const rankingResult = document.querySelector("#ranking-result");
  const rankingList = document.querySelector("#ranking-list");
  const challengeRequestButton = document.querySelector("#challenge-request");
  const spectatorStatusText = document.querySelector("#spectator-status-text");
  const spectatorViewLabel = document.querySelector("#spectator-view-label");
  const spectatorSwitchPlayer = document.querySelector("#spectator-switch-player");
  const spectatorCount = document.querySelector("#spectator-count");
  const playerCrowdPulse = document.querySelector("#player-crowd-pulse");
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
  const RANKING_REGISTRATION_RETURN_KEY = "vgc_ranking_registration_return";
  const GAME_OVER_RANKING_DELAY = 2;
  const RANKING_INPUT_GUARD_TIME = 300;
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
  const GAME_ID = BUZZ_BARRIER.id;
  const CLIENT_VERSION = BUZZ_BARRIER.currentVersion;
  const PROMO_CAPTURE_MODE = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("promoCapture") === "1";
  const rendererSearchParams = new URLSearchParams(window.location.search);
  const requestedRenderer = rendererSearchParams.get("renderer")
    ?? (rendererSearchParams.get("bulletRenderer") === "three" ? "three" : null);
  const THREE_RENDERER_REQUESTED = requestedRenderer !== "canvas";
  const GPU_REPLAY_DEMO = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("gpuReplayDemo") === "1";
  const RENDER_STATS_ENABLED = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("renderStats") === "1";
  const RENDER_STRESS_COUNT = import.meta.env.DEV
    ? clamp(Number(new URLSearchParams(window.location.search).get("renderStress")) || 0, 0, 10000)
    : 0;

  let sceneRenderer = null;
  const renderStressBulletsByPlayer = [[], []];
  let renderStatsFrameCount = 0;
  let renderStatsWorkTotal = 0;
  let renderStatsWorkMax = 0;
  let renderStatsStartedAt = performance.now();
  if (THREE_RENDERER_REQUESTED) {
    void import("./rendering/three-game-renderer")
      .then(({ createThreeGameRenderer }) => {
        if (scope.disposed) return;
        sceneRenderer = createThreeGameRenderer(WIDTH, HEIGHT);
        scope.own(() => { sceneRenderer?.dispose(); sceneRenderer = null; });
        sceneRenderer.mount(canvas.closest(".game-frame"), canvas);
        if (RENDER_STATS_ENABLED) installRendererBadge();
      })
      .catch((error) => {
        if (scope.disposed) return;
        console.warn("Three.js renderer initialization failed; using Canvas 2D.", error);
        if (RENDER_STATS_ENABLED) installRendererBadge();
      });
  }

  const BOSS_PHASES = [
    { level: 1, spawnLevel: 10, name: "BOSS LV1", shape: "circle", hp: 100, hitsToDefeat: 12, radius: 44, color: "#18051f" },
    { level: 2, spawnLevel: 20, name: "MID BOSS LV2", shape: "invertedTriangle", hp: 120, hitsToDefeat: 20, radius: 48, color: "#071722" },
    { level: 3, spawnLevel: 30, name: "LAST BOSS LV3", shape: "star", hp: 152, hitsToDefeat: 28, radius: 52, color: "#1c0628" },
  ];

  const state = createGameState({ BOSS_PHASES, LEFT_X, RIGHT_X, FIELD_WIDTH, FIELD_TOP, FIELD_HEIGHT, FIELD_BOTTOM, BOSS_RADIUS, BOSS_ATTACK_TELEGRAPH_TIME, MAX_LIVES, BOSS_ATTACK_INTERVAL });
  const { players, boss, opponentBoss, particles } = state;
  const { movePlayer, updatePlayerState, findClosestBullet, updateParticles } = createSimulation({
    state,
    settings: { FIELD_TOP, FIELD_BOTTOM, FIELD_MARGIN, FIELD_WIDTH, PLAYER_SPEED_SCALE, PLAYER_TILT_MAX, PLAYER_TILT_LERP, MAX_PARTICLES },
  });
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
  let pausedForLiveShare = false;
  let waitingForStart = false;
  let nextBulletId = 1;
  let clearGame = false;
  let lastRankingResult = null;
  let sharedRunId = createUuid();
  let liveShareContextKey = "";
  let rankingSubmittedForResult = false;
  let gameOverRankingTimer = 0;
  let rankingInputUnlockTimeout = 0;
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
  let spectatorBulletRevision = 0;
  let syncSequence = 0;
  let motionFrameTimer = 0;
  let keyframeTimer = 0;
  let eventFlushTimer = 0;
  let pendingSyncEvents = [];
  let cabinetConnected = false;
  let currentCabinetId = null;
  let immediateWatchStarted = false;
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


  const canvasRenderer = createCanvasRenderer({
    context: canvas.getContext("2d"),
    settings: {
      WIDTH,
      HEIGHT,
      FIELD_TOP,
      FIELD_BOTTOM,
      FIELD_WIDTH,
      FIELD_HEIGHT,
      LEFT_X,
      RIGHT_X,
      BOSS_PHASES,
      MAX_LIVES,
      BULLET_GLOW_DISABLE_THRESHOLD,
      BULLET_GLOW_REDUCE_THRESHOLD,
      INVINCIBLE_WARNING_TIME,
      INVINCIBLE_RING_INNER_RADIUS,
      INVINCIBLE_RING_INNER_SCALE,
      HIT_MARKER_RADIUS,
    },
    getAttackCost,
    randomRange,
    createLightningBolt,
  });

  scope.own(() => canvasRenderer.dispose());

  const cabinetClient = createCabinetSession({
    gameId: GAME_ID,
    lifetime: scope,
    onConnectionChange: (connected) => {
      if (scope.disposed) return;
      cabinetConnected = connected;
      updateCabinetUi();
      attemptImmediateSpectating();
    },
    onMessage: handleCabinetMessage,
    onError: (message) => {
      if (!scope.disposed && cabinetRoleLabel) cabinetRoleLabel.textContent = message;
    },
  });

  const input = createInputController({
    lifetime: scope,
    canvas,
    keyboardTarget: window,
    getState: () => ({
      spectator: cabinetRole === "spectator" || Boolean(document.querySelector(".share-overlay")),
      versusParticipant: isVersusParticipant() && !document.querySelector(".share-overlay"),
      screen: currentScreen,
      gameOver,
      compact: isCompactView(),
    }),
    togglePause: togglePauseState,
    requestRetry: () => gameHost.requestPlay("retry"),
    movePlayer,
  });
  const { touchMove, resetTouchMove } = input;

  if (isLocalDevelopment()) {
    document.body.classList.add("is-local-dev");
  }
  if (RENDER_STATS_ENABLED && !THREE_RENDERER_REQUESTED) installRendererBadge();


  function resetGame() {
    pausedForLiveShare = false;
    resultSharing.clear(BUZZ_BARRIER.id);
    sharedRunId = createUuid();
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
    lastRankingResult = null;
    rankingSubmittedForResult = false;
    gameOverRankingTimer = 0;
    window.clearTimeout(rankingInputUnlockTimeout);
    rankingInputUnlockTimeout = 0;
    debugRankingPreviewShown = false;
    rankingSubmitPanel?.classList.remove("is-visible");
    rankingSubmitPanel?.classList.remove("is-submitted");
    rankingSubmitPanel?.classList.remove("is-input-locked");
    updateRankingSubmitState();
    resetBossProgress();
    resetOpponentBossProgress();
  }

  function resetGameForRetry() {
    pausedForLiveShare = false;
    resultSharing.clear(BUZZ_BARRIER.id);
    sharedRunId = createUuid();
    for (const player of players) {
      player.x = player.fieldX + FIELD_WIDTH / 2;
      player.y = FIELD_BOTTOM - 58;
      player.lives = MAX_LIVES;
      player.score = 0;
      player.combo = 0;
      player.multiplier = 1;
      player.comboTimer = 0;
      player.invincible = 1.5;
      player.levelUpInvincible = 0;
      player.barrierRatio = 0;
      player.hitInvincible = true;
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
    elapsedRound = 0;
    slowMotionTimer = 0;
    bossHitStopTimer = 0;
    gameOver = false;
    paused = true;
    waitingForStart = true;
    clearGame = false;
    lastRankingResult = null;
    rankingSubmittedForResult = false;
    gameOverRankingTimer = 0;
    window.clearTimeout(rankingInputUnlockTimeout);
    rankingInputUnlockTimeout = 0;
    debugRankingPreviewShown = false;
    rankingSubmitPanel?.classList.remove("is-visible");
    rankingSubmitPanel?.classList.remove("is-submitted");
    rankingSubmitPanel?.classList.remove("is-input-locked");

    boss.damageCooldown = 0;
    boss.flash = 0;
    boss.shieldAttackCharges = 0;
    boss.bonusPending = false;
    boss.bonusActive = false;
    if (boss.encounterState === "active") {
      boss.attackState = "telegraph";
      boss.attackTimer = BOSS_ATTACK_TELEGRAPH_TIME;
      boss.attackShotTimer = 0;
      boss.attackStep = 0;
      boss.attackTargetX = players[0].x;
      boss.attackTargetY = players[0].y;
    }

    clearAllBullets();
    updatePauseButton();
    updateRankingSubmitState();
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
  if (PROMO_CAPTURE_MODE) startPromoCapture();
  else syncScreenWithUrl();

  function startPromoCapture() {
    resetGame();
    cabinetRole = "player";
    gameSessionActive = true;
    paused = false;
    waitingForStart = false;
    playerHitboxEnabled = false;
    const requestedBoss = Number(new URLSearchParams(window.location.search).get("promoBoss"));
    const previewPhaseIndex = [1, 2, 3].includes(requestedBoss) ? requestedBoss - 1 : 0;
    players[0].level = 17 + previewPhaseIndex * 10;
    players[0].score = 18_420;
    players[0].gauge = getAttackCost(players[0]) - 70;
    players[0].invincible = 0;
    players[1].level = 13;
    players[1].score = 12_660;
    scheduleBossPhase(previewPhaseIndex);
    startBossEntrance();
    boss.arrivalTimer = 0;
    boss.arrivalProgress = 1;
    completeBossEntrance();
    boss.attackTimer = 0;
    showScreen("game");
    lastTime = performance.now();
  }

  if (backToArcadeButton) {
    scope.listen(backToArcadeButton, "click", () => {
      leaveCabinet();
    });
  }

  if (cabinetBreadcrumbArcade) {
    scope.listen(cabinetBreadcrumbArcade, "click", () => {
      leaveCabinet();
    });
  }

  if (gameBackToArcadeButton) {
    scope.listen(gameBackToArcadeButton, "click", () => {
      returnToCabinet();
    });
  }

  if (spectatorGameBackButton) {
    scope.listen(spectatorGameBackButton, "click", () => {
      returnToCabinet();
    });
  }

  if (challengeRequestButton) {
    scope.listen(challengeRequestButton, "click", () => {
      openChallengeAction();
    });
  }

  if (spectatorSwitchPlayer) scope.listen(spectatorSwitchPlayer, "click", () => {
    spectatorPlayerIndex = spectatorPlayerIndex === 0 ? 1 : 0;
    updateSpectatorViewSwitch();
  });
  scope.listen(window, "resize", updateSpectatorViewSwitch);

  if (versusPrimary) scope.listen(versusPrimary, "click", () => handleVersusUiAction("primary"));
  if (versusSecondary) scope.listen(versusSecondary, "click", () => handleVersusUiAction("secondary"));
  if (versusDanger) scope.listen(versusDanger, "click", () => handleVersusUiAction("danger"));

  scope.listen(window, "popstate", syncScreenWithUrl);

  if (bulletDensityInput && bulletDensityValue) {
    scope.listen(bulletDensityInput, "input", () => {
      bulletDensity = Number(bulletDensityInput.value);
      bulletDensityValue.textContent = String(bulletDensity);
    });
  }

  if (playerHitboxToggle) {
    scope.listen(playerHitboxToggle, "change", () => {
      playerHitboxEnabled = playerHitboxToggle.checked;
    });
  }

  if (debugRankingPreviewToggle) {
    scope.listen(debugRankingPreviewToggle, "change", () => {
      debugRankingPreviewEnabled = debugRankingPreviewToggle.checked;
      debugRankingPreviewShown = false;
      if (!debugRankingPreviewEnabled && !clearGame) {
        lastRankingResult = null;
        rankingSubmittedForResult = false;
        rankingSubmitPanel?.classList.remove("is-visible");
        rankingSubmitPanel?.classList.remove("is-submitted");
        updateRankingSubmitState();
      }
    });
  }

  if (gaugeGrowthDown && gaugeGrowthUp && gaugeGrowthValue && gaugeGrowthLabel) {
    scope.listen(gaugeGrowthDown, "click", () => updateGaugeGrowth(-5));
    scope.listen(gaugeGrowthUp, "click", () => updateGaugeGrowth(5));
  }


  if (rankingAnotherGame) {
    scope.listen(rankingAnotherGame, "click", () => {
      rankingSubmitPanel?.classList.remove("is-visible");
      leaveCabinet();
    });
  }

  if (touchPause) {
    scope.listen(touchPause, "click", () => {
      if (cabinetRole === "spectator" && !isVersusParticipant()) return;
      togglePauseState();
    });
  }

  if (rankingSubmitButton) {
    scope.listen(rankingSubmitButton, "click", () => {
      submitRanking();
    });
  }

  if (rankingNameInput) {
    scope.listen(rankingNameInput, "input", updateRankingSubmitState);
  }

  scope.listen(window, "prepare-user-registration", () => {
    if (!lastRankingResult || !rankingSubmitPanel?.classList.contains("is-visible")) return;
    window.sessionStorage.setItem(RANKING_REGISTRATION_RETURN_KEY, JSON.stringify({
      result: lastRankingResult,
      sharedResult: resultSharing.getPublishedSnapshot() ?? resultSharing.getSnapshot(),
      message: rankingResult?.textContent ?? "",
    }));
  });

  scope.listen(window, "restore-ranking-registration", restoreRankingRegistration);
  restoreRankingRegistration();

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
      const reservation = await reservePlayCredit(currentCabinetId, GAME_ID, "challenge");
      if (scope.disposed) {
        await releasePlayCredit(reservation.reservationId);
        return;
      }
      challengeReservationId = reservation.reservationId;
      if (scope.disposed) return;
      window.dispatchEvent(new Event("platform-wallet-changed"));
      cabinetClient.send({
        type: "requestChallenge",
        reservationId: reservation.reservationId,
      });
      if (spectatorStatusText) spectatorStatusText.textContent = "対戦申し込みを送信しています。";
      updateChallengeButton();
    } catch {
      if (scope.disposed) return;
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
      if (scope.disposed) return;
      notifications.show({ id: "game-credit", scope: GAME_ID, type: "error", message: "クレジット状態を再読み込みしてください。" });
    }
    if (challengeReservationId === reservationId) challengeReservationId = null;
  }

  let versusCreditReady = Promise.resolve(true);
  async function captureVersusReservation(reservationId) {
    if (!reservationId) return true;
    try {
      const result = await capturePlayCredit(reservationId);
      if (result.status !== "captured") throw new Error("credit_not_captured");
      window.dispatchEvent(new Event("platform-wallet-changed"));
    } catch {
      if (scope.disposed) return;
      notifications.show({ id: "game-credit", scope: GAME_ID, type: "error", message: "クレジットを確定できませんでした。再読み込みしてください。" });
      return false;
    }
    if (challengeReservationId === reservationId) challengeReservationId = null;
    return true;
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
      const matchId = versusMatchId;
      void versusCreditReady.then(ready => {
        if (ready && !scope.disposed && versusMatchId === matchId) cabinetClient.send({ type: "versusReady", matchId });
      });
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
      const reservation = await reservePlayCredit(currentCabinetId, GAME_ID, "rematch");
      challengeReservationId = reservation.reservationId;
      window.dispatchEvent(new Event("platform-wallet-changed"));
      cabinetClient.send({
        type: "requestRematch",
        matchId: versusMatchId,
        reservationId: reservation.reservationId,
      });
      showVersusOverlay("Rematch", "再挑戦の承認を待っています。", "waiting");
    } catch {
      if (scope.disposed) return;
      notifications.show({ id: "game-credit", scope: GAME_ID, type: "error", message: "再挑戦用クレジットを予約できませんでした。" });
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
    if (screen === "arcade") notifications.clearScope(GAME_ID);
    currentScreen = screen;
    document.body.classList.toggle("is-game-screen", screen === "game");
    arcadeScreen?.classList.toggle("is-hidden", screen !== "arcade");
    cabinetScreen?.classList.toggle("is-hidden", screen !== "cabinet");
    gameScreen?.classList.toggle("is-hidden", screen !== "game");
    updateLiveShareContext();
  }

  function enterCabinet(cabinetId, updateUrl = true) {
    if (!cabinetId) return;
    if (currentCabinetId && currentCabinetId !== cabinetId) cabinetClient.leave();
    currentCabinetId = cabinetId;
    cabinetRole = "joining";
    cabinetConnected = false;
    cabinetState = null;
    immediateWatchStarted = false;
    resetViewerSyncState();
    if (updateUrl) {
      const rendererQuery = requestedRenderer === "canvas" ? "&renderer=canvas" : "";
      history.pushState(
        { cabinetId, gameId: GAME_ID },
        "",
        `/cabinets/${cabinetId}?game=${encodeURIComponent(GAME_ID)}${rendererQuery}`,
      );
    }
    if (cabinetIdLabel) cabinetIdLabel.textContent = `Cabinet ${cabinetId.slice(0, 8)}`;
    updateCabinetUi();
    showScreen("cabinet");
    cabinetClient.join(cabinetId, GAME_ID);
  }

  function startSoloPlay(reservationId, authorized = false) {
    if (scope.disposed || !currentCabinetId) return false;
    if (!cabinetConnected) {
      cabinetRole = "joining";
      updateCabinetUi();
      cabinetClient.join(currentCabinetId, GAME_ID);
      return false;
    }
    if (cabinetRole === "spectator") {
      return false;
    }
    if (cabinetRole !== "player") return false;
    const isGameOverRetry = gameOver && !clearGame && players[0].lives <= 0;
    if (isGameOverRetry) resetGameForRetry();
    else resetGame();
    gameSessionActive = true;
    document.body.classList.remove("is-cabinet-spectator");
    document.body.classList.remove("is-spectator");
    spectatorBanner?.classList.add("is-hidden");
    resetHostSyncState();
    if (!authorized) cabinetClient.send({ type: "startSolo", reservationId });
    broadcastGameKeyframe(true);
    lastTime = performance.now();
    showScreen("game");
    return true;
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
    updateCrowdUi();
    if (currentCabinetId) recordWatchStarted(GAME_ID, currentCabinetId);
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

  function handleCabinetMessage(message) {
    if (scope.disposed) return;
    if (message.type === "cabinetState") {
      cabinetState = message.state;
      updateCabinetUi();
      attemptImmediateSpectating();
      return;
    }

    if (message.type === "joinedCabinet") {
      cabinetRole = message.role;
      updateCabinetUi();
      attemptImmediateSpectating();
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
      versusCreditReady = message.reservationId ? captureVersusReservation(message.reservationId) : Promise.resolve(true);
      showVersusOverlay("対戦承諾", "2秒後にReady確認へ進みます。", "waiting");
      scope.timeout(() => prepareVersusReady(message.matchId), 2000);
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
      scope.timeout(updateCountdown, 50);
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
    const ownReport = versusSeat === "host" ? message.host : message.challenger;
    if (isVersusParticipant() && ownReport) {
      resultSharing.setResult({
        id: sharedRunId, gameId: BUZZ_BARRIER.id, gameVersion: BUZZ_BARRIER.currentVersion,
        elapsedTimeMs: Math.max(1, ownReport.matchElapsedMs), cleared: ownReport.reason === "cleared", score: ownReport.score,
        metrics: { maxLevel: players[0].level, defeatedBossCount, mode: "versus", outcome: message.winner === "draw" ? "draw" : message.winner === versusSeat ? "win" : "lose" },
      });
    }
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
        scope.timeout(() => {
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
    rematchTimer = scope.interval(() => {
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

  function attemptImmediateSpectating() {
    if (
      immediateWatchStarted
      || new URL(window.location.href).searchParams.get("watch") !== "1"
      || cabinetRole !== "spectator"
      || !cabinetConnected
      || !["soloPlaying", "challengePending", "versusPlaying"].includes(cabinetState?.status)
    ) return;
    immediateWatchStarted = true;
    startSpectating();
  }

  function updateCrowdUi() {
    const count = Math.max(0, Number(cabinetState?.spectatorCount ?? 0));
    if (spectatorCount) spectatorCount.textContent = `観戦者 ${Math.max(1, count)}人`;
    const intensity = Math.min(1, Math.log2(count + 1) / 4);
    playerCrowdPulse?.style.setProperty("--crowd-intensity", String(intensity));
    playerCrowdPulse?.classList.toggle("is-hidden", cabinetRole !== "player" || count === 0);
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
    updateCrowdUi();
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
    spectatorBulletRevision += 1;
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
        spectatorRenderBaseX: event.bullet.x,
        spectatorRenderBaseY: event.bullet.y,
        spectatorRenderBaseElapsed: elapsedRound,
      });
      spectatorBulletRevision += 1;
      return;
    }
    if (event.type === "bulletsCleared") {
      for (const player of players) {
        player.bullets = [];
        player.grazeIds.clear();
      }
      spectatorBulletRevision += 1;
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
      bullet.spectatorRenderBaseX = snapshotBullet.x;
      bullet.spectatorRenderBaseY = snapshotBullet.y;
      bullet.spectatorRenderBaseElapsed = elapsedRound;
      return bullet;
    });
    spectatorBulletRevision += 1;
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

      if (!sceneRenderer) {
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


  function loop(now) {
    const workStartedAt = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;
    update(delta);
    updateLiveShareContext();
    draw();
    recordRenderStats(performance.now() - workStartedAt);
    scope.frame(loop);
  }

  scope.frame(loop);
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
    if (players[0].lives <= 0 && !gameOver) {
      gameOver = true;
      gameOverRankingTimer = GAME_OVER_RANKING_DELAY;
    }
    updateGameOverRanking(delta);

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
    if (isVersusParticipant() && !pausedForLiveShare) return;
    pausedForLiveShare = false;
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

  scope.own(() => {
    resultSharing.clear(BUZZ_BARRIER.id);
    setLiveContext(null);
  });
  const pauseBeforeShare = () => {
    if (!gameSessionActive || (cabinetRole !== "player" && !isVersusParticipant())
      || waitingForStart || gameOver || clearGame) return;
    paused = true;
    pausedForLiveShare = true;
    resetTouchMove();
    updatePauseButton();
    queueSyncEvent({ type: "pauseChanged", paused, waitingForStart }, true);
    broadcastMotionFrame(true);
  };
  scope.listen(window, "before-live-share", pauseBeforeShare);
  scope.listen(window, "request-cabinet-share", pauseBeforeShare);

  function updateLiveShareContext() {
    const context = currentCabinetId && currentScreen === "game" ? {
        gameId: BUZZ_BARRIER.id, cabinetId: currentCabinetId,
        role: cabinetRole === "player" || isVersusParticipant() ? "player" : "spectator",
        phase: gameOver || clearGame || versusPhase === "result" ? "finished"
          : waitingForStart ? "ready" : paused ? "paused" : "playing",
    } : null;
    const key = JSON.stringify(context);
    if (key !== liveShareContextKey) {
      liveShareContextKey = key;
      setLiveContext(context);
    }
  }

  function updatePauseButton() {
    updateLiveShareContext();
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
    showRankingRegistration({
      cleared: true,
      debugMessage: "デバッグ: ゲーム開始3秒後のランキング登録表示です。",
    });
  }

  function recordClearResult() {
    showRankingRegistration({ cleared: true });
  }

  function recordGameOverResult() {
    if (lastRankingResult || clearGame) return;
    showRankingRegistration({ cleared: false });
  }

  function updateGameOverRanking(delta) {
    if (!gameOver || clearGame || lastRankingResult || players[0].lives > 0) return;
    gameOverRankingTimer = Math.max(0, gameOverRankingTimer - delta);
    if (gameOverRankingTimer > 0 || (isCompactView() && touchMove.active)) return;
    recordGameOverResult();
  }

  function showRankingRegistration({ cleared, debugMessage = "" }) {
    const elapsedTimeMs = Math.round(elapsedRound * 1000);
    const playScore = players[0].score;
    const timeBonus = cleared ? calculateClearTimeBonus(elapsedTimeMs) : 0;
    const totalScore = playScore + timeBonus;
    lastRankingResult = {
      elapsedTimeMs,
      cleared,
      playScore,
      timeBonus,
      score: totalScore,
      maxLevel: players[0].level,
      defeatedBossCount,
    };
    if (!debugMessage && gameSessionActive && cabinetRole === "player" && !isVersusParticipant()
      && (cleared ? clearGame : gameOver && players[0].lives <= 0)) {
      resultSharing.setResult({
        id: sharedRunId, gameId: BUZZ_BARRIER.id, gameVersion: BUZZ_BARRIER.currentVersion,
        elapsedTimeMs: Math.max(1, elapsedTimeMs), cleared, score: totalScore,
        metrics: { maxLevel: players[0].level, defeatedBossCount },
      });
    }
    rankingSubmittedForResult = false;
    rankingSubmitPanel?.classList.remove("is-submitted");
    if (rankingSubmitList) rankingSubmitList.innerHTML = "";
    renderBuzzResult(lastRankingResult, debugMessage);
    rankingSubmitPanel?.classList.add("is-visible");
    guardRankingInput();
    updateRankingSubmitState();
  }

  function renderBuzzResult(result, note = "") {
    renderResultSummary({
      title: result.cleared ? "ALL CLEAR" : "GAME OVER",
      score: result.score,
      details: [
        ["ボス撃破", String(result.defeatedBossCount)],
        ["LEVEL", String(result.maxLevel)],
        ["TIME", formatRankingTime(result.elapsedTimeMs)],
        ...(result.cleared ? [["プレイスコア", formatScore(result.playScore)], ["タイムボーナス", formatScore(result.timeBonus)]] : []),
      ],
      note,
    });
  }

  function guardRankingInput() {
    window.clearTimeout(rankingInputUnlockTimeout);
    rankingSubmitPanel?.classList.toggle("is-input-locked", isCompactView());
    if (!isCompactView()) return;
    rankingInputUnlockTimeout = scope.timeout(() => {
      rankingSubmitPanel?.classList.remove("is-input-locked");
      rankingInputUnlockTimeout = 0;
    }, RANKING_INPUT_GUARD_TIME);
  }

  function restoreRankingRegistration() {
    const stored = window.sessionStorage.getItem(RANKING_REGISTRATION_RETURN_KEY);
    if (!stored) return;
    try {
      const restored = JSON.parse(stored);
      if (!restored?.result) return;
      lastRankingResult = restored.result;
      if (restored.sharedResult?.gameId === BUZZ_BARRIER.id) {
        if (restored.sharedResult.playerName) resultSharing.usePublished(restored.sharedResult);
        else resultSharing.setResult(restored.sharedResult);
      }
      rankingSubmittedForResult = false;
      renderBuzzResult(lastRankingResult);
      rankingSubmitPanel?.classList.remove("is-submitted");
      rankingSubmitPanel?.classList.add("is-visible");
      gameSessionActive = false;
      showScreen("game");
      updateRankingSubmitState();
    } finally {
      window.sessionStorage.removeItem(RANKING_REGISTRATION_RETURN_KEY);
    }
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
    rankingSubmitButton.disabled = !lastRankingResult || rankingSubmittedForResult || !hasName;
  }

  async function submitRanking() {
    if (!lastRankingResult || rankingSubmittedForResult || !rankingNameInput) return;
    const playerName = rankingNameInput.value.trim();
    if (!playerName) {
      updateRankingSubmitState();
      return;
    }

    setRankingMessage("登録中です。");
    rankingSubmitButton.disabled = true;

    try {
      await submitRankingEntry({
        gameId: GAME_ID,
        elapsedTimeMs: lastRankingResult.elapsedTimeMs,
        cleared: lastRankingResult.cleared,
        score: lastRankingResult.score,
        maxLevel: lastRankingResult.maxLevel,
        defeatedBossCount: lastRankingResult.defeatedBossCount,
        clientVersion: CLIENT_VERSION,
      });
      if (scope.disposed) return;
      rankingSubmittedForResult = true;
      setRankingMessage("");
      rankingSubmitPanel?.classList.add("is-submitted");
      updateRankingSubmitState();
      await loadRanking();
    } catch (error) {
      if (scope.disposed) return;
      console.warn(error);
      setRankingMessage("");
      updateRankingSubmitState();
    }
  }

  async function loadRanking() {
    if (!rankingList) return;
    const targets = getRankingListTargets();
    for (const target of targets) setRankingListMessage(target, "読み込み中...");

    await loadRankingWithNotice(GAME_ID, async () => {
      if (scope.disposed) return;
      for (const target of targets) setRankingListMessage(target, "");
      const rankings = await fetchScoreRanking(GAME_ID, 20, CLIENT_VERSION);
      if (!scope.disposed) renderRanking(rankings);
    });
  }

  function renderRanking(rankings) {
    for (const target of getRankingListTargets()) renderRankingInto(target, rankings);
  }

  function getRankingListTargets() {
    const targets = rankingList ? [rankingList] : [];
    if (rankingSubmittedForResult && rankingSubmitList) targets.push(rankingSubmitList);
    return targets;
  }

  function setRankingListMessage(target, message) {
    target.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "ranking-table-message";
    cell.textContent = message;
    row.append(cell);
    target.append(row);
  }

  function renderRankingInto(target, rankings) {
    target.innerHTML = "";
    if (rankings.length === 0) {
      setRankingListMessage(target, "まだ登録がありません");
      return;
    }

    let submittedRecordHighlighted = false;
    let submittedRow = null;
    rankings.forEach((ranking, index) => {
      const row = document.createElement("tr");
      const rank = document.createElement("td");
      const name = document.createElement("td");
      const score = document.createElement("td");
      const createdAt = document.createElement("td");
      rank.textContent = String(index + 1);
      name.textContent = ranking.player_name;
      score.textContent = formatScore(ranking.score);
      createdAt.textContent = formatRankingDate(ranking.created_at);
      if (
        !submittedRecordHighlighted
        && rankingSubmittedForResult
        && lastRankingResult
        && ranking.player_name === rankingNameInput?.value.trim()
        && ranking.score === lastRankingResult.score
      ) {
        row.classList.add("is-current-ranking");
        row.setAttribute("aria-label", "今回登録したスコア");
        submittedRecordHighlighted = true;
        submittedRow = row;
      }
      row.append(rank, name, score, createdAt);
      target.append(row);
    });
    if (submittedRow) {
      const scrollContainer = target.closest(".ranking-submit-list");
      if (scrollContainer) {
        scope.frame(() => {
          scrollContainer.scrollTop = Math.max(
            0,
            submittedRow.offsetTop - (scrollContainer.clientHeight - submittedRow.offsetHeight) / 2,
          );
        });
      }
    }
  }

  function formatRankingDate(value) {
    const normalizedValue = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
    const date = new Date(normalizedValue);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function setRankingMessage(message) {
    const status = document.querySelector("#ranking-status");
    if (status) status.textContent = message;
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
    if (PROMO_CAPTURE_MODE) updatePromoPlayer(player, delta);
    else input.updateHuman(player, delta);
  }

  function updatePromoPlayer(player, delta) {
    let targetX = player.fieldX + FIELD_WIDTH / 2 + Math.sin(elapsedRound * 1.4) * 96;
    let targetY = FIELD_BOTTOM - 92 + Math.sin(elapsedRound * 2.1) * 34;

    if (player.levelUpInvincible > 0 && boss.encounterState === "active" && boss.shieldAttackCharges > 0) {
      targetX = boss.x;
      targetY = boss.y + boss.radius + Math.max(18, getInvincibleRingDamageRadius(player) * 0.72);
    } else {
      const closestBullet = findClosestBullet(player);
      if (closestBullet) {
        const grazeSide = closestBullet.x < player.x ? 1 : -1;
        targetX = closestBullet.x + grazeSide * (closestBullet.radius + HIT_RADIUS + 9);
        targetY = closestBullet.y + 22;
      }
    }

    const moveX = Math.abs(targetX - player.x) < 3 ? 0 : Math.sign(targetX - player.x);
    const moveY = Math.abs(targetY - player.y) < 3 ? 0 : Math.sign(targetY - player.y);
    movePlayer(player, moveX, moveY, true, delta);
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
    updateRenderStressBullets();
    renderThreeBulletLayer();
    canvasRenderer.render({
      players,
      boss,
      opponentBoss,
      particles,
      elapsedRound,
      clearGame,
      lastRankingResult,
      cabinetRole,
      lastHitDebug,
      waitingForStart,
      paused,
      gameOver,
      spectatorPlayerIndex,
      renderStressBulletsByPlayer,
      sceneRendered: Boolean(sceneRenderer),
      compact: isCompactView(),
      versusSpectator: isVersusSpectator(),
      versusParticipant: isVersusParticipant(),
      bossEncounterInProgress: isBossEncounterInProgress(),
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
    });
  }

  function isCompactView() {
    return window.innerWidth <= 720;
  }


  function renderThreeBulletLayer() {
    if (!sceneRenderer) return;
    const compact = isCompactView();
    const selectedPlayerIndex = compact && isVersusSpectator() ? spectatorPlayerIndex : 0;
    const gpuReplay = (cabinetRole === "spectator" && !isVersusParticipant()) || GPU_REPLAY_DEMO;
    const demoRevision = GPU_REPLAY_DEMO
      ? players.reduce((total, player) => total + player.bullets.length, 0)
      : 0;
    sceneRenderer.render({ players, benchmarkBulletsByPlayer: renderStressBulletsByPlayer, boss, opponentBoss, particles }, elapsedRound, {
      compact,
      selectedPlayerIndex,
      fieldTop: FIELD_TOP,
      fieldBottom: FIELD_BOTTOM,
      fieldWidth: FIELD_WIDTH,
      gpuReplay,
      revision: spectatorBulletRevision + demoRevision,
    });
  }

  function installRendererBadge() {
    const gameFrame = canvas.closest(".game-frame");
    if (!gameFrame || gameFrame.querySelector("[data-three-renderer-badge]")) return;
    const badge = document.createElement("div");
    badge.dataset.threeRendererBadge = "true";
    badge.textContent = sceneRenderer ? "THREE.JS" : "CANVAS 2D";
    badge.style.cssText = [
      "position:absolute",
      "right:14px",
      "bottom:14px",
      "z-index:4",
      "padding:6px 9px",
      "border:1px solid rgba(105,247,255,.5)",
      "border-radius:999px",
      "background:rgba(3,7,20,.78)",
      "color:#69f7ff",
      "font:800 10px/1.5 ui-monospace,monospace",
      "letter-spacing:.12em",
      "white-space:pre",
      "pointer-events:none",
    ].join(";");
    gameFrame.appendChild(badge);
    scope.own(() => badge.remove());
  }

  function recordRenderStats(workTime) {
    if (!RENDER_STATS_ENABLED) return;
    renderStatsFrameCount += 1;
    renderStatsWorkTotal += workTime;
    renderStatsWorkMax = Math.max(renderStatsWorkMax, workTime);
    const now = performance.now();
    const sampleDuration = now - renderStatsStartedAt;
    if (sampleDuration < 500) return;
    const rendererMetrics = sceneRenderer?.getMetrics();
    const bulletCount = players.reduce(
      (total, player, index) => total + player.bullets.length + renderStressBulletsByPlayer[index].length,
      0,
    );
    const badge = document.querySelector("[data-three-renderer-badge]");
    if (badge) {
      const lines = [
        sceneRenderer ? "THREE.JS" : "CANVAS 2D",
        `${Math.round(renderStatsFrameCount * 1000 / sampleDuration)} FPS  ${bulletCount} BULLETS`,
        `CPU ${Math.round(renderStatsWorkTotal / renderStatsFrameCount * 100) / 100}ms  MAX ${Math.round(renderStatsWorkMax * 100) / 100}ms`,
      ];
      if (rendererMetrics) {
        lines.push(`${rendererMetrics.drawCalls} DRAWS  GPU REPLAY ${rendererMetrics.gpuReplay ? "ON" : "OFF"}`);
      }
      badge.textContent = lines.join("\n");
    }
    renderStatsFrameCount = 0;
    renderStatsWorkTotal = 0;
    renderStatsWorkMax = 0;
    renderStatsStartedAt = now;
  }

  function updateRenderStressBullets() {
    if (!RENDER_STRESS_COUNT) return;
    const perPlayerCount = Math.ceil(RENDER_STRESS_COUNT / players.length);
    for (let playerIndex = 0; playerIndex < players.length; playerIndex += 1) {
      const player = players[playerIndex];
      const targetCount = Math.min(perPlayerCount, RENDER_STRESS_COUNT - playerIndex * perPlayerCount);
      const bullets = renderStressBulletsByPlayer[playerIndex];
      while (bullets.length < targetCount) {
        const index = bullets.length;
        bullets.push({
          id: 1_000_000 + playerIndex * perPlayerCount + index,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          radius: 4 + index % 4,
          color: ["#9ca7ff", "#ffdf7e", "#b8ff7a", "#d7b8ff", "#9cf7ff"][index % 5],
          type: "benchmark",
          shape: ["circle", "spinner", "line", "diamond", "smallCircle"][index % 5],
          rotation: (index % 24) * Math.PI / 12,
          age: 0,
        });
      }
      for (let index = 0; index < bullets.length; index += 1) {
        const bullet = bullets[index];
        const columnCount = 25;
        const column = index % columnCount;
        const row = Math.floor(index / columnCount);
        const horizontalRange = FIELD_WIDTH - 40;
        const verticalRange = FIELD_HEIGHT - 40;
        bullet.x = player.fieldX + 20 + (column / Math.max(1, columnCount - 1)) * horizontalRange;
        bullet.y = FIELD_TOP + 20 + ((row * 17 + elapsedRound * (32 + index % 13)) % verticalRange);
        bullet.age = elapsedRound + index * 0.01;
      }
    }
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
  return {
    async prepareSolo() {
      if (scope.disposed) return;
      if (currentCabinetId && cabinetClient.role === "player") return;
      if (currentCabinetId && cabinetRole === "joining") {
        const joined = await cabinetClient.waitForPlayer();
        if (scope.disposed || joined) return;
      }
      enterCabinet(createUuid());
      const ready = await cabinetClient.waitForPlayer();
      if (scope.disposed) return;
      if (!ready) throw new Error("Solo cabinet could not be prepared.");
    },
    async play(action, reservationId) {
      if (scope.disposed || !currentCabinetId) return false;
      if (action !== "start" && action !== "retry") return false;
      if (isVersusParticipant()) return false;
      const ready = await cabinetClient.waitForPlayer();
      if (scope.disposed || !ready) return false;
      if (!reservationId || !await cabinetClient.startSolo(reservationId) || scope.disposed) return false;
      const started = startSoloPlay(reservationId, true);
      if (started && action === "retry") rankingSubmitPanel?.classList.remove("is-visible");
      return started;
    },
    dispose() {
      scope.dispose();
    },
  };
}
