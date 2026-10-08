import { BEAT_SECONDS, COUNT_IN, PATTERNS, TOTAL_BEATS } from "./core";

// The sound scheduler and judgments share the AudioContext clock, independent of frame rate.
export class MochiAudio {
  readonly context = new AudioContext();
  private master = this.context.createGain();
  private nextStep = 0;
  private origin = 0;
  private beatSeconds = BEAT_SECONDS;
  private voices = new Set<OscillatorNode>();

  constructor(volume: number) {
    this.master.connect(this.context.destination);
    this.setVolume(volume);
  }

  setVolume(volume: number) { this.master.gain.value = Math.max(0, Math.min(1, volume)) * 0.55; }
  get seconds() { return this.context.currentTime - this.origin; }

  async start(beatSeconds = BEAT_SECONDS) {
    this.beatSeconds = beatSeconds;
    this.stop();
    await this.context.resume();
    this.origin = this.context.currentTime + 0.18;
    this.nextStep = 0;
    this.schedule();
  }

  async pause() { await this.context.suspend(); }
  async resume() { await this.context.resume(); }

  stop() {
    for (const voice of this.voices) { voice.stop(); voice.disconnect(); }
    this.voices.clear();
  }

  private tone(time: number, frequency: number, duration: number, volume: number, type: OscillatorType = "sine", endFrequency = frequency) {
    const voice = this.context.createOscillator();
    const envelope = this.context.createGain();
    voice.type = type;
    voice.frequency.setValueAtTime(frequency, time);
    voice.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(volume, time + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + duration);
    voice.connect(envelope); envelope.connect(this.master);
    this.voices.add(voice);
    voice.onended = () => { this.voices.delete(voice); voice.disconnect(); envelope.disconnect(); };
    voice.start(time); voice.stop(time + duration + 0.02);
  }

  thump(success = true) {
    const now = this.context.currentTime;
    this.tone(now, success ? 480 : 150, 0.13, 0.5, "sine", success ? 180 : 70);
    if (success) this.tone(now, 960, 0.07, 0.13, "triangle");
  }

  schedule() {
    while (this.nextStep / 2 < TOTAL_BEATS && this.nextStep / 2 * this.beatSeconds < this.seconds + 0.12) {
      const beat = this.nextStep / 2;
      const time = this.origin + beat * this.beatSeconds;
      this.nextStep += 1;
      // Never play a backlog after a stalled event loop.
      if (time < this.context.currentTime - 0.025) continue;
      const at = Math.max(time, this.context.currentTime);
      if (Number.isInteger(beat)) {
        this.tone(at, beat % 4 === 0 ? 1000 : 720, 0.035, 0.12, "triangle");
        if (beat >= COUNT_IN) {
          const bass = [130.81, 174.61, 196, 130.81][Math.floor((beat - COUNT_IN) / 8) % 4]!;
          this.tone(at, bass / 2, 0.19, 0.20, "triangle");
          if (beat % 2 === 0) this.tone(at, 125, 0.11, 0.28, "sine", 45);
          if (beat % 4 === 0) {
            for (const ratio of [2, 2.5, 3]) this.tone(at, bass * ratio, 0.22, 0.055, "sine");
          }
        }
      }
      const round = Math.floor((beat - COUNT_IN) / 8);
      const local = (beat - COUNT_IN) % 8;
      if (round >= 0 && PATTERNS[round]?.includes(local)) {
        this.tone(at, 480, 0.13, 0.5, "sine", 180);
        this.tone(at, 960, 0.07, 0.13, "triangle");
      }
      if (round >= 0 && local === 3.5) this.tone(at, 1568, 0.10, 0.12, "sine");
    }
  }
}
