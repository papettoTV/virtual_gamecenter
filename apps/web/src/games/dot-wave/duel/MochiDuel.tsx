import { notifications } from "../../../features/notifications/notifications";
import type { DotWaveRoster } from "../../../domain/cabinet";
import { useEffect, useReducer, useRef, useState, type RefObject, type ReactNode } from "react";
import { turnCue, cueName, inputHint, countdownCue } from "./turnCue";
import { DotScene, PixelWord } from "./DotScene";
import { BattleIcon } from "./BattleIcon";
import { NeonRail } from "./NeonRail";
import { musicStages, visibleMusicStage, type MusicStage } from "./musicMood";
import { DuelAudio } from "./audio";
import { DotWaveRanking } from "./DotWaveRanking";
import { actorAt, BEAT, beatAt, levelAt, randomMove, cpuGrades, createExchange, END_BEAT, expire, exchangeLimit, MAX_HP, MOVES, resolve, tap, release, type Exchange, type Grade, type Match, type Resolution, type Side } from "./core";
import { INPUT_GRACE, validRemoteTap, type DuelLink, type DuelFrame } from "./network";
import { CPU_STAGES, advanceCampaign, freshDuel as fresh, nextCpuStage, randomCpuMove, type CpuStage } from "./campaign";
import { freshScore, scoreChart, awardBossBonus, readBest, saveBest, type Score } from "./score";
import "./style.css";

type Phase = "countdown" | "intro" | "playing" | "paused" | "impact" | "finished";
export type Engine = { elapsedPlayMs?: number; comboFlash?: { combo: number; at: number; turn: number }; score?: Score; cpuStage?: CpuStage; phase: Phase; mode: "cpu" | "local" | "online"; match: Match; selected: number; exchange: Exchange | null; seconds: number; outcome: Resolution | null; impactElapsed: number; feedback: string; cpu: Grade[]; flash: { side: Side; grade: Grade; at: number } | null; inputWarning: { side: Side; at: number; message: string } | null };


export default function MochiDuel({ players, network, sharedAudio, boardNotice, resultPanel, challengeNotice, challengePending = false, holdResult = false }: { players?: DotWaveRoster; network?: DuelLink; sharedAudio?: RefObject<DuelAudio | null>; boardNotice?: ReactNode; resultPanel?: ReactNode; challengeNotice?: ReactNode; holdResult?: boolean; challengePending?: boolean } = {}) {
  const engine = useRef(fresh(network?.matchId ? "online" : "cpu"));
  const ownSound = useRef<DuelAudio | null>(null);
  const sound = sharedAudio ?? ownSound;
  const lastFrame = useRef<DuelFrame | null>(null);
  const lastSoundFlash = useRef("");
  const remoteSeq = useRef(-1);
  const remoteAudioTurn = useRef("");
  const remoteTurnOrigin = useRef(0);
  const lastRemotePhase = useRef<Phase>("intro");
  const predicted = useRef<{ turn: number; flash: Engine["flash"]; warning: Engine["inputWarning"] } | null>(null);
  const replica = Boolean(network && network.role !== "player");
  const viewSide = network ? network.side : 0;
  const spectator = Boolean(network && viewSide === null);
  const heldInputs = useRef<[Set<string>, Set<string>]>([new Set(), new Set()]);
  const musicOverride = useRef<MusicStage | null>(null);
  const musicLevels = (history: Match["history"]): [MusicStage, MusicStage] => musicOverride.current === null ? musicStages(history) : [musicOverride.current, musicOverride.current];
  const busy = useRef(false);
  const alive = useRef(true);
  const [, render] = useReducer((value: number) => value + 1, 0);
  const e = engine.current;
  const [best, setBest] = useState(() => readBest(e.match.ending));
  useEffect(() => {
    if (e.mode !== "cpu" || replica || holdResult) return;
    setBest(e.phase === "finished" && e.score ? saveBest(e.match.ending, e.score.total) : readBest(e.match.ending));
  }, [e.phase, e.cpuStage, e.match.ending, replica, holdResult]);
  function collectScore(current: Engine, seconds = current.seconds) {
    if (current.mode !== "cpu" || !current.exchange || replica) return;
    const score = current.score ??= freshScore();
    const before = score.total;
    scoreChart(score, current.exchange.attacker === 0 ? current.exchange.attack : current.exchange.defense);
    if (score.combo === 0) current.comboFlash = undefined;
    else if (score.total > before) current.comboFlash = { combo: score.combo, at: seconds, turn: current.match.turn };
  }
  const roster = useRef(players); roster.current = players;
  const name = (side: Side) => engine.current.mode === "cpu" && side === 1 ? CPU_STAGES[engine.current.cpuStage ?? 1].name : roster.current?.[side]?.name ?? (network ? `${side === network.side ? "あなた" : engine.current.mode === "cpu" && side === 1 ? "CPU" : "相手"} / ${side === 0 ? "CYAN" : "PINK"}` : side === 0 ? (engine.current.mode === "local" ? "1P / CYAN" : "あなた") : engine.current.mode === "cpu" ? "CPU / PINK" : "2P / PINK");

  useEffect(() => { if (holdResult) { engine.current.phase = "finished"; engine.current.match.winner ??= network?.side ?? 0; render(); } }, [holdResult]);

  async function toggleSound() {
    sound.current ??= new DuelAudio();
    if (sound.current.audible) sound.current.setMuted(true);
    else {
      sound.current.setMuted(false);
      if (engine.current.phase !== "paused") await sound.current.resume(); notifications.dismiss("game-audio");
      remoteAudioTurn.current = "";
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
      if (network && !network.matchId && (current.cpuStage ?? 1) === 1 && !await network.beforeSolo()) return;
      if (!alive.current) return;
      current.match.ending = "limited";
      sound.current.volume(.65);
      sound.current.setMusicStages(musicLevels(current.match.history));
      current.selected = current.mode === "cpu" ? randomCpuMove(current.cpuStage ?? 1) : randomMove(current.match.turn);
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
    collectScore(current, seconds);
    if (!grade) return;
    sound.current.hit(grade, side !== current.exchange.attacker);
    if (side !== current.exchange.attacker) sound.current.syncDefenseHold(current.exchange, seconds);
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
    if (current.exchange && side !== current.exchange.attacker) sound.current?.stopDefenseHold();
    if (!current.exchange || !sound.current || !["playing", "paused"].includes(current.phase)) return;
    const seconds = replica && network ? (network.now() - remoteTurnOrigin.current) / 1000 : sound.current.seconds;
    if (replica) network?.strike(current.match.turn, seconds, "up");
    const grade = release(current.exchange, side, seconds);
    collectScore(current, seconds);
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
          sound.current?.setMusicStages(musicLevels(frame.engine.match.history));
          const flash = frame.engine.flash;
          const flashKey = `${frame.engine.cpuStage ?? 1}:${frame.engine.match.turn}:${flash?.side}:${flash?.at}`;
          if (flash && frame.engine.phase === "playing" && flashKey !== lastSoundFlash.current) {
            lastSoundFlash.current = flashKey;
            const local = predicted.current;
            if (!(local?.turn === frame.engine.match.turn && local.flash?.side === flash.side && Math.abs(local.flash.at - flash.at) < .4)) sound.current?.hit(flash.grade, flash.side !== frame.engine.exchange?.attacker);
          }
          if (["countdown", "playing"].includes(frame.engine.phase) && sound.current && remoteAudioTurn.current !== `${frame.engine.cpuStage ?? 1}:${frame.engine.match.turn}`) {
            remoteAudioTurn.current = `${frame.engine.cpuStage ?? 1}:${frame.engine.match.turn}`;
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
          sound.current?.schedule(remote.match.ending === "knockout" || remote.match.turn < exchangeLimit(remote.match) - 1);
          const prediction = predicted.current;
          if (prediction?.turn === remote.match.turn) {
            if (prediction.flash && remote.seconds - prediction.flash.at < .45) remote.flash = prediction.flash;
            if (prediction.warning && remote.seconds - prediction.warning.at < .75 && actorAt(remote.exchange, remote.seconds) !== network.side) remote.inputWarning = prediction.warning;
          }
          if (remote.inputWarning && (remote.seconds - remote.inputWarning.at >= .75 || actorAt(remote.exchange, remote.seconds) === remote.inputWarning.side)) remote.inputWarning = null;
          // Local presses/releases play immediately; snapshots drive other players and spectators.
          if (network.side !== 1 - remote.exchange.attacker) sound.current?.syncDefenseHold(remote.exchange, remote.seconds, remote.phase === "playing" && network.connected);
        }
        if (!network.connected || !["countdown", "playing"].includes(remote.phase)) sound.current?.stopDefenseHold();
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
        sound.current.schedule(current.match.ending === "knockout" || current.match.turn < exchangeLimit(current.match) - 1);
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
        collectScore(current);
        sound.current.syncDefenseHold(exchange, current.seconds);
        if (sound.current.seconds >= END_BEAT * exchange.beatSeconds + (network?.matchId ? INPUT_GRACE : 0)) {
          current.inputWarning = null;
          current.outcome = resolve(current.match, exchange);
          current.elapsedPlayMs = (current.elapsedPlayMs ?? 0) + END_BEAT * exchange.beatSeconds * 1000;
          collectScore(current);
          if (current.mode === "cpu" && current.match.winner === 0) awardBossBonus(current.score ??= freshScore(), current.match.hp[0]);
          current.feedback = current.outcome.damage > 0 ? `${name((1 - current.outcome.attacker) as Side)}に ${current.outcome.damage} ダメージ！` : current.outcome.counter ? "FULL SYNC! 反撃チャージ！" : "ダメージなし！";
          if (current.match.winner !== null) {
            current.phase = "impact"; current.impactElapsed = 0;
            if (network?.matchId) network.finish(current.match);
            sound.current.stop();
            sound.current.finish(current.match.winner === "draw" ? "draw" : current.mode === "local" || current.match.winner === 0 ? "win" : "lose");
          } else {
            sound.current.resolve(current.outcome.damage, current.outcome.counter);
            if (levelAt(current.match.turn) !== levelAt(current.match.turn - 1)) sound.current.rise();
            current.selected = current.mode === "cpu" ? randomCpuMove(current.cpuStage ?? 1) : randomMove(current.match.turn);
            current.exchange = createExchange(current.match.turn % 2 as Side, current.selected, beatAt(current.match.turn));
            current.cpu = current.mode === "cpu" ? cpuGrades(current.selected, current.exchange.attacker === 1) : [];
            current.flash = null;
            sound.current.setMusicStages(musicLevels(current.match.history));
            sound.current.advance(current.selected, current.exchange.beatSeconds);
            current.seconds = sound.current.seconds;
          }
        }
        render();
      } else if ((!document.hidden || network?.connected) && current.phase === "impact") {
        current.impactElapsed += dt;
        if (current.impactElapsed >= 2.2) {
          current.phase = "finished";
          if (network && !network.matchId && (current.mode !== "cpu" || !nextCpuStage(current.cpuStage ?? 1, current.match))) network.soloEnded();
        }
        render();
      }
      if (network) network.publish(current, network.now() - (sound.current && ["countdown", "playing"].includes(current.phase) ? sound.current.seconds : current.seconds) * 1000);
    };
    const key = (event: KeyboardEvent) => {
      if (network && (network.side === null || !network.connected)) return;
      if (event.target instanceof Element && event.target.closest("input, select, textarea, a, [role=dialog], [data-debug-controls]")) return;
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
    return () => { icon.remove(); document.title = originalTitle; alive.current = false; cancelAnimationFrame(frameId); clearInterval(backgroundTick); sound.current?.stopDefenseHold(); if (!sharedAudio) { sound.current?.dispose(); sound.current = null; } window.removeEventListener("keydown", key); window.removeEventListener("keyup", keyUp); window.removeEventListener("blur", autoPause); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  function nextStage() {
    if (replica || network?.matchId || busy.current || (network && !network.connected)) return;
    const next = advanceCampaign(engine.current);
    if (!next) return;
    sound.current?.stop();
    heldInputs.current.forEach(held => held.clear());
    engine.current = next;
    void begin();
    render();
  }
  const stage = e.cpuStage ?? 1;
  const stageInfo = CPU_STAGES[stage];
  const next = e.mode === "cpu" ? nextCpuStage(stage, e.match) : null;
  const cleared = e.mode === "cpu" && e.match.winner === 0;
  const attacker = e.exchange?.attacker ?? e.match.turn % 2 as Side;
  const beat = Math.max(0, e.seconds / (e.exchange?.beatSeconds ?? BEAT));
  const currentActor = e.exchange ? actorAt(e.exchange, e.seconds) : null;
  const warning = e.phase === "playing" ? e.inputWarning : null;
  const move = MOVES[e.selected]!;
  const cue = turnCue(attacker, beat);
  const cueSide = cue.current ?? cue.next;
  const opponentCue = e.mode !== "local" && cueSide !== viewSide;
  const countdown = countdownCue(attacker, beat, e.mode, viewSide);
  const comboFlash = e.mode === "cpu" && e.comboFlash?.turn === e.match.turn ? e.comboFlash : undefined;
  const comboAge = comboFlash ? e.seconds - comboFlash.at : Infinity;
  const heading = e.phase === "intro" ? ""  : e.phase === "paused" ? "PAUSED / 一時停止" : e.phase === "finished" && cleared ? next ? `${stageInfo.label} CLEAR!` : "ALL STAGES CLEAR!" : e.phase === "finished" ? e.match.winner === "draw" ? "DRAW / 引き分け" : `${name(e.match.winner!)}の勝ち！` : e.phase === "impact" ? e.outcome!.damage ? "CORE HIT! パルス直撃！" : "攻撃を防いだ！" : beat < 4 ? `${name(attacker)}、次の攻撃！ ${4 - Math.floor(beat)}` : beat < 8 ? `${name(attacker)}の攻撃！` : `${name((1 - attacker) as Side)}、リズムで守れ！`;

  return <main className="dot-wave" data-phase={e.phase}>
    <header><div><span className="duel-eyebrow">NEON RHYTHM BATTLE</span><h1><PixelWord /></h1></div><a href="/">ゲーム一覧へ</a></header>
    <div className="duel-mode-label">
      <span className="duel-mode-info">{e.mode === "cpu" ? `CPU対戦 · ${stageInfo.label} / 3` : e.mode === "online" ? "通信対戦" : "同じ端末で2人対戦"} · {e.phase === "intro" ? "攻守交代のリズムバトル" : `攻防 ${e.match.turn + (e.phase === "impact" || e.phase === "finished" ? 0 : 1)} / ${exchangeLimit(e.match)}`}</span>
      {e.mode === "cpu" && <span className="duel-inline-score" aria-label="通算スコア">SCORE {(e.score?.total ?? 0).toLocaleString()}</span>}
    </div>

    <section className="duel-board" onClick={event => { if (e.phase === "paused" && !replica && !(event.target instanceof Element && event.target.closest("button, a, input, select, [role=dialog]"))) void pause(); }}>
      {e.phase !== "intro" && <h2 className={busy.current || e.phase === "countdown" || e.phase === "playing" || e.phase === "impact" ? "dot-sr-only" : undefined} aria-live="polite">{heading}</h2>}
      <DotScene engine={e} viewSide={viewSide} players={players} musicOverride={musicOverride.current} />
      <div className="duel-board-notice">{boardNotice}</div>
      {e.phase === "countdown" && <div className="duel-start-countdown" role="status" aria-label={`開始まで${Math.max(1, Math.ceil(-e.seconds))}秒`}><strong key={Math.ceil(-e.seconds)}>{Math.max(1, Math.min(3, Math.ceil(-e.seconds)))}</strong></div>}
      {e.phase === "intro" && !busy.current && <div className="duel-state-overlay duel-start-panel">
      {!replica && !network?.matchId && <div className="duel-intro-panel">
        <div className="duel-start-actions">
        <p className="duel-input-hint">{e.mode === "cpu" ? "スペース / F / タップでパルス" : "CYAN：F　PINK：J / それぞれのタップボタン"}</p>
        <button className="duel-primary" onClick={() => void begin()} disabled={Boolean(network && !network.connected)}>START / {e.mode === "cpu" && stage > 1 ? `${stageInfo.label} 開始` : network ? network.startCost ? "1クレジットで開始" : "続ける" : "対戦開始"}</button>
        </div>
        {e.mode === "cpu" && <div className="dot-stage-intro"><strong>{stageInfo.label} · {stageInfo.name}</strong><span>{stageInfo.title}</span></div>}
        <div className="dot-cue-guide"><span><BattleIcon kind="tap"/><span>チカチカ → もうすぐ</span></span><span><BattleIcon kind="note"/><span>音符でこうげき</span></span><span><BattleIcon kind="shield"/><span>シールドでまもる</span></span></div>
        <ol><li><strong>攻める4拍：</strong>毎回ランダムに決まるお手本に合わせてタップ。正確なほど強い音符パルスに。</li><li><strong>守る4拍：</strong>相手のリズムをまねして受け止める。外した分だけエネルギーが減る！</li><li><strong>攻守交代：</strong>止まらず次の4拍で準備、続けて攻撃！完全防御で次の攻撃が強くなる。</li></ol>
        {!network && <label>遊び方 <select value={e.mode} onChange={(event) => { engine.current = fresh(event.target.value as Engine["mode"], e.match.ending); render(); }}><option value="cpu">CPUと対戦</option><option value="local">同じ端末で2人対戦</option></select></label>}
        {(e.mode !== "cpu" || stage > 1) && <p>長い帯は、おしつづけて終点の輪で離そう！</p>}

        <small>{network ? "観戦・通信対戦に対応" : "同じ端末で対戦"} · 自動でリズムが変わる連続バトル</small>
      </div>}
      </div>}
      <div aria-hidden={e.phase !== "playing" ? true : undefined} inert={e.phase !== "playing"} key={`${e.match.turn}-${cue.phase}`} className={`duel-rhythm is-neon ${e.phase !== "playing" ? "is-inactive" : ""} turn-${cueSide} ${cue.phase === "ready" ? "is-ready" : "is-now"} ${spectator ? "is-spectator" : opponentCue ? "is-opponent" : ""}`} aria-label={`${cue.current === null ? "次" : "今"}は${cueName(cueSide, e.mode, viewSide)}の${cue.role}。技：${move.name}。${move.rhythm}`}>
        <div className={`duel-turn-label player-${countdown?.side ?? cueSide}`} role="img" aria-hidden={spectator || (cue.phase === "ready" && !countdown) ? true : undefined} aria-label={countdown ? `${cueName(countdown.side, e.mode, viewSide)}の${countdown.kind === "shield" ? "防御" : "攻撃"}まで${countdown.count}拍` : cue.role}>
          {!spectator && (countdown ? <><BattleIcon kind={countdown.kind}/><span className="dot-countdown">{countdown.count}</span></> : cue.phase !== "ready" && <BattleIcon kind={cue.role === "防御" ? "shield" : "note"}/>)}
          {!spectator && comboFlash && comboAge >= 0 && comboAge < .35 && <span
            className={`neon-rail-combo${comboFlash.combo >= 30 ? " is-max" : ""}`}
            style={{ transform: `translateY(${8 * (1 - comboAge / .35)}px)`, opacity: Math.min(1, (.35 - comboAge) / .15) }}
          >{comboFlash.combo} COMBO</span>}
        </div>
        <NeonRail exchange={e.exchange ?? createExchange(0, e.selected)} seconds={e.seconds} viewSide={viewSide} /></div>

      {e.phase === "paused" && <div className="duel-choice-panel duel-state-overlay"><div className="duel-paused-challenge">{challengeNotice}</div><p>音と判定を同じ位置で止めています。</p>{!replica && <p>画面をタップ / Pキーで再開</p>}</div>}
      {e.phase === "finished" && <div className={`duel-choice-panel duel-state-overlay${next ? " is-stage-clear" : ""}`}>
        <div className="duel-result-challenge">{challengeNotice}</div>
        {!next && <>
          {!cleared && <><p>{e.match.hp.includes(0) ? "エネルギーが尽きた。バトル終了！" : "FINAL WAVE完了。残りエネルギーで決着！"}</p>
          <strong>{name(0)} {e.match.hp[0]} : {e.match.hp[1]} {name(1)}</strong>
          <p>与えたダメージ：{MAX_HP - e.match.hp[1]} ／ 受けたダメージ：{MAX_HP - e.match.hp[0]}</p></>}
          {e.mode === "cpu" && <div className="dot-score-result">
            <span>最大コンボ <strong>{e.score?.maxCombo ?? 0}</strong></span>
            <span>体力ボーナス累計 <strong>+{(e.score?.bossBonus ?? 0).toLocaleString()}</strong></span>
            {!spectator && <span>自己ベスト（このブラウザ） <strong>{Math.max(best, e.score?.total ?? 0).toLocaleString()}</strong></span>}
          </div>}
        </>}
        {cleared && !next && !replica && !holdResult && e.score && <DotWaveRanking score={e.score} elapsedTimeMs={e.elapsedPlayMs ?? 1} playerName={name(0)} />}
        {resultPanel}
        {!holdResult && !replica && !network?.matchId && (next
          ? <button className="duel-primary" disabled={Boolean(network && !network.connected)} onClick={nextStage}>NEXT / {CPU_STAGES[next].label}へ</button>
          : <button className="duel-primary" onClick={() => { sound.current?.stop(); heldInputs.current.forEach(held => held.clear()); engine.current = fresh(e.mode, e.match.ending); render(); }}>{e.mode === "cpu" ? "RETRY / 1st STAGEから" : "RETRY / もう一度"}</button>)}
      </div>}

    </section>
    {e.phase !== "paused" && <p className="duel-feedback dot-sr-only" role="status">{replica && viewSide === null ? e.phase === "intro" ? "プレイヤーの開始を待っています。" : "観戦中" : warning ? `${name(warning.side)}：${warning.message} 自分の番までリズムを聞こう。` : e.feedback || "相手の攻撃をよく聞いて、自分の番にリズムを返そう。"}</p>}
    <div className="duel-controls">{e.phase === "playing" && challengePending && <span className="duel-challenge-indicator" role="status">対戦申込あり · 一時停止で確認</span>}<button className="duel-sound-toggle" aria-label={sound.current?.audible ? "音を消す" : "音を出す"} aria-pressed={Boolean(sound.current?.audible)} onClick={() => void toggleSound().catch(() => { notifications.show({ id: "game-audio", scope: "dot-wave", type: "error", message: "音を開始できませんでした。スピーカーをもう一度押してください。" }); render(); })}><BattleIcon kind={sound.current?.audible ? "sound" : "sound-off"}/></button>{([0, 1] as Side[]).filter((side) => e.mode === "local" || side === viewSide).map((side) => <button key={side} aria-label={`${name(side)}のリズムボタン`} className={`duel-tap player-${side} ${e.phase === "playing" && cue.next === side && cue.current !== side ? "is-upcoming" : ""} ${currentActor !== side ? "is-waiting" : ""} ${warning?.side === side ? "is-wrong-turn" : ""}`} disabled={e.phase !== "playing" || Boolean(network && (!network.connected || (network.startsAt && network.now() < network.startsAt)))} onPointerDown={(event) => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); press(side, `pointer-${event.pointerId}`); }} onPointerUp={event => lift(side, `pointer-${event.pointerId}`)} onPointerCancel={event => lift(side, `pointer-${event.pointerId}`)} onLostPointerCapture={event => lift(side, `pointer-${event.pointerId}`)} onClick={(event) => { if (event.detail === 0) { press(side, "accessible"); lift(side, "accessible"); } }}><BattleIcon kind={warning?.side === side ? "wait" : "tap"}/><small>{network || e.mode === "cpu" ? "SPACE / F" : side === 0 ? "F" : "J"}</small></button>)}</div>
    {import.meta.env.DEV && <div className="dot-music-debug" data-debug-controls>
      <label>盛り上がりテスト：{musicOverride.current === null ? "自動" : "手動"} · {["通常", "ベース追加", "伴奏追加"][musicOverride.current ?? visibleMusicStage(e.match.history, beat)]}
        <input type="range" min="0" max="2" step="1" aria-label="盛り上がりモード" aria-valuetext={["通常", "ベース追加", "伴奏追加"][musicOverride.current ?? visibleMusicStage(e.match.history, beat)]} value={musicOverride.current ?? visibleMusicStage(e.match.history, beat)} onChange={event => {
          musicOverride.current = Number(event.target.value) as MusicStage;
          sound.current?.setMusicStages(musicLevels(engine.current.match.history)); render();
        }}/>
        <span className="dot-music-debug-ticks"><span>通常</span><span>ベース</span><span>伴奏</span></span>
      </label>
      <button disabled={musicOverride.current === null} onClick={() => { musicOverride.current = null; sound.current?.setMusicStages(musicLevels(engine.current.match.history)); render(); }}>自動に戻す</button>
      <small>この画面だけに適用 · 音はプレイ中に確認できます</small>
    </div>}
  </main>;
}
