import { BEAT, END_BEAT, MOVES, releaseWindow, type Exchange, type Grade } from "./core";

import type { MusicStage } from "./musicMood";

export class DuelAudio {
  private context = new AudioContext({ latencyHint: "interactive" });
  private gain = this.context.createGain();
  private muted = false;
  private outputVolume = .35;
  private origin = 0;
  private step = 0;
  private move = 0;
  private beatSeconds = BEAT;
  private musicStages: [MusicStage, MusicStage] = [0, 0];
  setMusicStages(stages: [MusicStage, MusicStage]) { this.musicStages = stages; }
  private voices = new Set<OscillatorNode>();
  private defenseHold: { key: number; oscillator: OscillatorNode; gain: GainNode } | null = null;
  constructor() { this.gain.gain.value = .35; this.gain.connect(this.context.destination); }
  get seconds() { return this.context.currentTime - this.origin; }
  get audible() { return this.context.state === "running" && !this.muted; }
  setMuted(muted: boolean) { this.muted = muted; this.gain.gain.value = muted ? 0 : this.outputVolume; }
  volume(value: number) { this.outputVolume = value * .5; this.gain.gain.value = this.muted ? 0 : this.outputVolume; }
  async start(move: number, beatSeconds = BEAT, delay = .2, elapsed = 0) {
    await this.resume();
    this.setStart(move, beatSeconds, delay, elapsed);
  }
  async startAt(move: number, beatSeconds: number, startsAt: number, now: () => number) {
    await this.resume();
    const seconds = (now() - startsAt) / 1000;
    this.setStart(move, beatSeconds, Math.max(0, -seconds), Math.max(0, seconds));
  }
  private setStart(move: number, beatSeconds: number, delay: number, elapsed: number) {
    this.stop();
    this.move = move; this.beatSeconds = beatSeconds; this.step = Math.max(0, Math.ceil(elapsed / beatSeconds * 4)); this.origin = this.context.currentTime + delay - elapsed;
    this.schedule();
  }
  advance(move: number, beatSeconds = this.beatSeconds) {
    this.stopDefenseHold();
    // Keep the audio clock and already scheduled beat at the boundary intact.
    this.origin += END_BEAT * this.beatSeconds;
    this.beatSeconds = beatSeconds;
    this.step -= END_BEAT * 4;
    this.move = move;
    this.schedule();
  }
  async pause() { this.stopDefenseHold(); await this.context.suspend(); }
  async resume() {
    const resumed = this.context.resume();
    // Start a silent source inside the tap gesture as well as resuming the context.
    if (this.context.state !== "running") {
      const source = this.context.createBufferSource();
      source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      source.connect(this.gain); source.onended = () => source.disconnect(); source.start();
    }
    await resumed;
  }
  stop() { this.stopDefenseHold(); for (const voice of this.voices) voice.stop(); this.voices.clear(); }
  dispose() { this.stop(); void this.context.close(); }
  stopDefenseHold() {
    const hold = this.defenseHold;
    if (!hold) return;
    this.defenseHold = null;
    const at = this.context.currentTime;
    hold.gain.gain.cancelAndHoldAtTime(at);
    hold.gain.gain.linearRampToValueAtTime(0, at + .015);
    hold.oscillator.stop(at + .02);
    this.voices.delete(hold.oscillator);
  }
  syncDefenseHold(exchange: Exchange, seconds: number, enabled = true) {
    const note = enabled && !exchange.resolved ? exchange.defense.notes.find(note =>
      note.grade === null && note.holdGrade && note.endBeat !== undefined
      && seconds < note.endBeat * exchange.beatSeconds + releaseWindow(exchange.beatSeconds)) : undefined;
    if (!note || note.endBeat === undefined) { this.stopDefenseHold(); return; }
    if (this.defenseHold?.key === note.beat) return;
    this.stopDefenseHold();
    const at = this.context.currentTime;
    const duration = (note.endBeat - note.beat) * exchange.beatSeconds;
    const remaining = Math.max(0, note.endBeat * exchange.beatSeconds - seconds);
    const progress = Math.min(1, Math.max(0, 1 - remaining / duration));
    const oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(523.25 * Math.pow(783.99 / 523.25, progress), at);
    oscillator.frequency.exponentialRampToValueAtTime(783.99, at + Math.max(.005, remaining));
    // Match the attack guide's .20 peak, 5 ms onset and exponential decay.
    // A late snapshot resumes the envelope as well as the pitch.
    const elapsed = progress * duration;
    const onset = Math.max(0, .005 - elapsed);
    const volume = elapsed < .005 ? .20 * elapsed / .005
      : .20 * Math.pow(.001 / .20, (elapsed - .005) / (duration - .005));
    gain.gain.setValueAtTime(volume, at);
    if (onset > 0) gain.gain.linearRampToValueAtTime(.20, at + onset);
    gain.gain.exponentialRampToValueAtTime(.001, at + Math.max(.005, remaining));
    // Keep only the quiet tail through the release window, with a deadline even if updates stop.
    const end = at + Math.max(.02, note.endBeat * exchange.beatSeconds + releaseWindow(exchange.beatSeconds) - seconds);
    gain.gain.setValueAtTime(.001, end);
    gain.gain.linearRampToValueAtTime(0, end + .015);
    oscillator.connect(gain); gain.connect(this.gain); this.voices.add(oscillator);
    this.defenseHold = { key: note.beat, oscillator, gain };
    oscillator.onended = () => {
      oscillator.disconnect(); gain.disconnect(); this.voices.delete(oscillator);
      if (this.defenseHold?.oscillator === oscillator) this.defenseHold = null;
    };
    oscillator.start(at); oscillator.stop(end + .02);
  }
  private tone(time: number, hz: number, duration: number, volume: number, end = hz, wave: OscillatorType = "square") {
    const oscillator = this.context.createOscillator(); const gain = this.context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(hz, time); oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(volume, time + .005); gain.gain.exponentialRampToValueAtTime(.001, time + duration);
    oscillator.connect(gain); gain.connect(this.gain); this.voices.add(oscillator);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.voices.delete(oscillator); };
    oscillator.start(time); oscillator.stop(time + duration + .02);
  }
  hit(grade: Grade, defending = false) {
    const at = this.context.currentTime;
    if (grade === "miss") { this.tone(at, 110, .07, .13, 55, "triangle"); return; }
    this.tone(at, defending ? 880 : 440, .07, .12, defending ? 1320 : 660);
    if (grade === "perfect") this.tone(at + .035, defending ? 1760 : 880, .06, .07, defending ? 1760 : 1174);
  }
  waitTurn() {
    const at = this.context.currentTime;
    this.tone(at, 220, .035, .06, 220);
    this.tone(at + .055, 165, .045, .06, 165);
  }
  resolve(damage: number, counter: boolean) {
    if (damage > 0) this.tone(this.context.currentTime, 180, .16, .14, 48, "triangle");
    else if (counter) this.arpeggio([660, 880, 1320], .055);
  }
  rise() { this.arpeggio([523.25, 659.25, 783.99, 1046.5], .05); }
  finish(result: "win" | "lose" | "draw") {
    this.arpeggio(result === "win" ? [523.25,659.25,783.99,1046.5] : result === "lose" ? [392,329.63,261.63,130.81] : [523.25,659.25,523.25], .13);
  }
  private arpeggio(notes: number[], spacing: number) {
    notes.forEach((hz, i) => this.tone(this.context.currentTime + i * spacing, hz, spacing * 1.3, .10));
  }
  schedule(continueBeat = true) {
    while (this.step / 4 < END_BEAT + (continueBeat ? .25 : 0) && this.step / 4 * this.beatSeconds < this.seconds + .12) {
      const beat = this.step++ / 4; const time = this.origin + beat * this.beatSeconds;
      if (time < this.context.currentTime - .025) continue;
      const at = Math.max(time, this.context.currentTime);
      if (Number.isInteger(beat)) {
        this.tone(at, beat % 4 === 0 ? 1046.5 : 783.99, .025, .055);
        this.tone(at, 110, .12, .20, 55, "triangle");
      }
      if (beat < END_BEAT && Number.isInteger(beat * 2)) this.backing(at, beat);
      // A stable guide plays even when the attacker makes a mistake.
      if (beat >= 4 && beat < 8 && (MOVES[this.move]!.beats as readonly number[]).includes(beat - 4)) {
        const hold = MOVES[this.move]!.holds?.[beat - 4];
        this.tone(at, 523.25, hold ? hold * this.beatSeconds : .085, .20, hold ? 783.99 : 392);
      }
      if (beat === 7.5) this.tone(at, 1568, .06, .07);
    }
  }
  private backing(at: number, beat: number) {
    const stage = this.musicStages[beat < 4 ? 0 : 1];
    // Leave room for the guide, but keep the added layers audible during play.
    const level = beat >= 4 ? .65 : 1;
    if (stage >= 1 && Number.isInteger(beat)) {
      const bass = [130.81, 164.81, 196, 164.81][beat % 4]!;
      this.tone(at, bass, this.beatSeconds * .85, .15 * level, bass, "triangle");
      // The octave adds bite that also carries on small phone speakers.
      this.tone(at, bass * 2, this.beatSeconds * .4, .035 * level, bass * 2);
    }
    if (stage < 2) return;
    if (beat % 2 === 0) {
      for (const hz of [261.63, 329.63, 392]) {
        this.tone(at, hz, this.beatSeconds * 1.2, .045 * level, hz, "triangle");
      }
    }
    // Short, bright eighth notes contrast with the lower, sliding guide note.
    const melody = [1046.5, 1318.51, 1567.98, 1318.51, 1174.66, 1567.98, 1318.51, 1567.98];
    const hz = melody[(beat * 2) % melody.length]!;
    this.tone(at, hz, this.beatSeconds * .22, .05 * level, hz);
    if (beat % 2 === 1) this.tone(at, 220, .075, .07 * level, 70, "triangle");
    if (!Number.isInteger(beat)) this.tone(at, 6000, .022, .025 * level, 2400, "triangle");
  }
}
