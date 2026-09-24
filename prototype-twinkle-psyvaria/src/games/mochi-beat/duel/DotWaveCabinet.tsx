import { useEffect, useReducer, useRef } from "react";
import { createUuid } from "../../../shared/id";
import { createCabinetClient, type CabinetClient } from "../../../realtime/cabinet-client";
import type { CabinetState } from "../../../domain/cabinet";
import type { GameSnapshot, ServerMessage, VersusSeat } from "../../../shared/protocol";
import { PlatformExperience } from "../../../features/platform/PlatformExperience";
import { capturePlayCredit, fetchPlatformBootstrap, releasePlayCredit, reservePlayCredit, PlatformApiError } from "../../../features/platform/platform-client";
import MochiDuel from "./MochiDuel";
import { DuelAudio } from "./audio";
import { ServerClock, type DuelFrame, type DuelLink, type RemoteTap } from "./network";

export default function DotWaveCabinet() {
  const [, render] = useReducer(n => n + 1, 0);
  const client = useRef<CabinetClient | null>(null);
  const audio = useRef<DuelAudio | null>(null);
  const clock = useRef(new ServerClock());
  const data = useRef({
    cabinetId: "", room: null as CabinetState | null, pending: false, applied: false, queue: 0,
    busy: false, notice: "", result: null as Extract<ServerMessage, { type: "versusResult" }> | null,
    seat: null as VersusSeat | null, credit: false, reservation: null as string | null, revision: 0,
    seq: 0, inputSeq: 0, lastPublish: 0, bestFrameSeq: -1, countdown: 0, streamId: createUuid(), viewerStream: "",
    soloReady: null as ((started: boolean) => void) | null, resultAt: 0, returningToCpu: false, rematchPending: false, rematchRequested: false,
  });
  const link = useRef<DuelLink>({
    role: "visitor", side: null, connected: false, matchId: null, startsAt: null, startCost: 1, latest: null, inputs: [],
    now: () => clock.current.now(),
    beforeSolo: async () => {
      const d = data.current;
      if (!link.current.connected || link.current.role !== "player") return false;
      d.notice = "";
      let reservationId: string | undefined;
      try {
        if (!d.credit) {
          reservationId = (await reservePlayCredit(d.cabinetId, "dot-wave")).reservationId;
          if ((await capturePlayCredit(reservationId)).status !== "captured") throw new Error("credit_not_captured");
          walletChanged();
        }
        const started = await new Promise<boolean>(resolve => {
          const timer = window.setTimeout(() => { d.soloReady = null; resolve(false); }, 5000);
          d.soloReady = success => { clearTimeout(timer); d.soloReady = null; resolve(success); };
          if (!client.current?.send({ type: "startSolo", reservationId })) d.soloReady(false);
        });
        if (!started) throw new Error("disconnected");
        d.credit = true;
        link.current.startCost = 0;
        return true;
      } catch (error) {
        if (reservationId) await releasePlayCredit(reservationId).catch(() => {});
        showError(error);
        return false;
      }
    },
    soloEnded: () => {
      data.current.credit = false;
      link.current.startCost = 1;
      client.current?.send({ type: "stopSolo" });
      render();
    },
    publish: (engine, turnStartedAt) => {
      const d = data.current;
      if (link.current.role !== "player" || !link.current.connected || performance.now() - d.lastPublish < 80) return;
      d.lastPublish = performance.now();
      const frame: DuelFrame = { engine, turnStartedAt, sentAt: clock.current.now(), matchId: link.current.matchId, seq: ++d.seq, streamId: d.streamId };
      client.current?.send({ type: "gameKeyframe", seq: d.seq, snapshot: frame as unknown as GameSnapshot });
    },
    strike: (turn, seconds, action = "down") => {
      if (link.current.side !== 1 || !link.current.matchId) return;
      client.current?.send({ type: "versusProgress", matchId: link.current.matchId, seq: ++data.current.inputSeq, progress: { kind: "dotWaveTap", turn, seconds, action } });
    },
    finish: match => {
      if (link.current.side === 0 && link.current.matchId) client.current?.send({ type: "dotWaveResult", matchId: link.current.matchId, hp: match.hp, turn: match.turn });
    },
  });
  const d = data.current;
  const net = link.current;

  function walletChanged() { window.dispatchEvent(new Event("platform-wallet-changed")); }
  function showError(error: unknown) {
    const insufficientCredit = error instanceof PlatformApiError && error.code === "insufficient_credit";
    d.notice = insufficientCredit
      ? "クレジットが足りません。プロフィールの残高から補充してください。"
      : "接続またはクレジットの確認に失敗しました。もう一度お試しください。";
    d.busy = false; render();
    if (insufficientCredit) window.dispatchEvent(new Event("request-credit-topup"));
  }
  async function unlock() { audio.current ??= new DuelAudio(); await audio.current.resume(); }

  useEffect(() => {
    let disposed = false;
    const url = new URL(location.href);
    const existing = url.pathname.match(/^\/cabinets\/([a-zA-Z0-9-]+)$/)?.[1] ?? url.searchParams.get("cabinet");
    d.cabinetId = existing ?? createUuid();
    const watch = url.searchParams.get("watch") === "1";
    if (!existing) history.replaceState({}, "", `/cabinets/${d.cabinetId}?game=dot-wave`);
    const resetGame = () => { net.latest = null; net.inputs = []; d.bestFrameSeq = -1; d.revision++; };
    const handle = async (message: ServerMessage) => {
      if (disposed) return;
      if (message.type === "clockPong") clock.current.sample(message.sentAt, message.serverAt, Date.now());
      if (message.type === "dotWaveSoloStarted") d.soloReady?.(true);
      if (message.type === "joinedCabinet" || message.type === "roleChanged") {
        net.role = message.role;
        if (!net.matchId) { net.side = net.role === "player" ? 0 : null; resetGame(); }
      }
      if (message.type === "cabinetState") { d.room = message.state; if (message.state.status !== "challengePending") d.pending = false; }
      if (message.type === "viewerKeyframe") {
        const frame = message.snapshot as unknown as DuelFrame;
        if (frame.streamId !== d.viewerStream) { d.viewerStream = frame.streamId; d.bestFrameSeq = -1; }
        if (net.role === "player" || !frame.engine || frame.seq <= d.bestFrameSeq || (net.matchId && frame.matchId !== net.matchId)) return;
        d.bestFrameSeq = frame.seq; net.latest = frame;
      }
      if (message.type === "versusOpponentProgress" && message.matchId === net.matchId && net.side === 0 && message.progress.kind === "dotWaveTap") {
        net.inputs.push({ seq: message.seq, turn: message.progress.turn, seconds: message.progress.seconds, action: message.progress.action } as RemoteTap);
        if (net.inputs.length > 64) net.inputs.shift();
      }
      if (message.type === "challengeReceived") d.pending = true;
      if (message.type === "challengePending") { d.applied = true; d.busy = false; }
      if (message.type === "challengeQueueStatus") { d.applied = ["pending", "queued"].includes(message.status); d.queue = message.position ?? 0; }
      if (message.type === "challengeRejected") {
        d.applied = false; d.busy = false; d.notice = message.reason;
        if (d.reservation) await releasePlayCredit(d.reservation).catch(() => {});
        d.reservation = null; walletChanged();
      }
      if (message.type === "challengeAccepted") {
        d.pending = false; d.applied = false; d.busy = false; d.result = null; d.seat = message.seat; d.rematchPending = false; d.rematchRequested = false;
        net.matchId = message.matchId; net.side = message.seat === "host" ? 0 : 1; net.startsAt = null;
        audio.current?.stop(); resetGame(); render();
        try {
          if (message.reservationId) {
            if ((await capturePlayCredit(message.reservationId)).status !== "captured") throw new Error("credit_not_captured");
            d.reservation = null; walletChanged();
          }
          if (disposed || net.matchId !== message.matchId) return;
          client.current?.send({ type: "versusReady", matchId: message.matchId });
        } catch (error) { showError(error); client.current?.leave(); }
      }
      if (message.type === "rematchRequested") d.rematchPending = true;
      if (message.type === "rematchRejected") { d.rematchRequested = false; d.busy = false; if (d.reservation) await releasePlayCredit(d.reservation).catch(() => {}); d.reservation = null; walletChanged(); }
      if (message.type === "versusCountdown" && message.matchId === net.matchId) net.startsAt = message.startsAt;
      if (message.type === "versusResult" && message.matchId === net.matchId) { d.result = message; d.resultAt = Date.now(); }
      if (message.type === "versusEnded") {
        const keepResult = message.nextRole === "player" && Boolean(d.result) && !d.returningToCpu;
        net.matchId = null; net.startsAt = null; net.role = message.nextRole;
        if (!keepResult) net.side = message.nextRole === "player" ? 0 : null;
        d.credit = message.nextRole === "player";
        if (!keepResult) { d.seat = null; d.result = null; }
        d.returningToCpu = false; d.rematchPending = false; d.rematchRequested = false; d.busy = false; walletChanged(); d.notice = message.reason;
        net.startCost = d.credit ? 0 : 1;
        audio.current?.stop();
        if (keepResult) { net.latest = null; net.inputs = []; }
        else resetGame();
      }
      if (message.type === "playerLeft") { net.latest = null; audio.current?.stop(); resetGame(); d.notice = "プレイヤーが席を離れました。"; }
      if (message.type === "error") { d.notice = message.message; d.busy = false; d.soloReady?.(false); }
      render();
    };
    client.current = createCabinetClient({
      onMessage: message => { void handle(message); },
      onConnectionChange: connected => {
        net.connected = connected;
        if (connected) client.current?.send({ type: "clockPing", sentAt: Date.now() });
        if (!connected) { net.matchId = null; net.startsAt = null; net.latest = null; net.role = "visitor"; net.side = null; d.result = null; d.credit = false; audio.current?.stop(); resetGame(); }
        render();
      },
    });
    // Establish the account cookie before the WebSocket so reservations are tied to its player.
    void fetchPlatformBootstrap().then(() => { if (!disposed) client.current?.join(d.cabinetId, "dot-wave", watch); }).catch(showError);
    const timer = window.setInterval(() => {
      if (net.connected) client.current?.send({ type: "clockPing", sentAt: Date.now() });
      d.countdown = net.startsAt ? Math.max(0, Math.ceil((net.startsAt - net.now()) / 1000)) : 0;
      render();
    }, 500);
    return () => { disposed = true; clearInterval(timer); client.current?.leave(); audio.current?.dispose(); audio.current = null; };
  }, []);

  async function requestChallenge() {
    if (d.busy || d.applied || net.role !== "spectator") return;
    d.busy = true; d.notice = ""; render();
    try {
      await unlock();
      const reservation = await reservePlayCredit(d.cabinetId, "dot-wave", "challenge");
      d.reservation = reservation.reservationId; walletChanged();
      if (!client.current?.send({ type: "requestChallenge", reservationId: reservation.reservationId })) throw new Error("disconnected");
    } catch (error) { if (d.reservation) await releasePlayCredit(d.reservation).catch(() => {}); d.reservation = null; walletChanged(); showError(error); }
  }
  async function rematch() {
    if (d.busy || d.rematchRequested || !net.matchId) return;
    d.busy = true; render();
    try {
      await unlock();
      const reservation = await reservePlayCredit(d.cabinetId, "dot-wave", "rematch");
      d.reservation = reservation.reservationId;
      if (!client.current?.send({ type: "requestRematch", matchId: net.matchId, reservationId: d.reservation })) throw new Error("disconnected");
      d.rematchRequested = true; d.busy = false; walletChanged(); render();
    } catch (error) { if (d.reservation) await releasePlayCredit(d.reservation).catch(() => {}); d.reservation = null; showError(error); }
  }
  async function respondRematch(accept: boolean) {
    if (!net.matchId) return;
    if (accept) await unlock();
    client.current?.send({ type: "respondRematch", matchId: net.matchId, accept });
    d.rematchPending = false; render();
  }
  async function respond(accept: boolean) {
    try { if (accept) await unlock(); client.current?.send({ type: "respondChallenge", accept }); d.pending = false; render(); }
    catch (error) { showError(error); }
  }
  async function share() {
    const url = `${location.origin}/cabinets/${d.cabinetId}?game=dot-wave&watch=1`;
    try { await navigator.clipboard.writeText(url); d.notice = "観戦URLをコピーしました。"; }
    catch { d.notice = url; }
    render();
  }
  function takeSeat() {
    if (!net.connected || d.room?.playerCount !== 0) return;
    const url = new URL(location.href);
    url.searchParams.delete("watch");
    history.replaceState({}, "", url);
    client.current?.join(d.cabinetId, "dot-wave");
  }
  function leaveResult() {
    if (net.matchId) {
      d.returningToCpu = d.result?.winner === d.seat || (d.result?.winner === "draw" && d.seat === "host");
      client.current?.send({ type: "dotWaveReturn", matchId: net.matchId });
    } else if (net.role === "player") {
      d.result = null; d.seat = null; net.side = 0; net.latest = null; net.inputs = []; d.revision++;
      audio.current?.stop(); render();
    }
  }
  const canChallenge = net.connected && net.role === "spectator" && !net.matchId && d.room && (["soloPlaying", "challengePending", "versusReady", "versusPlaying", "result"].includes(d.room.status) || (d.room.status === "occupied" && net.latest?.engine.phase === "finished"));
  return <>
    <div className="dot-cabinet-bar dot-wave">
      <span>{!net.connected ? "接続中…" : net.matchId ? net.side === 1 ? "あなたはピンク側" : "あなたはシアン側" : net.role === "player" ? "あなたの筐体" : "観戦中"} · {d.room?.spectatorCount ?? 0}人</span>
      <button onClick={() => void share()}>観戦URLを共有</button>
      {canChallenge && !d.applied && <button disabled={d.busy} onClick={() => void requestChallenge()}>1クレジットで対戦</button>}
      {d.applied && <button onClick={() => client.current?.send({ type: "cancelChallenge" })}>{d.queue ? `${d.queue}人待ち` : "承認待ち"} · キャンセル</button>}
      {net.role === "spectator" && d.room?.playerCount === 0 && <button disabled={!net.connected} onClick={takeSeat}>この席でプレイ</button>}
      {net.role === "spectator" && !net.matchId && d.room?.status === "occupied" && net.latest?.engine.phase !== "finished" && <p role="status">別の画面がプレイヤー席を使用しています。その画面で開始するか、ゲーム一覧に戻って席を空けてください。</p>}
      {d.notice && <p role="status">{d.notice}</p>}

    </div>
    <MochiDuel key={d.revision} network={net} sharedAudio={audio}
      challengePending={d.pending && net.role === "player"}
      challengeNotice={<>{d.pending && net.role === "player" && <div className="dot-challenge-prompt" role="dialog" aria-label="対戦の申し込み"><strong>対戦の申し込みが来ました</strong><button onClick={() => void respond(true)}>対戦する</button><button onClick={() => void respond(false)}>今回は断る</button></div>}</>}
      boardNotice={<>{net.matchId && !net.startsAt && !d.result && <p role="status">対戦の準備中…</p>}</>}
      holdResult={Boolean(d.result && !net.matchId && net.role === "player")}
      resultPanel={<>{d.result && Date.now() - d.resultAt >= 2500 && <div className="dot-match-result" role="status"><strong>{d.result.winner === "draw" ? "引き分け" : d.result.winner === d.seat ? "あなたの勝ち！" : "相手の勝ち！"}</strong>{d.rematchPending && <div role="dialog" aria-label="再挑戦の申し込み"><strong>再挑戦の申し込みが来ました</strong><button onClick={() => void respondRematch(true).catch(showError)}>対戦する</button><button onClick={() => void respondRematch(false).catch(showError)}>今回は断る</button></div>}{d.result.winner !== "draw" && d.result.winner !== d.seat && <button disabled={d.busy || d.rematchRequested} onClick={() => void rematch()}>{d.rematchRequested ? "承認待ち" : "再挑戦（1クレジット）"}</button>}<button onClick={leaveResult}>{d.result.winner === d.seat || (d.result.winner === "draw" && d.seat === "host") ? "CPUと対戦し直す" : "観戦に戻る"}</button></div>}</>}
    />
    <PlatformExperience standaloneCredits/>
  </>;
}
