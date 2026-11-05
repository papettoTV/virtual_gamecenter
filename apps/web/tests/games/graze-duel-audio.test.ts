import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrazeAudio } from "../../src/games/graze-duel/audio";

const parameter = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });

function setup() {
  const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  const filter = { type: "", Q: parameter(), frequency: parameter(), connect: vi.fn(), disconnect: vi.fn() };
  const gain = { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    currentTime: 0, sampleRate: 48000, state: "running", destination: {}, close: vi.fn(async () => {}),
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
    createBufferSource: vi.fn(() => source), createBiquadFilter: vi.fn(() => filter), createGain: vi.fn(() => gain),
    createOscillator: vi.fn(),
  };
  vi.stubGlobal("window", { AudioContext: class { constructor() { return context; } } });
  return { audio: createGrazeAudio(), context, source, filter, gain };
}

afterEach(() => vi.unstubAllGlobals());

describe("graze scraping sound", () => {
  it("uses a brief filtered noise burst rather than a pitched oscillator", () => {
    const { audio, context, source, filter, gain } = setup();
    audio.playGrazeSound(1);
    expect(context.createOscillator).not.toHaveBeenCalled();
    expect(context.createBuffer).toHaveBeenCalledWith(1, 2880, 48000);
    expect(filter.type).toBe("bandpass");
    expect(filter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(2200, 0.045);
    expect(source.stop).toHaveBeenCalledWith(0.06);
    source.onended?.();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(filter.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
    audio.dispose();
  });

  it("limits dense grazes, reuses the noise buffer, and stops after disposal", () => {
    const { audio, context } = setup();
    for (let index = 0; index < 50; index += 1) audio.playGrazeSound(index);
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    context.currentTime = 0.04;
    audio.playGrazeSound(25);
    expect(context.createBufferSource).toHaveBeenCalledTimes(2);
    expect(context.createBuffer).toHaveBeenCalledOnce();
    audio.dispose();
    context.currentTime = 1;
    audio.playGrazeSound(1);
    expect(context.createBufferSource).toHaveBeenCalledTimes(2);
    expect(context.close).toHaveBeenCalledOnce();
  });
});
