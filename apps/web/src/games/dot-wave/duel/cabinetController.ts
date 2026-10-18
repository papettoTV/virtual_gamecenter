import { notifications } from "../../../features/notifications/notifications";
import { resultSharing } from "../../../features/sharing/result-sharing";
import { setLiveContext, shareLive } from "../../../features/sharing/share-service";
import type { SharedResultDraft } from "../../../domain/shared-result";
import { DOT_WAVE } from "../../../domain/game";
import { recordWatchStarted, recordPlayStartedFromWatch } from "../../../features/engagement/engagement-client";
import type { Engine } from "./engine";
import { createUuid } from "../../../shared/id";
import type { CabinetClient } from "../../../realtime/cabinet-client";
import { createCabinetSession } from "../../../game-sdk/cabinet-session";
import type { CabinetState, DotWaveRoster } from "../../../domain/cabinet";
import type { ClientMessage, GameSnapshot, ServerMessage, VersusSeat } from "../../../shared/protocol";
import { capturePlayCredit as captureCredit, fetchPlatformBootstrap, releasePlayCredit, reservePlayCredit as reserveCredit, PlatformApiError } from "../../../features/platform/platform-client";
import { DuelAudio } from "./audio";
import { ServerClock, type DuelFrame, type DuelLink, type RemoteTap } from "./network";

export type CabinetTransportFactory = (handlers: {
  gameId: string;
  onMessage(message: ServerMessage): void;
  onConnectionChange(connected: boolean): void;
  onError(message: string): void;
}) => CabinetClient;

export function createDotWaveCabinetController(
  onChange: () => void,
  createTransport: CabinetTransportFactory = createCabinetSession,
) {
  let disposed = false;
  let started = false;
  let client: CabinetClient | null = null;
  let cleanup = () => {};
  let soloTimer: number | undefined;
  const audio = { current: null as DuelAudio | null };
  const clock = new ServerClock();
  let localEngine: Engine | null = null;
  let runId = createUuid();
  let runStartedAt = 0;
  let soloFinished = false;
  let resultDraft: SharedResultDraft | null = null;
  let liveContextKey = "";
  let playAttributionRecorded = false;
  function recordPlayStarted() {
    if (playAttributionRecorded) return;
    playAttributionRecorded = true;
    recordPlayStartedFromWatch(DOT_WAVE.id, d.cabinetId);
  }
  function clearResult() {
    resultDraft = null;
    soloFinished = false;
    resultSharing.clear(DOT_WAVE.id);
  }
  function recordResult(engine: Engine, side: 0 | 1, winner = engine.match.winner) {
    if (disposed || resultDraft || !runStartedAt || winner === null) return;
    resultDraft = {
      id: runId, gameId: DOT_WAVE.id, gameVersion: DOT_WAVE.currentVersion,
      elapsedTimeMs: Math.max(1, Math.round(engine.elapsedPlayMs ?? Math.max(0, clock.now() - runStartedAt))),
      cleared: winner === side, score: engine.score?.total ?? 0,
      metrics: { mode: engine.mode === "cpu" ? "solo" : "versus", outcome: winner === "draw" ? "draw" : winner === side ? "win" : "lose",
        turns: engine.match.turn, remainingHp: engine.match.hp[side] },
    };
    resultSharing.setResult(resultDraft);
    render();
  }
  function getLivePhase(): "ready" | "playing" | "paused" | "finished" {
    const phase = (net.side === 0 ? localEngine : net.latest?.engine)?.phase;
    if (d.result || phase === "finished") return "finished";
    if (net.matchId && net.startsAt && !phase) return "playing";
    return phase === "intro" || !phase ? "ready" : phase === "paused" ? "paused" : "playing";
  }
  function canShareLive() {
    return net.connected && Boolean(d.cabinetId)
      && !(net.matchId && net.side !== null && getLivePhase() === "playing");
  }
  async function pauseBeforeShare(event?: Event) {
    if (net.side === null) return;
    if (!canShareLive()) { event?.preventDefault(); return; }
    if (!localEngine || net.matchId || !["playing", "countdown"].includes(localEngine.phase)) return;
    localEngine.seconds = audio.current?.seconds ?? localEngine.seconds;
    localEngine.phase = "paused";
    render();
    await audio.current?.pause();
  }
  function updateLiveContext() {
    const context = d.cabinetId && net.connected ? {
      gameId: DOT_WAVE.id, cabinetId: d.cabinetId,
      role: net.side !== null ? "player" as const : "spectator" as const, phase: getLivePhase(),
    } : null;
    const key = JSON.stringify(context);
    if (key !== liveContextKey) { liveContextKey = key; setLiveContext(context); }
  }
  const render = () => { if (!disposed) { updateLiveContext(); onChange(); } };
  const send = (message: ClientMessage | Record<string, unknown>) => !disposed && Boolean(client?.send(message));
  const assertActive = () => { if (disposed) throw new Error("cabinet_disposed"); };
  async function reservePlayCredit(...args: Parameters<typeof reserveCredit>) {
    assertActive();
    const reservation = await reserveCredit(...args);
    if (disposed) {
      await releasePlayCredit(reservation.reservationId).catch(() => {});
      assertActive();
    }
    return reservation;
  }
  async function capturePlayCredit(...args: Parameters<typeof captureCredit>) {
    assertActive();
    const result = await captureCredit(...args);
    assertActive();
    return result;
  }
  const d = {
    resultPlayers: null as DotWaveRoster | null,
    cabinetId: "", room: null as CabinetState | null, pending: false, applied: false, queue: 0,
    busy: false, result: null as Extract<ServerMessage, { type: "versusResult" }> | null,
    seat: null as VersusSeat | null, credit: false, reservation: null as string | null, revision: 0,
    seq: 0, inputSeq: 0, lastPublish: 0, bestFrameSeq: -1, countdown: 0, streamId: createUuid(), viewerStream: "",
    soloReady: null as ((started: boolean) => void) | null, resultAt: 0, returningToCpu: false, rematchPending: false, rematchRequested: false,
  };
  const net: DuelLink = {
    role: "visitor", side: null, connected: false, matchId: null, startsAt: null, startCost: 1, latest: null, inputs: [],
    now: () => clock.now(),
    beforeSolo: async () => {
      if (disposed || !net.connected || net.role !== "player") return false;
      notifications.dismiss("dot-wave");
      let reservationId: string | undefined;
      try {
        if (!d.credit) {
          reservationId = (await reservePlayCredit(d.cabinetId, "dot-wave")).reservationId;
          if ((await capturePlayCredit(reservationId)).status !== "captured") throw new Error("credit_not_captured");
          walletChanged();
        }
        const started = await new Promise<boolean>(resolve => {
          soloTimer = window.setTimeout(() => { soloTimer = undefined; d.soloReady = null; resolve(false); }, 5000);
          d.soloReady = success => { clearTimeout(soloTimer); soloTimer = undefined; d.soloReady = null; resolve(success); };
          if (!send({ type: "startSolo", reservationId })) d.soloReady(false);
        });
        assertActive();
        if (!started) throw new Error("disconnected");
        d.credit = true;
        net.startCost = 0;
        clearResult(); runId = createUuid(); runStartedAt = clock.now();
        return true;
      } catch (error) {
        if (reservationId) await releasePlayCredit(reservationId).catch(() => {});
        showError(error);
        return false;
      }
    },
    soloEnded: () => {
      if (net.role === "player" && net.side === 0) soloFinished = true;
      d.credit = false;
      net.startCost = 1;
      send({ type: "stopSolo" });
      render();
    },
    publish: (engine, turnStartedAt) => {
      if (disposed) return;
      if (net.side !== null && engine.phase === "playing") recordPlayStarted();
      if (net.side === 0) {
        localEngine = engine;
        if (resultDraft && !["finished", "impact"].includes(engine.phase)) clearResult();
        if (soloFinished && !net.matchId && engine.phase === "finished" && net.role === "player") recordResult(engine, 0);
      }
      updateLiveContext();
      if (disposed || net.role !== "player" || !net.connected || performance.now() - d.lastPublish < 80) return;
      d.lastPublish = performance.now();
      const frame: DuelFrame = { engine, turnStartedAt, sentAt: clock.now(), matchId: net.matchId, seq: ++d.seq, streamId: d.streamId };
      send({ type: "gameKeyframe", seq: d.seq, snapshot: frame as unknown as GameSnapshot });
    },
    strike: (turn, seconds, action = "down") => {
      if (net.side !== 1 || !net.matchId) return;
      send({ type: "versusProgress", matchId: net.matchId, seq: ++d.inputSeq, progress: { kind: "dotWaveTap", turn, seconds, action } });
    },
    finish: match => {
      if (net.side === 0 && net.matchId) send({ type: "dotWaveResult", matchId: net.matchId, hp: match.hp, turn: match.turn });
    },
  };

  function walletChanged() { if (disposed) return; window.dispatchEvent(new Event("platform-wallet-changed")); }
  function showError(error: unknown) {
    if (disposed) return;
    const insufficientCredit = error instanceof PlatformApiError && error.code === "insufficient_credit";
    d.busy = false; render();
    if (insufficientCredit) {
      notifications.dismiss("dot-wave");
      window.dispatchEvent(new CustomEvent("request-credit-topup", { detail: {
        onDecline: () => { if (!disposed) notifications.show({ id: "dot-wave", scope: "dot-wave", type: "error",
          message: "クレジットが不足しています。補充状況はプロフィールで確認できます。" }); },
      } }));
    } else notifications.show({ id: "dot-wave", scope: "dot-wave", type: "error",
      message: "接続またはクレジットの確認に失敗しました。もう一度お試しください。" });
  }
  async function unlock() { assertActive(); audio.current ??= new DuelAudio(); await audio.current.resume(); assertActive(); }

  function start() {
    assertActive();
    if (started) return;
    started = true;
    notifications.clearScope("dot-wave");
    const url = new URL(location.href);
    const existing = url.pathname.match(/^\/cabinets\/([a-zA-Z0-9-]+)$/)?.[1] ?? url.searchParams.get("cabinet");
    d.cabinetId = existing ?? createUuid();
    const watch = url.searchParams.get("watch") === "1";
    if (url.searchParams.has("start")) {
      url.searchParams.delete("start");
      history.replaceState(history.state, "", `${url.pathname}${url.search}`);
    }
    if (!existing) history.replaceState({}, "", `/cabinets/${d.cabinetId}?game=dot-wave`);
    const resetGame = () => { clearResult(); playAttributionRecorded = false; localEngine = null; runStartedAt = 0; net.latest = null; net.inputs = []; d.bestFrameSeq = -1; d.revision++; };
    const handle = async (message: ServerMessage) => {
      if (disposed) return;
      if (message.type === "clockPong") clock.sample(message.sentAt, message.serverAt, Date.now());
      if (message.type === "dotWaveSoloStarted") d.soloReady?.(true);
      if (message.type === "joinedCabinet" || message.type === "roleChanged") {
        net.role = message.role;
        if (!net.matchId) { net.side = net.role === "player" ? 0 : null; resetGame(); }
      }
      if (message.type === "cabinetState") { d.room = message.state; if (message.state.status === "result") d.resultPlayers = message.state.dotWavePlayers ?? null; if (message.state.status !== "challengePending") d.pending = false; }
      if (message.type === "viewerKeyframe") {
        const frame = message.snapshot as unknown as DuelFrame;
        if (frame.streamId !== d.viewerStream) { d.viewerStream = frame.streamId; d.bestFrameSeq = -1; }
        if (net.role === "player" || !frame.engine || frame.seq <= d.bestFrameSeq || (net.matchId && frame.matchId !== net.matchId)) return;
        d.bestFrameSeq = frame.seq; net.latest = frame;
        if (net.side === null) recordWatchStarted(DOT_WAVE.id, d.cabinetId);
        else if (frame.engine.phase === "playing") recordPlayStarted();
        if (d.result && net.side !== null && d.seat && frame.engine.match.winner !== null) {
          recordResult(frame.engine, net.side, d.result.winner === "draw" ? "draw" : d.result.winner === "host" ? 0 : 1);
        }
      }
      if (message.type === "versusOpponentProgress" && message.matchId === net.matchId && net.side === 0 && message.progress.kind === "dotWaveTap") {
        net.inputs.push({ seq: message.seq, turn: message.progress.turn, seconds: message.progress.seconds, action: message.progress.action } as RemoteTap);
        if (net.inputs.length > 64) net.inputs.shift();
      }
      if (message.type === "challengeReceived") d.pending = true;
      if (message.type === "challengePending") { d.applied = true; d.busy = false; }
      if (message.type === "challengeQueueStatus") { d.applied = ["pending", "queued"].includes(message.status); d.queue = message.position ?? 0; }
      if (message.type === "challengeRejected") {
        d.applied = false; d.busy = false; notifications.show({ id: "dot-wave", scope: "dot-wave", type: "info", message: message.reason });
        if (d.reservation) await releasePlayCredit(d.reservation).catch(() => {});
        d.reservation = null; walletChanged();
      }
      if (message.type === "challengeAccepted") {
        d.pending = false; d.applied = false; d.busy = false; d.result = null; d.resultPlayers = null; d.seat = message.seat; d.rematchPending = false; d.rematchRequested = false;
        net.matchId = message.matchId; net.side = message.seat === "host" ? 0 : 1; net.startsAt = null;
        audio.current?.stop(); resetGame(); runId = createUuid(); runStartedAt = clock.now(); render();
        try {
          if (message.reservationId) {
            if ((await capturePlayCredit(message.reservationId)).status !== "captured") throw new Error("credit_not_captured");
            d.reservation = null; walletChanged();
          }
          if (disposed || net.matchId !== message.matchId) return;
          send({ type: "versusReady", matchId: message.matchId });
        } catch (error) { showError(error); client?.leave(); }
      }
      if (message.type === "rematchRequested") d.rematchPending = true;
      if (message.type === "rematchRejected") { d.rematchRequested = false; d.busy = false; if (d.reservation) await releasePlayCredit(d.reservation).catch(() => {}); d.reservation = null; walletChanged(); }
      if (message.type === "versusCountdown" && message.matchId === net.matchId) net.startsAt = message.startsAt;
      if (message.type === "versusResult" && message.matchId === net.matchId) {
        d.result = message; d.resultAt = Date.now();
        const engine = net.side === 0 ? localEngine : net.latest?.engine;
        if (engine && engine.match.winner !== null && net.side !== null && d.seat) {
          recordResult(engine, net.side, message.winner === "draw" ? "draw" : message.winner === "host" ? 0 : 1);
        }
      }
      if (message.type === "versusEnded") {
        const keepResult = message.nextRole === "player" && Boolean(d.result) && !d.returningToCpu;
        net.matchId = null; net.startsAt = null; net.role = message.nextRole;
        if (!keepResult) net.side = message.nextRole === "player" ? 0 : null;
        d.credit = message.nextRole === "player";
        if (!keepResult) { d.seat = null; d.result = null; }
        d.returningToCpu = false; d.rematchPending = false; d.rematchRequested = false; d.busy = false; walletChanged(); notifications.show({ id: "dot-wave", scope: "dot-wave", type: "info", message: message.reason });
        net.startCost = d.credit ? 0 : 1;
        audio.current?.stop();
        if (keepResult) { net.latest = null; net.inputs = []; }
        else resetGame();
      }
      if (message.type === "playerLeft") { net.latest = null; audio.current?.stop(); resetGame(); notifications.show({ id: "dot-wave", scope: "dot-wave", type: "info", message: "プレイヤーが席を離れました。" }); }
      if (message.type === "error") { notifications.show({ id: "dot-wave", scope: "dot-wave", type: "error", message: message.message }); d.busy = false; d.soloReady?.(false); }
      render();
    };
    client = createTransport({
      gameId: "dot-wave",
      onError: message => { if (!disposed) notifications.show({ id: "dot-wave", scope: "dot-wave", type: "error", message }); },
      onMessage: message => { void handle(message).catch(showError); },
      onConnectionChange: connected => {
        if (disposed) return;
        net.connected = connected;
        if (connected) send({ type: "clockPing", sentAt: Date.now() });
        if (!connected) { d.soloReady?.(false); net.matchId = null; net.startsAt = null; net.latest = null; net.role = "visitor"; net.side = null; d.result = null; d.credit = false; audio.current?.stop(); resetGame(); }
        render();
      },
    });
    // Establish the account cookie before the WebSocket so reservations are tied to its player.
    void fetchPlatformBootstrap().then(() => { if (!disposed) client?.join(d.cabinetId, "dot-wave", watch); }).catch(showError);
    const refreshProfile = () => send({ type: "refreshDotWaveProfile" });
    const beforeShare = (event: Event) => { void pauseBeforeShare(event).catch(showError); };
    window.addEventListener("before-live-share", beforeShare);
    window.addEventListener("request-cabinet-share", beforeShare);
    window.addEventListener("platform-profile-changed", refreshProfile);
    const timer = window.setInterval(() => {
      if (net.connected) send({ type: "clockPing", sentAt: Date.now() });
      d.countdown = net.startsAt ? Math.max(0, Math.ceil((net.startsAt - net.now()) / 1000)) : 0;
      render();
    }, 500);
    cleanup = () => {
      d.soloReady?.(false);
      clearTimeout(soloTimer);
      window.removeEventListener("before-live-share", beforeShare);
      window.removeEventListener("request-cabinet-share", beforeShare);
      window.removeEventListener("platform-profile-changed", refreshProfile);
      notifications.clearScope("dot-wave");
      clearInterval(timer);
      client?.leave();
      client = null;
      net.connected = false;
      audio.current?.dispose();
      audio.current = null;
    };
  }

  function dispose() { if (disposed) return; clearResult(); setLiveContext(null); disposed = true; cleanup(); }

  async function requestChallenge() {
    if (disposed || d.busy || d.applied || net.role !== "spectator") return;
    d.busy = true; notifications.dismiss("dot-wave"); render();
    try {
      await unlock();
      const reservation = await reservePlayCredit(d.cabinetId, "dot-wave", "challenge");
      d.reservation = reservation.reservationId; walletChanged();
      if (!send({ type: "requestChallenge", reservationId: reservation.reservationId })) throw new Error("disconnected");
    } catch (error) { if (d.reservation) await releasePlayCredit(d.reservation).catch(() => {}); d.reservation = null; walletChanged(); showError(error); }
  }
  async function rematch() {
    if (disposed || d.busy || d.rematchRequested || !net.matchId) return;
    d.busy = true; render();
    try {
      await unlock();
      const reservation = await reservePlayCredit(d.cabinetId, "dot-wave", "rematch");
      d.reservation = reservation.reservationId;
      if (!send({ type: "requestRematch", matchId: net.matchId, reservationId: d.reservation })) throw new Error("disconnected");
      d.rematchRequested = true; d.busy = false; walletChanged(); render();
    } catch (error) { if (d.reservation) await releasePlayCredit(d.reservation).catch(() => {}); d.reservation = null; showError(error); }
  }
  async function respondRematch(accept: boolean) {
    if (disposed || !net.matchId) return;
    if (accept) await unlock();
    send({ type: "respondRematch", matchId: net.matchId, accept });
    d.rematchPending = false; render();
  }
  async function respond(accept: boolean) {
    try { if (accept) await unlock(); send({ type: "respondChallenge", accept }); d.pending = false; render(); }
    catch (error) { showError(error); }
  }
  async function share() {
    if (disposed || !canShareLive()) return;
    try {
      await pauseBeforeShare();
      if (disposed) return;
      await shareLive({ gameId: DOT_WAVE.id, cabinetId: d.cabinetId,
        role: net.side !== null ? "player" : "spectator", phase: getLivePhase() });
    } catch (error) { showError(error); }
  }
  function takeSeat() {
    if (disposed || !net.connected || d.room?.playerCount !== 0) return;
    const url = new URL(location.href);
    url.searchParams.delete("watch");
    history.replaceState({}, "", url);
    client?.join(d.cabinetId, "dot-wave");
  }
  function leaveResult() {
    if (disposed) return;
    clearResult();
    if (net.matchId) {
      d.returningToCpu = d.result?.winner === d.seat || (d.result?.winner === "draw" && d.seat === "host");
      send({ type: "dotWaveReturn", matchId: net.matchId });
    } else if (net.role === "player") {
      d.result = null; d.seat = null; net.side = 0; net.latest = null; net.inputs = []; d.revision++;
      audio.current?.stop(); render();
    }
  }

  return {
    state: d, network: net, audio, start, dispose,
    requestChallenge, rematch, respondRematch, respond, share, takeSeat, leaveResult, showError,
    getResultShareDraft: () => resultDraft,
    getLivePhase, canShareLive,
    cancelChallenge: () => send({ type: "cancelChallenge" }),
  };
}

export type DotWaveCabinetController = ReturnType<typeof createDotWaveCabinetController>;
