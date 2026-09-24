import { notifications } from "../../../features/notifications/notifications";
import type { DotWaveRoster } from "../../../domain/cabinet";
import { useEffect, useReducer, useRef, type RefObject, type ReactNode } from "react";
import { turnCue, cueName, inputHint, countdownCue } from "./turnCue";
import { DotScene, PixelWord } from "./DotScene";
import { BattleIcon } from "./BattleIcon";
import { NeonRail } from "./NeonRail";
import { DuelAudio } from "./audio";
import { actorAt, BEAT, beatAt, levelAt, randomMove, cpuGrades, createExchange, createMatch, END_BEAT, expire, MAX_EXCHANGES, MAX_HP, MOVES, resolve, tap, release, type Ending, type Exchange, type Grade, type Match, type Resolution, type Side } from "./core";
import { INPUT_GRACE, validRemoteTap, type DuelLink, type DuelFrame } from "./network";
import "./style.css";

type Phase = "countdown" | "intro" | "playing" | "paused" | "impact" | "finished";
export type Engine = { phase: Phase; mode: "cpu" | "local" | "online"; match: Match; selected: number; exchange: Exchange | null; seconds: number; outcome: Resolution | null; impactElapsed: number; feedback: string; cpu: Grade[]; flash: { side: Side; grade: Grade; at: number } | null; inputWarning: { side: Side; at: number; message: string } | null };
const fresh = (mode: Engine["mode"] = "cpu", ending: Ending = "limited"): Engine => ({ phase: "intro", mode, match: createMatch(ending), selected: 0, exchange: null, seconds: 0, outcome: null, impactElapsed: 0, feedback: "", cpu: [], flash: null, inputWarning: null });

export default function MochiDuel({ players, network, sharedAudio, boardNotice, resultPanel, challengeNotice, challengePending = false, holdResult = false }: { players?: DotWaveRoster; network?: DuelLink; sharedAudio?: RefObject<DuelAudio | null>; boardNotice?: ReactNode; resultPanel?: ReactNode; challengeNotice?: ReactNode; holdResult?: boolean; challengePending?: boolean } = {}) {
  const engine = useRef(fresh(network?.matchId ? "online" : "cpu"));
  const ownSound = useRef<DuelAudio | null>(null);
  const sound = sharedAudio ?? ownSound;
  const lastFrame = useRef<DuelFrame | null>(null);
  const lastSoundFlash = useRef("");
  const remoteSeq = useRef(-1);
  const remoteAudioTurn = useRef(-1);
  const remoteTurnOrigin = useRef(0);
  const lastRemotePhase = useRef<Phase>("intro");
  const predicted = useRef<{ turn: number; flash: Engine["flash"]; warning: Engine["inputWarning"] } | null>(null);
  const replica = Boolean(network && network.role !== "player");
  const viewSide = network ? network.side : 0;
  const spectator = Boolean(network && viewSide === null);
  const heldInputs = useRef<[Set<string>, Set<string>]>([new Set(), new Set()]);
  const busy = useRef(false);
  const alive = useRef(true);
  const [, render] = useReducer((value: number) => value + 1, 0);
  const e = engine.current;
  const roster = useRef(players); roster.current = players;
  const name = (side: Side) => roster.current?.[side]?.name ?? (network ? `${side === network.side ? "あなた" : engine.current.mode === "cpu" && side === 1 ? "CPU" : "相手"} / ${side === 0 ? "CYAN" : "PINK"}` : side === 0 ? (engine.current.mode === "local" ? "1P / CYAN" : "あなた") : engine.current.mode === "cpu" ? "CPU / PINK" : "2P / PINK");

  useEffect(() => { if (holdResult) { engine.current.phase = "finished"; engine.current.match.winner ??= network?.side ?? 0; render(); } }, [holdResult]);

  async function toggleSound() {
    sound.current ??= new DuelAudio();
    if (sound.current.audible) sound.current.setMuted(true);
    else {
      sound.current.setMuted(false);
      if (engine.current.phase !== "paused") await sound.current.resume(); notifications.dismiss("game-audio");
      remoteAudioTurn.current = -1;
    }
    render();
  }
  async function begin() {
    const current = engine.current;
    if (current.phase !== "intro" || busy.current || replica || (network && (!network.connected || (network.matchId && !network.startsAt)))) return;
    busy.current = true;
    try {
      sound.current ??= new DuelAudio();
      await sound.current.resume(); notifications.dismiss("game-audio");
      if (network && !network.matchId && !await network.beforeSolo()) return;
      if (!alive.current) return;
      sound.current.volume(.65);
      current.selected = randomMove(current.match.turn);
      await sound.current.start(current.selected, beatAt(current.match.turn), network?.startsAt ? Math.max(0, (network.startsAt - network.now()) / 1000) : 3, network?.startsAt ? Math.max(0, (network.now() - network.startsAt) / 1000) : 0);
      if (!alive.current) return;
      current.exchange = createExchange(current.match.turn % 2 as Side, current.selected, beatAt(current.match.turn));
      current.cpu = current.mode === "cpu" ? cpuGrades(current.selected, current.exchange.attacker === 1) : [];
      current.seconds = sound.current.seconds; current.phase = "countdown"; current.feedback = "";
    } catch { notifications.show({ id: "game-audio", scope: "dot-wave", type: "error", message: "音を開始できませんでした。もう一度開始ボタンを押してください。" }); }
    finally { busy.current = false; if (alive.current) render(); }
  }
  function strike(side: Side) {
    const current = engine.current;
    if (current.phase !== "playing" || !current.exchange || !sound.current || (network && (!network.connected || network.side !== side))) return;
    const seconds = replica && network ? (network.now() - remoteTurnOrigin.current) / 1000 : sound.current.seconds;
    if (current.exchange.resolved || seconds >= END_BEAT * current.exchange.beatSeconds) return;
    const hint = inputHint(current.exchange, side, seconds);
    if (hint) {
      if (current.inputWarning?.side === side && seconds - current.inputWarning.at < .25) return;
      current.inputWarning = { side, at: seconds, message: hint };
      if (replica) predicted.current = { turn: current.match.turn, flash: null, warning: current.inputWarning };
      sound.current.waitTurn();
      render();
      return;
    }
    if (current.inputWarning?.side === side) current.inputWarning = null;
    if (replica) network?.strike(current.match.turn, seconds);
    const grade = tap(current.exchange, side, seconds);
    if (!grade) return;
    sound.current.hit(grade, side !== current.exchange.attacker);
    current.flash = { side, grade, at: seconds };
    if (replica) predicted.current = { turn: current.match.turn, flash: current.flash, warning: null };
    const attacking = side === current.exchange.attacker;
    current.feedback = `${name(side)}：${grade === "perfect" ? attacking ? "SYNC! 音符パルス発射！" : "SYNC! シールド成功！" : grade === "good" ? attacking ? "GOOD 小さなパルス" : "GOOD 一部をガード" : attacking ? "MISS リズムがずれた！" : "MISS ガード失敗！"}`;
    render();
  }
  function press(side: Side, source: string) {
    const held = heldInputs.current[side];
    if (held.has(source)) return;
    const wasHeld = held.size > 0;
    held.add(source);
    if (!wasHeld) strike(side);
  }
  function lift(side: Side, source?: string) {
    const held = heldInputs.current[side];
    if (!held.size || (source && !held.has(source))) return;
    if (source) held.delete(source); else held.clear();
    if (held.size) return;
    const current = engine.current;
    if (!current.exchange || !sound.current || !["playing", "paused"].includes(current.phase)) return;
    const seconds = replica && network ? (network.now() - remoteTurnOrigin.current) / 1000 : sound.current.seconds;
    if (replica) network?.strike(current.match.turn, seconds, "up");
    const grade = release(current.exchange, side, seconds);
    if (grade) {
      current.flash = {side, grade, at: seconds};
      if (replica) predicted.current = { turn: current.match.turn, flash: current.flash, warning: null };
      sound.current.hit(grade, side !== current.exchange.attacker);
      render();
    }
  }
  async function pause() {
    const current = engine.current;
    if (replica || network?.matchId || !sound.current || busy.current || !["playing", "paused"].includes(current.phase)) return;
    busy.current = true;
    try {
      if (current.phase === "playing") { current.phase = "paused"; render(); await sound.current.pause(); }
      else { await sound.current.resume(); notifications.dismiss("game-audio"); current.phase = "playing"; }
    } catch { current.phase = "paused"; notifications.show({ id: "game-audio", scope: "dot-wave", type: "error", message: "音を再開できませんでした。画面をタップするかPキーで再開してください。" }); }
    finally { busy.current = false; if (alive.current) render(); }
  }

  useEffect(() => {
    alive.current = true;
    const originalTitle = document.title;
    document.title = "DOT WAVE | Neon Rhythm Battle";
    const icon = document.createElement("link");
    icon.rel = "icon"; icon.type = "image/svg+xml"; icon.href = "/assets/dot-wave-icon.svg";
    document.head.appendChild(icon);
    let frameId = 0; let previous = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(.1, (now - previous) / 1000); previous = now;
      if (replica && network) {
        const frame = network.latest;
        if (frame && frame !== lastFrame.current) {
          lastFrame.current = frame;
          engine.current = structuredClone(frame.engine);
          if (network.side === 1) engine.current.feedback = engine.current.feedback.replaceAll("あなた / CYAN", "相手 / CYAN").replaceAll("相手 / PINK", "あなた / PINK");
          remoteTurnOrigin.current = frame.turnStartedAt;
          const flash = frame.engine.flash;
          const flashKey = `${frame.engine.match.turn}:${flash?.side}:${flash?.at}`;
          if (flash && frame.engine.phase === "playing" && flashKey !== lastSoundFlash.current) {
            lastSoundFlash.current = flashKey;
            const local = predicted.current;
            if (!(local?.turn === frame.engine.match.turn && local.flash?.side === flash.side && Math.abs(local.flash.at - flash.at) < .4)) sound.current?.hit(flash.grade, flash.side !== frame.engine.exchange?.attacker);
          }
          if (["countdown", "playing"].includes(frame.engine.phase) && sound.current && remoteAudioTurn.current !== frame.engine.match.turn) {
            remoteAudioTurn.current = frame.engine.match.turn;
            void sound.current.startAt(frame.engine.selected, frame.engine.exchange!.beatSeconds, frame.turnStartedAt, () => network.now());
          }
          if (frame.engine.phase !== lastRemotePhase.current) {
            if (frame.engine.phase === "paused") void sound.current?.pause();
            if (frame.engine.phase === "playing" && lastRemotePhase.current === "paused" && sound.current) void sound.current.startAt(frame.engine.selected, frame.engine.exchange!.beatSeconds, frame.turnStartedAt, () => network.now());
            if (frame.engine.phase === "impact") {
              sound.current?.stop();
              sound.current?.finish(frame.engine.match.winner === "draw" ? "draw" : frame.engine.match.winner === network.side ? "win" : "lose");
            }
            lastRemotePhase.current = frame.engine.phase;
          }
        }
        const remote = engine.current;
        if (["countdown", "playing"].includes(remote.phase) && remote.exchange) {
          remote.seconds = Math.min(END_BEAT * remote.exchange.beatSeconds, (network.now() - remoteTurnOrigin.current) / 1000);
          sound.current?.schedule(remote.match.ending === "knockout" || remote.match.turn < MAX_EXCHANGES - 1);
          const prediction = predicted.current;
          if (prediction?.turn === remote.match.turn) {
            if (prediction.flash && remote.seconds - prediction.flash.at < .45) remote.flash = prediction.flash;
            if (prediction.warning && remote.seconds - prediction.warning.at < .75 && actorAt(remote.exchange, remote.seconds) !== network.side) remote.inputWarning = prediction.warning;
          }
          if (remote.inputWarning && (remote.seconds - remote.inputWarning.at >= .75 || actorAt(remote.exchange, remote.seconds) === remote.inputWarning.side)) remote.inputWarning = null;
        }
        render();
        return;
      }
      const current = engine.current;
      if (network?.matchId && network.startsAt && current.phase === "intro") void begin();
      if (current.phase === "countdown" && sound.current) {
        current.seconds = sound.current.seconds;
        if (current.seconds >= 0) current.phase = "playing";
        render();
      }
      if ((!document.hidden || network?.connected) && current.phase === "playing" && sound.current && current.exchange) {
        current.seconds = Math.min(END_BEAT * current.exchange.beatSeconds, sound.current.seconds);
        sound.current.schedule(current.match.ending === "knockout" || current.match.turn < MAX_EXCHANGES - 1);
        const exchange = current.exchange;
        if (network?.matchId) {
          for (const input of network.inputs.splice(0)) {
            if (!validRemoteTap(input, current.match.turn, sound.current.seconds, remoteSeq.current)) continue;
            remoteSeq.current = input.seq;
            const grade = input.action === "up" ? release(exchange, 1, input.seconds) : tap(exchange, 1, input.seconds);
            if (grade) { current.flash = { side: 1, grade, at: current.seconds }; sound.current.hit(grade, exchange.attacker !== 1); }
          }
        }
        if (current.inputWarning && (current.seconds - current.inputWarning.at >= .75 || actorAt(exchange, current.seconds) === current.inputWarning.side)) current.inputWarning = null;
        if (current.mode === "cpu") {
          const chart = exchange.attacker === 1 ? exchange.attack : exchange.defense;
          chart.notes.forEach((note, index) => {
            if (note.grade === null && note.holdGrade && note.endBeat !== undefined && current.seconds >= note.endBeat * exchange.beatSeconds) {
              note.grade = note.holdGrade;
              current.flash = { side: 1, grade: note.grade, at: current.seconds };
              sound.current?.hit(note.grade, exchange.attacker !== 1);
            }
            if (note.grade === null && !note.holdGrade && current.seconds >= note.beat * exchange.beatSeconds) {
              note.grade = current.cpu[index]!;
              current.flash = { side: 1, grade: note.grade, at: current.seconds };
              if (note.grade !== "miss" && exchange.attacker === 0) sound.current?.hit(note.grade, true);
              if (note.endBeat !== undefined && note.grade !== "miss") { note.holdGrade = note.grade; note.grade = null; }
            }
          });
        }
        for (const [side, chart] of [[exchange.attacker, exchange.attack], [(1 - exchange.attacker) as Side, exchange.defense]] as const) {
          const before = chart.notes.filter(note => note.grade === null);
          expire(chart, current.seconds - (network?.matchId && side === 1 ? INPUT_GRACE : 0), exchange.beatSeconds);
          if ((current.mode !== "cpu" || side === 0) && before.some(note => note.grade === "miss")) {
            current.flash = { side, grade: "miss", at: current.seconds };
            current.feedback = `${name(side)}：MISS リズムが抜けた！`;
            sound.current.hit("miss", side !== exchange.attacker);
          }
        }
        if (sound.current.seconds >= END_BEAT * exchange.beatSeconds + (network?.matchId ? INPUT_GRACE : 0)) {
          current.inputWarning = null;
          current.outcome = resolve(current.match, exchange);
          current.feedback = current.outcome.damage > 0 ? `${name((1 - current.outcome.attacker) as Side)}に ${current.outcome.damage} ダメージ！` : current.outcome.counter ? "FULL SYNC! 反撃チャージ！" : "ダメージなし！";
          if (current.match.winner !== null) {
            current.phase = "impact"; current.impactElapsed = 0;
            if (network?.matchId) network.finish(current.match);
            sound.current.stop();
            sound.current.finish(current.match.winner === "draw" ? "draw" : current.mode === "local" || current.match.winner === 0 ? "win" : "lose");
          } else {
            sound.current.resolve(current.outcome.damage, current.outcome.counter);
            if (levelAt(current.match.turn) !== levelAt(current.match.turn - 1)) sound.current.rise();
            current.selected = randomMove(current.match.turn);
            current.exchange = createExchange(current.match.turn % 2 as Side, current.selected, beatAt(current.match.turn));
            current.cpu = current.mode === "cpu" ? cpuGrades(current.selected, current.exchange.attacker === 1) : [];
            current.flash = null;
            sound.current.advance(current.selected, current.exchange.beatSeconds);
            current.seconds = sound.current.seconds;
          }
        }
        render();
      } else if ((!document.hidden || network?.connected) && current.phase === "impact") {
        current.impactElapsed += dt;
        if (current.impactElapsed >= 2.2) {
          current.phase = "finished";
          if (network && !network.matchId) network.soloEnded();
        }
        render();
      }
      if (network) network.publish(current, network.now() - (sound.current && ["countdown", "playing"].includes(current.phase) ? sound.current.seconds : current.seconds) * 1000);
    };
    const key = (event: KeyboardEvent) => {
      if (network && (network.side === null || !network.connected)) return;
      if (event.target instanceof Element && event.target.closest("input, select, textarea, a, [role=dialog]")) return;
      if (event.target instanceof Element && event.target.closest("button") && event.code === "Space" && !["intro", "playing"].includes(engine.current.phase)) return;
      const current = engine.current;
      if (["Space", "KeyF", "KeyJ", "KeyP"].includes(event.code)) event.preventDefault();
      if (event.repeat) return;
      if (event.code === "Space") {
        if (current.phase === "intro") void begin();
        else if (current.mode !== "local") press(network?.side ?? 0, event.code);
      }
      if (event.code === "KeyF") press(network?.side ?? 0, event.code);
      if (event.code === "KeyJ" && current.mode === "local") press(1, event.code);
      if (event.code === "KeyP") void pause();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (["Space", "KeyF"].includes(event.code)) lift(network?.side ?? 0, event.code);
      if (event.code === "KeyJ" && engine.current.mode === "local") lift(1, event.code);
    };
    const autoPause = () => { lift(0); lift(1); if (!network?.connected && engine.current.phase === "playing") void pause(); };
    const visibility = () => { if (document.hidden) autoPause(); };
    window.addEventListener("keydown", key); window.addEventListener("keyup", keyUp); window.addEventListener("blur", autoPause); document.addEventListener("visibilitychange", visibility);
    const animate = (now: number) => { loop(now); frameId = requestAnimationFrame(animate); };
    frameId = requestAnimationFrame(animate);
    const backgroundTick = window.setInterval(() => { if (document.hidden && network?.connected) loop(performance.now()); }, 50);
    return () => { icon.remove(); document.title = originalTitle; alive.current = false; cancelAnimationFrame(frameId); clearInterval(backgroundTick); if (!sharedAudio) { sound.current?.dispose(); sound.current = null; } window.removeEventListener("keydown", key); window.removeEventListener("keyup", keyUp); window.removeEventListener("blur", autoPause); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  const attacker = e.exchange?.attacker ?? e.match.turn % 2 as Side;
  const beat = Math.max(0, e.seconds / (e.exchange?.beatSeconds ?? BEAT));
  const currentActor = e.exchange ? actorAt(e.exchange, e.seconds) : null;
  const warning = e.phase === "playing" ? e.inputWarning : null;
  const move = MOVES[e.selected]!;
  const cue = turnCue(attacker, beat);
  const cueSide = cue.current ?? cue.next;
  const opponentCue = e.mode !== "local" && cueSide !== viewSide;
  const countdown = countdownCue(attacker, beat, e.mode, viewSide);
  const heading = e.phase === "intro" ? "SEND THE BEAT. BREAK THE WAVE."  : e.phase === "paused" ? "PAUSED / 一時停止" : e.phase === "finished" ? e.match.winner === "draw" ? "DRAW / 引き分け" : `${name(e.match.winner!)}の勝ち！` : e.phase === "impact" ? e.outcome!.damage ? "CORE HIT! パルス直撃！" : "攻撃を防いだ！" : beat < 4 ? `${name(attacker)}、次の攻撃！ ${4 - Math.floor(beat)}` : beat < 8 ? `${name(attacker)}の攻撃！` : `${name((1 - attacker) as Side)}、リズムで守れ！`;

  return <main className="dot-wave" data-phase={e.phase}>
    <header><div><span className="duel-eyebrow">NEON RHYTHM BATTLE</span><h1><PixelWord /></h1></div><a href="/">ゲーム一覧へ</a></header>
    <div className="duel-mode-label">{e.mode === "cpu" ? "CPU対戦" : e.mode === "online" ? "通信対戦" : "同じ端末で2人対戦"} · {e.phase === "intro" ? "攻守交代のリズムバトル" : `攻防 ${e.match.turn + (e.phase === "impact" || e.phase === "finished" ? 0 : 1)}${e.match.ending === "limited" ? ` / ${MAX_EXCHANGES}` : ""}`}</div>

    <section className="duel-board" onClick={event => { if (e.phase === "paused" && !replica && !(event.target instanceof Element && event.target.closest("button, a, input, select, [role=dialog]"))) void pause(); }}>
      <h2 className={e.phase === "countdown" || e.phase === "playing" || e.phase === "impact" ? "dot-sr-only" : undefined} aria-live="polite">{heading}</h2>
      <DotScene engine={e} viewSide={viewSide} players={players} />
      <div className="duel-board-notice">{boardNotice}</div>
      {e.phase === "paused" && <div className="duel-paused-challenge">{challengeNotice}</div>}
      {e.phase === "countdown" && <div className="duel-start-countdown" role="status" aria-label={`開始まで${Math.max(1, Math.ceil(-e.seconds))}秒`}><strong key={Math.ceil(-e.seconds)}>{Math.max(1, Math.min(3, Math.ceil(-e.seconds)))}</strong></div>}
      {e.phase === "intro" && <p className="duel-sound-guide"><BattleIcon kind="sound"/><strong>音をきいてあそぶゲームです。音を出してね！</strong></p>}
      {e.phase === "intro" && !replica && !network?.matchId && <div className="duel-intro-panel">
        <div className="dot-cue-guide"><span><BattleIcon kind="tap"/><span>チカチカ → もうすぐ</span></span><span><BattleIcon kind="note"/><span>音符でこうげき</span></span><span><BattleIcon kind="shield"/><span>シールドでまもる</span></span></div>
        <ol><li><strong>攻める4拍：</strong>毎回ランダムに決まるお手本に合わせてタップ。正確なほど強い音符パルスに。</li><li><strong>守る4拍：</strong>相手のリズムをまねして受け止める。外した分だけエネルギーが減る！</li><li><strong>攻守交代：</strong>止まらず次の4拍で準備、続けて攻撃！完全防御で次の攻撃が強くなる。</li></ol>
        <p>手と矢印がチカチカしたら、つぎはきみ！ 光りつづけたら、リズムにあわせておそう。金色の音符は、つぎのこうげきが強くなるしるし。</p>
        <label>決着のつけ方 <select value={e.match.ending} onChange={(event) => { e.match.ending = event.target.value as Ending; render(); }}><option value="limited">FINAL WAVEまで（残りエネルギーで決着）</option><option value="knockout">KNOCKOUTまで</option></select></label>
        {!network && <label>遊び方 <select value={e.mode} onChange={(event) => { e.mode = event.target.value as Engine["mode"]; render(); }}><option value="cpu">CPUと対戦</option><option value="local">同じ端末で2人対戦</option></select></label>}
        <p>白い光とひし形が重なったらタップ！ 金色はぴったり、薄紫はおしい。長い帯は、おしつづけて終点の輪で離そう！</p>
        <p className="duel-input-hint">{e.mode === "cpu" ? "スペース / F / タップでパルス" : "CYAN：F　PINK：J / それぞれのタップボタン"}</p>
        <button className="duel-primary" onClick={() => void begin()} disabled={Boolean(network && !network.connected)}>START / {network ? network.startCost ? "1クレジットで開始" : "続ける" : "対戦開始"}</button>
        <small>{network ? "観戦・通信対戦に対応" : "同じ端末で対戦"} · 自動でリズムが変わる連続バトル</small>
      </div>}
      {e.phase === "playing" && <div key={`${e.match.turn}-${cue.phase}`} className={`duel-rhythm is-neon turn-${cueSide} ${cue.phase === "ready" ? "is-ready" : "is-now"} ${spectator ? "is-spectator" : opponentCue ? "is-opponent" : ""}`} aria-label={`${cue.current === null ? "次" : "今"}は${cueName(cueSide, e.mode, viewSide)}の${cue.role}。技：${move.name}。${move.rhythm}`}>
        {!spectator && <div className={`duel-turn-label player-${countdown?.side ?? cueSide}`} role="img" aria-hidden={cue.phase === "ready" && !countdown ? true : undefined} aria-label={countdown ? `${cueName(countdown.side, e.mode, viewSide)}の${countdown.kind === "shield" ? "防御" : "攻撃"}まで${countdown.count}拍` : cue.role}>
          {countdown ? <><BattleIcon kind={countdown.kind}/><span className="dot-countdown">{countdown.count}</span></> : cue.phase !== "ready" && <BattleIcon kind={cue.role === "防御" ? "shield" : "note"}/>}
        </div>}
        <NeonRail exchange={e.exchange!} seconds={e.seconds} viewSide={viewSide} /></div>}

      {e.phase === "paused" && <div className="duel-choice-panel"><p>音と判定を同じ位置で止めています。</p>{!replica && <p>画面をタップ / Pキーで再開</p>}</div>}
      {e.phase === "impact" && <div className="duel-impact" role="img" aria-label={e.outcome!.damage > 0 ? `${e.outcome!.damage}ダメージ` : "攻撃を防いだ"}><BattleIcon kind={e.outcome!.damage > 0 ? "note" : "shield"}/><strong>{e.outcome!.damage > 0 ? `−${e.outcome!.damage}` : "0"}</strong></div>}
      {e.phase === "finished" && <div className="duel-choice-panel">{challengeNotice}<p>{e.match.hp.includes(0) ? "エネルギーが尽きた。バトル終了！" : "FINAL WAVE完了。残りエネルギーで決着！"}</p><strong>{name(0)} {e.match.hp[0]} : {e.match.hp[1]} {name(1)}</strong><p>与えたダメージ：{MAX_HP - e.match.hp[1]} ／ 受けたダメージ：{MAX_HP - e.match.hp[0]}</p>{resultPanel}{!holdResult && !replica && !network?.matchId && <button className="duel-primary" onClick={() => { sound.current?.stop(); engine.current = fresh(e.mode, e.match.ending); render(); }}>RETRY / もう一度</button>}</div>}
    </section>
    {e.phase !== "paused" && <p className={`duel-feedback ${["playing", "impact", "finished"].includes(e.phase) ? "dot-sr-only" : ""}`} role="status">{replica && viewSide === null ? e.phase === "intro" ? "プレイヤーの開始を待っています。" : "観戦中" : warning ? `${name(warning.side)}：${warning.message} 自分の番までリズムを聞こう。` : e.feedback || "相手の攻撃をよく聞いて、自分の番にリズムを返そう。"}</p>}
    <div className="duel-controls">{e.phase === "playing" && challengePending && <span className="duel-challenge-indicator" role="status">対戦申込あり · 一時停止で確認</span>}<button className="duel-sound-toggle" aria-label={sound.current?.audible ? "音を消す" : "音を出す"} aria-pressed={Boolean(sound.current?.audible)} onClick={() => void toggleSound().catch(() => { notifications.show({ id: "game-audio", scope: "dot-wave", type: "error", message: "音を開始できませんでした。スピーカーをもう一度押してください。" }); render(); })}><BattleIcon kind={sound.current?.audible ? "sound" : "sound-off"}/></button>{([0, 1] as Side[]).filter((side) => e.mode === "local" || side === viewSide).map((side) => <button key={side} aria-label={`${name(side)}のリズムボタン`} className={`duel-tap player-${side} ${e.phase === "playing" && cue.next === side && cue.current !== side ? "is-upcoming" : ""} ${currentActor !== side ? "is-waiting" : ""} ${warning?.side === side ? "is-wrong-turn" : ""}`} disabled={e.phase !== "playing" || Boolean(network && (!network.connected || (network.startsAt && network.now() < network.startsAt)))} onPointerDown={(event) => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); press(side, `pointer-${event.pointerId}`); }} onPointerUp={event => lift(side, `pointer-${event.pointerId}`)} onPointerCancel={event => lift(side, `pointer-${event.pointerId}`)} onLostPointerCapture={event => lift(side, `pointer-${event.pointerId}`)} onClick={(event) => { if (event.detail === 0) { press(side, "accessible"); lift(side, "accessible"); } }}><BattleIcon kind={warning?.side === side ? "wait" : "tap"}/><small>{network || e.mode === "cpu" ? "SPACE / F" : side === 0 ? "F" : "J"}</small></button>)}</div>
  </main>;
}
