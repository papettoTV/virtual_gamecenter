import { afterEach, expect, it, vi } from "vitest";
import { DuelAudio } from "../../src/games/mochi-beat/duel/audio";
import { BEAT, END_BEAT } from "../../src/games/mochi-beat/duel/core";

let clock = 0;
const starts: number[] = [];
const parameter = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
class AudioClock {
  get currentTime() { return clock; }
  destination = {};
  state = "running";
  sampleRate = 48000;
  createBuffer() { return {}; }
  createBufferSource() { return { buffer: null, connect() {}, disconnect() {}, onended: null, start() {} }; }
  createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
  createOscillator() { return { frequency: parameter(), connect() {}, disconnect() {}, start(time: number) { starts.push(time); }, stop() {}, onended: null }; }
  async resume() {}
  async suspend() {}
  async close() {}
}
afterEach(() => { vi.unstubAllGlobals(); });
it("aligns the audio clock with a scheduled network start or a late snapshot", async () => {
  clock = 0; starts.length = 0; vi.stubGlobal("AudioContext", AudioClock);
  const audio = new DuelAudio();
  await audio.start(0, BEAT, 3);
  expect(audio.seconds).toBe(-3);
  clock = 3;
  expect(audio.seconds).toBe(0);
  await audio.start(0, BEAT, 0, 2.25);
  expect(audio.seconds).toBe(2.25);
  audio.dispose();
});
it("keeps the next beat on the same audio clock without duplicates across turns", async () => {
  clock = 0; starts.length = 0; vi.stubGlobal("AudioContext", AudioClock);
  const audio = new DuelAudio(); await audio.start(0);
  const boundary = .2 + END_BEAT * BEAT;
  clock = boundary - .05; audio.schedule();
  const boundaryVoices = starts.filter(time => Math.abs(time - boundary) < 1e-8).length;
  expect(boundaryVoices).toBe(2);
  clock = boundary + .025; audio.advance(2);
  expect(audio.seconds).toBeCloseTo(.025);
  expect(starts.filter(time => Math.abs(time - boundary) < 1e-8)).toHaveLength(boundaryVoices);
  clock = boundary + END_BEAT * BEAT + .01; audio.advance(1);
  expect(audio.seconds).toBeCloseTo(.01);
  audio.dispose();
});
it("does not schedule another count-in after the final exchange", async () => {
  clock = 0; starts.length = 0; vi.stubGlobal("AudioContext", AudioClock);
  const audio = new DuelAudio(); await audio.start(0);
  const boundary = .2 + END_BEAT * BEAT;
  clock = boundary - .05; audio.schedule(false);
  expect(starts.some(time => time >= boundary)).toBe(false);
  audio.dispose();
});


it("changes tempo at the boundary without moving or duplicating the downbeat", async () => {
  clock = 0; starts.length = 0; vi.stubGlobal("AudioContext", AudioClock);
  const audio = new DuelAudio(); await audio.start(0);
  const boundary = .2 + END_BEAT * BEAT;
  clock = boundary - .05; audio.schedule();
  clock = boundary + .01; audio.advance(1, .4);
  expect(audio.seconds).toBeCloseTo(.01);
  expect(starts.filter(time => Math.abs(time - boundary) < 1e-8)).toHaveLength(2);
  clock = boundary + .35; audio.schedule();
  expect(starts.filter(time => Math.abs(time - (boundary + .4)) < 1e-8)).toHaveLength(2);
  audio.dispose();
});

it("keeps judgement time unchanged when combat and result effects play", async () => {
  clock = 0; starts.length = 0; vi.stubGlobal("AudioContext", AudioClock);
  const audio = new DuelAudio(); await audio.start(0);
  clock = 2;
  const seconds = audio.seconds;
  audio.hit("perfect"); audio.hit("good", true); audio.hit("miss");
  audio.waitTurn();
  audio.resolve(12, false); audio.resolve(0, true); audio.rise();
  audio.finish("win"); audio.finish("lose"); audio.finish("draw");
  expect(audio.seconds).toBe(seconds);
  expect(starts.every(Number.isFinite)).toBe(true);
  expect(starts.some(time => time > clock)).toBe(true);
  audio.stop(); audio.dispose();
});

it("aligns after a delayed mobile audio resume instead of retaining the old timestamp", async () => {
  clock = 0;
  let wall = 1000;
  class DelayedClock extends AudioClock {
    override async resume() { wall += 400; }
  }
  vi.stubGlobal("AudioContext", DelayedClock);
  const audio = new DuelAudio();
  await audio.startAt(0, BEAT, 2000, () => wall);
  expect(audio.seconds).toBeCloseTo(-.6);
  wall = 3000;
  await audio.startAt(0, BEAT, 2000, () => wall);
  expect(audio.seconds).toBeCloseTo(1.4);
  audio.dispose();
});

it("starts a silent source synchronously while the gesture resumes a suspended context", async () => {
  let started = false, complete!: () => void;
  class SuspendedClock extends AudioClock {
    override state = "suspended";
    override resume() { return new Promise<void>(resolve => { complete = resolve; }); }
    override createBufferSource() { return { buffer: null, connect() {}, disconnect() {}, onended: null, start() { started = true; } }; }
  }
  vi.stubGlobal("AudioContext", SuspendedClock);
  const audio = new DuelAudio();
  const resuming = audio.resume();
  expect(started).toBe(true);
  complete(); await resuming;
  audio.dispose();
});

it("mutes sound without stopping or shifting the rhythm clock", async () => {
  clock = 0; vi.stubGlobal("AudioContext", AudioClock);
  const audio = new DuelAudio(); await audio.start(0);
  expect(audio.audible).toBe(true);
  audio.setMuted(true); audio.volume(.65);
  expect(audio.audible).toBe(false);
  clock = 2;
  expect(audio.seconds).toBeCloseTo(1.8);
  audio.setMuted(false);
  expect(audio.audible).toBe(true);
  expect(audio.seconds).toBeCloseTo(1.8);
  audio.dispose();
});
