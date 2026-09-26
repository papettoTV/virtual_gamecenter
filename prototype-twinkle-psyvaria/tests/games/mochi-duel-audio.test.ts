import { afterEach, expect, it, vi } from "vitest";
import { DuelAudio } from "../../src/games/mochi-beat/duel/audio";
import { BEAT, END_BEAT, createExchange, tap, release, releaseWindow } from "../../src/games/mochi-beat/duel/core";

let clock = 0;
const starts: number[] = [];
const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), cancelAndHoldAtTime: vi.fn() });
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

it('adds bass and accompaniment on the phrase boundary without shifting guide timing', async()=>{
 for(const [stage,voices] of [[0,3],[1,5],[2,9]] as const) {
  clock=0;starts.length=0;vi.stubGlobal('AudioContext',AudioClock);
  const audio=new DuelAudio();audio.setMusicStages([0,stage]);await audio.start(0,BEAT,.2);
  clock=.15;audio.schedule();
  const phrase=.2+4*BEAT;
  clock=phrase-.05;audio.schedule();
  expect(starts.filter(t=>Math.abs(t-phrase)<1e-8)).toHaveLength(voices);
  expect(starts.filter(t=>Math.abs(t-.2)<1e-8)).toHaveLength(2);
  expect(audio.seconds).toBeCloseTo(clock-.2);
  audio.dispose();
 }
});

it('keeps accompaniment eighth notes on the tempo and stops them at the final boundary', async () => {
  clock = 0; starts.length = 0; vi.stubGlobal('AudioContext', AudioClock);
  const audio = new DuelAudio(); audio.setMusicStages([2, 2]);
  const beatSeconds = .4;
  await audio.start(0, beatSeconds, .2);
  for (let step = 0; step <= END_BEAT * 2; step++) {
    clock = .2 + step / 2 * beatSeconds - .05;
    audio.schedule(false);
  }
  // The offbeat melody and percussion use the same clock at a faster BPM.
  expect(starts.filter(time => Math.abs(time - .4) < 1e-8)).toHaveLength(2);
  expect(starts.every(time => Math.abs((time - .2) / .2 - Math.round((time - .2) / .2)) < 1e-8)).toBe(true);
  expect(starts.every(time => time < .2 + END_BEAT * beatSeconds)).toBe(true);
  audio.dispose();
});

it('matches the attack hold envelope, deduplicates updates, and fades from its current volume on release', async () => {
  const gains: ReturnType<AudioClock['createGain']>[] = [];
  const oscillators: ReturnType<AudioClock['createOscillator']>[] = [];
  class HoldClock extends AudioClock {
    override createGain() {
      const gain = super.createGain(); gains.push(gain); return gain;
    }
    override createOscillator() {
      const voice = { ...super.createOscillator(), stop: vi.fn() };
      oscillators.push(voice); return voice;
    }
  }
  clock = 0; vi.stubGlobal('AudioContext', HoldClock);
  const audio = new DuelAudio();
  await audio.start(15, .5, 0);
  clock = 2; audio.schedule();
  const attackGain = gains.at(-1)!.gain;
  const attackVoice = oscillators.at(-1)!;
  const attackAt = clock;
  oscillators.length = 0;
  clock = 0;
  const exchange = createExchange(0, 15, .5);
  tap(exchange, 1, 4);
  audio.syncDefenseHold(exchange, 4);
  const voice = oscillators[0]!;
  const defenseGain = gains.at(-1)!.gain;
  const relativeCalls = (calls: number[][], origin: number) => calls.map(([value, time]) => [value, Number((time! - origin).toFixed(6))]);
  for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime'] as const) {
    const attackCalls = relativeCalls(attackGain[method].mock.calls, attackAt);
    expect(relativeCalls(defenseGain[method].mock.calls, 0).slice(0, attackCalls.length)).toEqual(attackCalls);
  }
  expect(relativeCalls(voice.frequency.exponentialRampToValueAtTime.mock.calls, 0))
    .toEqual(relativeCalls(attackVoice.frequency.exponentialRampToValueAtTime.mock.calls, attackAt));
  expect(voice.frequency.setValueAtTime).toHaveBeenCalledWith(523.25, 0);
  expect(voice.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(783.99, .5);
  expect(voice.stop).toHaveBeenCalledWith(expect.closeTo(.5 + releaseWindow(.5) + .02));
  clock = .1; audio.syncDefenseHold(exchange, 4.1);
  expect(oscillators).toHaveLength(1);
  release(exchange, 1, 4.1); audio.syncDefenseHold(exchange, 4.1);
  expect(defenseGain.cancelAndHoldAtTime).toHaveBeenCalledWith(.1);
  expect(voice.stop).toHaveBeenLastCalledWith(expect.closeTo(.12));
  audio.dispose();
});

it('resumes a snapshot hold at its current pitch and cancels it on pause or turn change', async () => {
  const oscillators: ReturnType<AudioClock['createOscillator']>[] = [];
  class HoldClock extends AudioClock {
    override createOscillator() {
      const voice = { ...super.createOscillator(), stop: vi.fn() };
      oscillators.push(voice); return voice;
    }
  }
  clock = 0; vi.stubGlobal('AudioContext', HoldClock);
  const audio = new DuelAudio(), exchange = createExchange(1, 15, .5);
  tap(exchange, 0, 4);
  audio.syncDefenseHold(exchange, 4.25);
  expect(oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(expect.closeTo(Math.sqrt(523.25 * 783.99)), 0);
  await audio.pause();
  expect(oscillators[0]!.stop).toHaveBeenLastCalledWith(.02);
  audio.syncDefenseHold(exchange, 4.25);
  audio.advance(0);
  expect(oscillators[1]!.stop).toHaveBeenLastCalledWith(.02);
  const voicesAfterAdvance = oscillators.length;
  audio.syncDefenseHold(exchange, 4.8);
  expect(oscillators).toHaveLength(voicesAfterAdvance);
  audio.dispose();
});

it('plays sixteenth guides at quarter-beat spacing without adding accompaniment subdivisions', async () => {
  clock = 0; starts.length = 0; vi.stubGlobal('AudioContext', AudioClock);
  const audio = new DuelAudio(); audio.setMusicStages([2, 2]);
  const beat = .4;
  await audio.start(24, beat, .2);
  for (let tick = 0; tick <= 160; tick++) {
    clock = tick * .02; audio.schedule();
  }
  for (const offset of [.25, .75]) {
    const at = .2 + (4 + offset) * beat;
    expect(starts.filter(time => Math.abs(time - at) < 1e-8)).toHaveLength(1);
  }
  // No quarter-beat backing notes during the preparation phrase.
  expect(starts.filter(time => Math.abs(time - (.2 + .25 * beat)) < 1e-8)).toHaveLength(0);
  expect(starts.every(Number.isFinite)).toBe(true);
  audio.dispose();
});
