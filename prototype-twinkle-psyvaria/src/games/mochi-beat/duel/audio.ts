import { BEAT, END_BEAT, MOVES, type Grade } from "./core";

export class DuelAudio {
  private context = new AudioContext({ latencyHint: "interactive" });
  private gain = this.context.createGain();
  private muted = false;
  private outputVolume = .35;
  private origin = 0;
  private step = 0;
  private move = 0;
  private beatSeconds = BEAT;
  private voices = new Set<OscillatorNode>();
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
    this.move = move; this.beatSeconds = beatSeconds; this.step = Math.max(0, Math.ceil(elapsed / beatSeconds * 2)); this.origin = this.context.currentTime + delay - elapsed;
    this.schedule();
  }
  advance(move: number, beatSeconds = this.beatSeconds) {
    // Keep the audio clock and already scheduled beat at the boundary intact.
    this.origin += END_BEAT * this.beatSeconds;
    this.beatSeconds = beatSeconds;
    this.step -= END_BEAT * 2;
    this.move = move;
    this.schedule();
  }
  async pause() { await this.context.suspend(); }
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
  stop() { for (const voice of this.voices) voice.stop(); this.voices.clear(); }
  dispose() { this.stop(); void this.context.close(); }
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
    while (this.step / 2 < END_BEAT + (continueBeat ? .5 : 0) && this.step / 2 * this.beatSeconds < this.seconds + .12) {
      const beat = this.step++ / 2; const time = this.origin + beat * this.beatSeconds;
      if (time < this.context.currentTime - .025) continue;
      const at = Math.max(time, this.context.currentTime);
      if (Number.isInteger(beat)) {
        this.tone(at, beat % 4 === 0 ? 1046.5 : 783.99, .025, .055);
        this.tone(at, [130.81, 164.81, 196, 164.81][beat % 4]!, .12, .20, 65.4, "triangle");
      }
      // A stable guide plays even when the attacker makes a mistake.
      if (beat >= 4 && beat < 8 && (MOVES[this.move]!.beats as readonly number[]).includes(beat - 4)) this.tone(at, 523.25, MOVES[this.move]!.holds?.[beat - 4] ? MOVES[this.move]!.holds![beat - 4]! * this.beatSeconds : .085, .20, 392);
      if (beat === 7.5) this.tone(at, 1568, .06, .07);
    }
  }
}
