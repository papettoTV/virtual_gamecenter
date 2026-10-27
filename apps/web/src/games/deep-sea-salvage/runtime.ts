import { notifications } from "../../features/notifications/notifications";
import { renderResultSummary } from "../../features/game/result-summary";
import { resultSharing } from "../../features/sharing/result-sharing";
import { setLiveContext } from "../../features/sharing/share-service";
import { createCabinetSession } from "../../game-sdk/cabinet-session";
import { gameHost } from "../../game-sdk/game-host";
import type { GameContext, GameInstance } from "../../game-sdk/contracts";
import { createUuid } from "../../shared/id";
import { recordWatchStarted } from "../../features/engagement/engagement-client";
import type { CabinetRole, CabinetState } from "../../domain/cabinet";
import type { ServerMessage } from "../../shared/protocol";
import { SalvageLiveBuffer, type SalvageLiveState, type SalvageLiveWorld } from "./live-state";
import { DEEP_SEA_SALVAGE } from "../../domain/game";
import { fetchScoreRanking, submitRankingEntry, loadRankingWithNotice } from "../../features/ranking/ranking-client";
import {
  BASE_POWER_DRAIN,
  MAX_HULL,
  DEFAULT_BOSS_INTERVAL,
  DEFAULT_BOSS_START_DEPTH,
} from "./core";
import { loadTerrainCourse } from "./terrain";
import { initTerrainEditor } from "./terrain-editor";

import { SPECIES, speciesById } from "./species";
import { createState } from "./state";
import { createSimulation } from "./simulation";
import { createRenderer } from "./renderer";
import { clamp } from "./utils";

export function mountGame(context: GameContext): GameInstance {
  const scope = context.lifetime;
  if (scope.disposed) return { play: () => false, dispose: () => {} };
  let actionGeneration = 0;
  let playPending = false;
  let preparePending: Promise<boolean> | null = null;
  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  const arcadeScreen = document.querySelector<HTMLElement>("#arcade-screen");
  const cabinetScreen = document.querySelector<HTMLElement>("#cabinet-screen");
  const gameScreen = document.querySelector<HTMLElement>("#game-screen");
  const rankingPanel = document.querySelector<HTMLElement>("#ranking-submit-panel");
  const rankingSubmit = document.querySelector<HTMLButtonElement>("#ranking-submit");
  const rankingName = document.querySelector<HTMLInputElement>("#ranking-name");
  const rankingList = document.querySelector<HTMLElement>("#ranking-list");
  const rankingSubmitList = document.querySelector<HTMLElement>("#ranking-submit-list");
  const rankingRetry = document.querySelector<HTMLButtonElement>("#ranking-retry");
  const touchPause = document.querySelector<HTMLButtonElement>("#touch-pause");
  const touchCollection = document.querySelector<HTMLButtonElement>("#touch-collection");
  const resultCollectionButton = document.querySelector<HTMLButtonElement>("#salvage-result-collection");

  const keys = new Set<string>();
  const pointer = { active: false, x: 0, y: 0 };
  const debugParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const debugNumber = (name: string, fallback: number) => {
    if (!debugParams.has(name)) return fallback;
    const value = Number(debugParams.get(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const config = {
    initialPower: debugNumber("power", 100),
    powerDrain: debugNumber("powerDrain", BASE_POWER_DRAIN),
    rareRate2: debugNumber("rareRate2", .001),
    rareRate3: debugNumber("rareRate3", .01),
    researchScale: debugNumber("researchScale", 1),
    bossStart: debugNumber("bossStart", DEFAULT_BOSS_START_DEPTH),
    bossInterval: debugNumber("bossInterval", DEFAULT_BOSS_INTERVAL),
  };

  const state = createState(W, loadTerrainCourse());
  const simulation = createSimulation(state, config, { keys, pointer }, { width: W, height: H, horizontalBounds }, {
    updateButtons,
    onFinish(title, multiplier) {
      showResult(title, multiplier);
      if (playing) cabinetClient.send({ type: "stopSolo" });
    },
  });
  const { update, ensureChunks, startDive, setMessage } = simulation;
  const renderer = createRenderer(canvas, state, simulation, debugParams, () => watching);
  scope.own(() => renderer.dispose());
  const { draw, drawOverlay } = renderer;
  const threeRendererEnabled = debugParams.get("renderer") !== "2d" && debugParams.get("threeGame") !== "0";
  if (threeRendererEnabled) {
    void import("./three-game-layer")
      .then(({ DeepSeaThreeLayer }) => scope.disposed ? null : DeepSeaThreeLayer.create())
      .then((layer) => { if (layer) renderer.setThreeLayer(layer); })
      .catch((error: unknown) => { if (scope.disposed) return; console.warn("Three.js gameplay layer unavailable; using the 2D renderer.", error); });
  }

  let lastTime = performance.now();

  let runId = createUuid();
  let cabinetId = window.location.pathname.match(/^\/cabinets\/([^/]+)/)?.[1] ?? null;
  let cabinetRole: CabinetRole = "visitor";
  let playing = false;
  let liveShareScreen = false;
  let liveShareContextKey = "";
  let watching = new URLSearchParams(window.location.search).get("watch") === "1";
  let autoWatch = true;
  let viewerHasState = false;
  let streamSequence = 0;
  let lastStreamAt = 0;
  let lastWorldAt = -Infinity;
  const liveBuffer = new SalvageLiveBuffer();
  const spectatorBanner = document.querySelector<HTMLElement>("#spectator-banner");
  const spectatorStatus = document.querySelector<HTMLElement>("#spectator-status-text");
  const spectatorCount = document.querySelector<HTMLElement>("#spectator-count");
  const cabinetClient = createCabinetSession({
    gameId: DEEP_SEA_SALVAGE.id, lifetime: scope,
    onMessage: handleCabinetMessage,
    onConnectionChange(connected) {
      if (scope.disposed) return;
      if (watching && spectatorStatus) spectatorStatus.textContent = connected ? "ライブ映像を受信しています。" : "再接続しています…";
    },
    onError(message) { if (scope.disposed) return; notifications.show({ id: "salvage-connection", scope: DEEP_SEA_SALVAGE.id, type: "error", message }); },
  });

  function enterWatch() {
    resultSharing.clear(DEEP_SEA_SALVAGE.id);
    watching = true;
    playing = false;
    keys.clear(); pointer.active = false;
    showScreen("game");
    if (cabinetId) recordWatchStarted(DEEP_SEA_SALVAGE.id, cabinetId);
  }

  function handleCabinetMessage(event: ServerMessage) {
    if (scope.disposed) return;
    if (event.type === "joinedCabinet" || event.type === "roleChanged") {
      cabinetRole = event.role;
      if (playing && cabinetRole === "player") {
        if (!playPending) cabinetClient.send({ type: "startSolo" });
        lastWorldAt = -Infinity; lastStreamAt = 0;
      } else if (playing) {
        playing = false; enterWatch();
      }
    }
    if (event.type === "cabinetState") {
      updateAudience(event.state);
      if (!playing && autoWatch && (watching || event.state.playerCount > 0)) enterWatch();
    }
    if (event.type === "viewerKeyframe" || event.type === "viewerMotionFrame") {
      const payload = event.type === "viewerKeyframe" ? event.snapshot : event.frame;
      if (payload.gameId !== DEEP_SEA_SALVAGE.id || payload.version !== 1 || !payload.state) return;
      const snapshot = payload.state as unknown as SalvageLiveState;
      if (!watching || !liveBuffer.push(snapshot, event.seq, performance.now())) return;
      if (event.type === "viewerKeyframe" && payload.world) {
        const world = payload.world as unknown as SalvageLiveWorld;
        state.terrainCourse = world.terrainCourse; state.hazards = world.hazards;
      }
      viewerHasState = true;
      if (spectatorStatus) spectatorStatus.textContent = snapshot.phase === "result" ? "プレイヤーが続けるか終了するかを選んでいます。" : "ライブ観戦中";
    }
    if (event.type === "playerLeft") {
      viewerHasState = false; liveBuffer.clear();
      if (spectatorStatus) spectatorStatus.textContent = "プレイヤーが筐体を離れました。";
    }
    if (event.type === "error") notifications.show({ id: "salvage-connection", scope: DEEP_SEA_SALVAGE.id, type: "error", message: event.message });
  }

  function updateAudience(state: CabinetState) {
    if (spectatorCount) spectatorCount.textContent = `観戦者 ${state.spectatorCount}人`;
    const pulse = document.querySelector<HTMLElement>("#player-crowd-pulse");
    pulse?.classList.toggle("is-hidden", state.spectatorCount === 0 || !playing);
    pulse?.style.setProperty("--crowd-intensity", String(Math.min(1, Math.log2(state.spectatorCount + 1) / 4)));
  }

  function publishLiveState(now: number) {
    if (!playing || cabinetRole !== "player" || now - lastStreamAt < 1000 / 15 || cabinetClient.getBufferedAmount() > 64_000) return;
    const snapshot: SalvageLiveState = {
      runId, phase: state.phase, paused: state.paused, collectionOpen: state.collectionOpen, elapsed: state.elapsed, subX: state.subX, subDepth: state.subDepth, maxDepth: state.maxDepth, subVDepth: state.subVDepth, subHeading: state.subHeading,
      invincible: state.invincible, hull: state.hull, power: state.power, earnedScore: state.earnedScore, finalScore: state.finalScore, cleared: state.cleared, retryCount: state.retryCount, bossProgress: state.bossProgress, boss: state.boss,
      bossClearTimer: state.bossClearTimer, hullBreakTimer: state.hullBreakTimer, hullBreakTitle: state.hullBreakTitle, bossGaugeVisible: state.bossGaugeVisible, fishes: state.fishes,
      targetFishIds: [...state.targetFishIds], discovered: [...state.discovered], message: state.message, messageTimer: state.messageTimer,
    };
    const keyframe = now - lastWorldAt >= 1000;
    const payload = { gameId: DEEP_SEA_SALVAGE.id, version: 1, state: snapshot, ...(keyframe ? { world: { terrainCourse: state.terrainCourse, hazards: state.hazards } } : {}) };
    if (cabinetClient.send({ type: keyframe ? "gameKeyframe" : "gameMotionFrame", seq: ++streamSequence, [keyframe ? "snapshot" : "frame"]: payload })) {
      lastStreamAt = now;
      if (keyframe) lastWorldAt = now;
    }
  }

  function applyLiveState(now: number) {
    const snapshot = liveBuffer.sample(now);
    if (!snapshot) return;
    ({ phase: state.phase, paused: state.paused, collectionOpen: state.collectionOpen, elapsed: state.elapsed, subX: state.subX, subDepth: state.subDepth, maxDepth: state.maxDepth, subVDepth: state.subVDepth, subHeading: state.subHeading,
      invincible: state.invincible, hull: state.hull, power: state.power, earnedScore: state.earnedScore, finalScore: state.finalScore, cleared: state.cleared, retryCount: state.retryCount, bossProgress: state.bossProgress, boss: state.boss,
      bossClearTimer: state.bossClearTimer, hullBreakTimer: state.hullBreakTimer, hullBreakTitle: state.hullBreakTitle, bossGaugeVisible: state.bossGaugeVisible, fishes: state.fishes, message: state.message, messageTimer: state.messageTimer } = snapshot);
    state.targetFishIds = new Set(snapshot.targetFishIds); state.discovered = new Set(snapshot.discovered);
  }

  function showScreen(screen: "arcade" | "cabinet" | "game") {
    liveShareScreen = screen === "game";
    if (screen === "arcade") notifications.clearScope(DEEP_SEA_SALVAGE.id);
    document.body.classList.toggle("is-game-screen", screen === "game");
    arcadeScreen?.classList.toggle("is-hidden", screen !== "arcade");
    cabinetScreen?.classList.toggle("is-hidden", screen !== "cabinet");
    gameScreen?.classList.toggle("is-hidden", screen !== "game");
    document.body.classList.toggle("is-spectator", watching && screen === "game");
    spectatorBanner?.classList.toggle("is-hidden", !watching || screen !== "game");
    document.querySelector("#challenge-request")?.classList.add("is-hidden");
    document.querySelector("#open-terrain-editor")?.classList.toggle("is-hidden", watching);
    updateLiveShareContext();
  }

  function resetRun() {
    resultSharing.clear(DEEP_SEA_SALVAGE.id);
    runId = createUuid(); lastWorldAt = -Infinity; lastStreamAt = 0;
    simulation.reset(loadTerrainCourse(), {
      startDepth: debugNumber("startDepth", 0), hull: debugNumber("hull", MAX_HULL),
      bossProgress: debugNumber("bossProgress", 0), terrainPreview: debugParams.get("terrainPreview") === "1",
    });
    rankingPanel?.classList.remove("is-visible", "is-submitted");
    ensureChunks(); setMessage("P / 画面下のボタンで潜航開始", 99); updateButtons();
    if (debugParams.get("terrainPreview") === "1") setMessage("地形確認（明るく表示） / Pで通常の潜航開始 / 岩壁エディタで編集へ戻る", 99);
  }

  function showResult(title: string, multiplier: number) {
    if (scope.disposed) return;
    if (playing && !watching && cabinetRole === "player" && state.phase === "result") {
      resultSharing.setResult({
        id: runId, gameId: DEEP_SEA_SALVAGE.id, gameVersion: DEEP_SEA_SALVAGE.currentVersion,
        elapsedTimeMs: Math.max(1, Math.round(state.elapsed * 1000)), cleared: state.cleared, score: state.finalScore,
        metrics: { maxDepth: Math.floor(state.maxDepth), discoveredCount: state.discovered.size,
          totalSpeciesCount: SPECIES.length, speciesIds: [...state.discovered].sort().join(",") },
      });
    }
    const rareCount = [...state.discovered].filter((id) => speciesById.get(id)?.rare).length;
    renderResultSummary({ title, score: state.finalScore, details: [
      ["図鑑", `${state.discovered.size}/21`], ["レア", `${rareCount}/5`],
      ["最大深度", `${Math.floor(state.maxDepth).toLocaleString()}m`],
      ["TIME", `${state.elapsed.toFixed(2)}s`],
      ["適用前スコア", state.finalSubtotal.toLocaleString()], ["倍率", `${(multiplier * 100).toFixed(0)}%`],
    ] });
    rankingPanel?.classList.add("is-visible"); rankingPanel?.classList.remove("is-submitted");
    if (rankingSubmit) rankingSubmit.disabled = !rankingName?.value.trim() || state.finalScore <= 0;
    if (rankingRetry) rankingRetry.textContent = state.cleared ? "1クレジットでもう一度" : "1クレジットでリトライ";
  }

  function retryFromResult() {
    resultSharing.clear(DEEP_SEA_SALVAGE.id);
    runId = createUuid();
    if (state.phase !== "result" || state.cleared) { resetRun(); startDive(); return; }
    simulation.continueRun();
    rankingPanel?.classList.remove("is-visible", "is-submitted");
    updateButtons(); lastTime = performance.now();
  }

  function togglePause() {
    if (watching) return;
    if (state.collectionOpen) { toggleCollection(); return; }
    if (state.phase === "ready") startDive(); else if (state.phase === "dive") state.paused = !state.paused;
    updateButtons();
  }

  function toggleCollection(force?: boolean) {
    if (watching) return;
    if (state.phase === "hull-break") return;
    if (state.paused && state.phase === "dive" && force === undefined) return;
    const next = force ?? !state.collectionOpen;
    state.collectionOpen = next;
    if (next) {
      state.returnToResult = state.phase === "result";
      rankingPanel?.classList.remove("is-visible");
    } else if (state.returnToResult) rankingPanel?.classList.add("is-visible");
    updateButtons();
  }

  function updateLiveShareContext() {
    const context = cabinetId && liveShareScreen ? {
        gameId: DEEP_SEA_SALVAGE.id, cabinetId,
        role: playing && !watching && cabinetRole === "player" ? "player" as const : "spectator" as const,
        phase: state.phase === "result" ? "finished" as const : state.phase === "ready" ? "ready" as const
          : state.paused || state.collectionOpen ? "paused" as const : "playing" as const,
    } : null;
    const key = JSON.stringify(context);
    if (key !== liveShareContextKey) {
      liveShareContextKey = key;
      setLiveContext(context);
    }
  }

  function updateButtons() {
    updateLiveShareContext();
    if (touchPause) {
      touchPause.textContent = state.phase === "ready" ? "潜航開始" : state.phase === "boss-clear" ? "調査完了" : state.phase === "hull-break" ? "大破" : state.paused ? "再開" : "一時停止";
      touchPause.disabled = state.phase === "boss-clear" || state.phase === "hull-break";
    }
    if (touchCollection) { touchCollection.textContent = state.collectionOpen ? "図鑑を閉じる" : "図鑑"; touchCollection.disabled = state.phase === "hull-break"; }
  }

  function isCompactCanvas() { const rect = canvas.getBoundingClientRect(); return rect.height > rect.width * 1.2; }
  function horizontalBounds(): [number, number] { return isCompactCanvas() ? [325, 635] : [42, W - 42]; }

  async function submitScore() {
    if (!state.finalScore || !rankingSubmit || !rankingName?.value.trim()) return;
    rankingSubmit.disabled = true;
    try {
      await submitRankingEntry({ gameId: DEEP_SEA_SALVAGE.id, elapsedTimeMs: Math.round(state.elapsed * 1000), cleared: state.cleared, score: state.finalScore, maxLevel: Math.floor(state.maxDepth), defeatedBossCount: state.cleared ? 1 : 0, clientVersion: DEEP_SEA_SALVAGE.currentVersion });
      if (scope.disposed) return;
      rankingPanel?.classList.add("is-submitted"); await loadRanking();
    } catch { if (!scope.disposed) rankingSubmit.disabled = false; }
  }

  async function loadRanking() {
    if (scope.disposed) return;
    await loadRankingWithNotice(DEEP_SEA_SALVAGE.id, async () => {
      if (scope.disposed) return;
      const entries = await fetchScoreRanking(DEEP_SEA_SALVAGE.id, 20, DEEP_SEA_SALVAGE.currentVersion);
      if (!scope.disposed) renderRanking(entries);
    });
  }
  function renderRanking(entries: Awaited<ReturnType<typeof fetchScoreRanking>>) {
    const html = entries.map((entry, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(entry.player_name)}</td><td>${entry.score.toLocaleString()}</td><td>${new Date(entry.created_at).toLocaleDateString("ja-JP")}</td></tr>`).join("") || '<tr><td colspan="4">まだ記録がありません</td></tr>';
    for (const element of [rankingList, rankingSubmitList]) if (element) element.innerHTML = html;
  }
  function escapeHtml(value: string) { const element = document.createElement("span"); element.textContent = value; return element.innerHTML; }

  scope.listen(window, "keydown", (event) => {
    if (watching || document.querySelector(".share-overlay")) return;
    keys.add(event.code); if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "KeyP") togglePause();
    if (event.code === "KeyF") toggleCollection();
    if (state.phase === "result" && event.code === "KeyR") gameHost.requestPlay("retry");
  });
  scope.listen(window, "keyup", (event) => keys.delete(event.code));
  scope.listen(canvas, "pointerdown", (event) => {
    if (watching) return;
    if (state.collectionOpen && state.returnToResult) { toggleCollection(false); return; }
    const rect = canvas.getBoundingClientRect(); pointer.active = true; pointer.x = (event.clientX - rect.left) * W / rect.width; pointer.y = (event.clientY - rect.top) * H / rect.height;
  });
  scope.listen(canvas, "pointermove", (event) => { if (pointer.active) { const rect = canvas.getBoundingClientRect(); pointer.x = (event.clientX - rect.left) * W / rect.width; pointer.y = (event.clientY - rect.top) * H / rect.height; } });
  scope.listen(window, "pointerup", () => { pointer.active = false; });
  if (touchPause) scope.listen(touchPause, "click", togglePause);
  if (touchCollection) scope.listen(touchCollection, "click", () => toggleCollection());
  if (resultCollectionButton) scope.listen(resultCollectionButton, "click", () => toggleCollection(true));
  if (rankingName) scope.listen(rankingName, "input", () => { if (rankingSubmit) rankingSubmit.disabled = !rankingName.value.trim() || !state.finalScore; });
  if (rankingSubmit) scope.listen(rankingSubmit, "click", () => void submitScore());
  const spectatorBack = document.querySelector("#spectator-game-back");
  if (spectatorBack) scope.listen(spectatorBack, "click", () => {
    watching = false; autoWatch = false; showScreen("cabinet");
  });
  const pauseBeforeShare = () => {
    if (!playing || watching || state.phase !== "dive") return;
    state.paused = true;
    keys.clear(); pointer.active = false;
    updateButtons();
    publishLiveState(performance.now());
  };
  scope.listen(window, "before-live-share", pauseBeforeShare);
  scope.listen(window, "request-cabinet-share", pauseBeforeShare);
  scope.listen(window, "pagehide", () => scope.dispose());
  scope.listen(window, "popstate", () => {
    resultSharing.clear(DEEP_SEA_SALVAGE.id);
    actionGeneration += 1;
    cabinetClient.leave(); cabinetRole = "visitor"; playing = false;
    liveBuffer.clear(); viewerHasState = false;
    cabinetId = window.location.pathname.match(/^\/cabinets\/([^/]+)/)?.[1] ?? null;
    watching = new URLSearchParams(window.location.search).get("watch") === "1";
    autoWatch = true;
    syncInitialScreen();
  });
  for (const id of ["back-to-arcade", "cabinet-breadcrumb-arcade", "game-back-to-arcade", "ranking-another-game"]) {
    const button = document.querySelector(`#${id}`);
    if (button) scope.listen(button, "click", () => window.location.assign("/"));
  }

  function syncInitialScreen() {
    showScreen(cabinetId ? watching ? "game" : "cabinet" : "arcade");
    if (cabinetId) cabinetClient.join(cabinetId, DEEP_SEA_SALVAGE.id, true);
  }
  function loop(now: number) {
    if (scope.disposed) return;
    const dt = Math.min(.05, (now - lastTime) / 1_000); lastTime = now;
    if (!document.hidden) {
      if (watching) {
        applyLiveState(now);
        if (viewerHasState) draw();
        else { ctx.fillStyle = "#04101c"; ctx.fillRect(0, 0, W, H); drawOverlay("LIVE", [spectatorStatus?.textContent ?? "プレイヤーのゲーム開始を待っています"]); }
      } else { update(dt); draw(); }
    }
    publishLiveState(now);
    updateLiveShareContext();
    scope.frame(loop);
  }
  scope.listen(document, "visibilitychange", () => { lastTime = performance.now(); });
  scope.own(initTerrainEditor());
  resetRun();
  if (debugParams.get("terrainEditor") === "1") {
    showScreen("game"); updateButtons();
  }
  else if (debugParams.get("surfacePreview") === "1") {
    showScreen("game"); updateButtons();
  }
  else if (debugParams.get("bossPractice") === "1") {
    state.subDepth = debugParams.has("startDepth") ? debugNumber("startDepth", 0) : Math.max(3_850, config.bossStart - 150);
    state.maxDepth = state.subDepth; state.nextBossDepth = config.bossStart; state.phase = "dive"; state.paused = false; showScreen("game"); updateButtons();
    if (debugParams.get("turnPractice") === "1") {
      state.subVx = -160;
      state.subHeadingTarget = Math.PI;
    }
    const headingPreview = debugParams.get("headingPreview");
    if (headingPreview === "front") state.subHeading = state.subHeadingTarget = Math.PI / 2;
    else if (headingPreview === "left") state.subHeading = state.subHeadingTarget = Math.PI;
    else if (headingPreview !== null && Number.isFinite(Number(headingPreview))) {
      state.subHeading = state.subHeadingTarget = clamp(Number(headingPreview), 0, 180) * Math.PI / 180;
    }
  }
  else syncInitialScreen();
  void loadRanking(); scope.frame(loop);

  async function prepareSolo(): Promise<boolean> {
    if (scope.disposed || playPending) return false;
    if (preparePending) return preparePending;
    preparePending = (async () => {
      const generation = ++actionGeneration;
      playing = watching = false; autoWatch = false;
      liveBuffer.clear(); viewerHasState = false;
      if (!cabinetId) {
        cabinetClient.leave(); cabinetRole = "visitor"; cabinetId = createUuid();
        history.pushState({}, "", `/cabinets/${cabinetId}?game=${DEEP_SEA_SALVAGE.id}`);
      }
      if (cabinetClient.role !== "player") cabinetClient.join(cabinetId, DEEP_SEA_SALVAGE.id);
      const ready = await cabinetClient.waitForPlayer();
      return ready && !scope.disposed && generation === actionGeneration;
    })();
    try { return await preparePending; } finally { preparePending = null; }
  }

  async function play(action: "start" | "retry", reservationId?: string): Promise<boolean> {
    if (scope.disposed || playPending) return false;
    if (preparePending && !await preparePending) return false;
    if (!cabinetId && !await prepareSolo()) return false;
    if (scope.disposed || playPending || !cabinetId) return false;
    playPending = true;
    const generation = ++actionGeneration;
    autoWatch = false;
    try {
      if (cabinetClient.role !== "player") cabinetClient.join(cabinetId, DEEP_SEA_SALVAGE.id);
      if (!await cabinetClient.waitForPlayer() || scope.disposed || generation !== actionGeneration) return false;
      if (!reservationId || !await cabinetClient.startSolo(reservationId) || scope.disposed || generation !== actionGeneration) return false;
      watching = false; playing = true;
      if (action === "retry") retryFromResult(); else resetRun();
      showScreen("game"); lastTime = performance.now();
      return true;
    } finally { playPending = false; }
  }

  scope.own(() => {
    resultSharing.clear(DEEP_SEA_SALVAGE.id);
    setLiveContext(null);
    actionGeneration += 1; playing = watching = false;
    keys.clear(); pointer.active = false; liveBuffer.clear();
    notifications.clearScope(DEEP_SEA_SALVAGE.id);
    document.body.classList.remove("is-spectator");
  });
  return { play, prepareSolo: async () => { await prepareSolo(); }, dispose: () => scope.dispose() };
}
