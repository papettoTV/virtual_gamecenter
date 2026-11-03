import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrazeAudio } from "../../src/games/graze-duel/audio";

const parameter = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });

function setup() {
  const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  const filter = { type: "", Q: parameter(), frequency: parameter(), connect: vi.fn(), disconnect: vi.fn() };
  const gain = { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() };
  const accentGain = { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() };
  const accent = { type: "", frequency: parameter(), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  const context = {
    currentTime: 0, sampleRate: 48000, state: "running", destination: {}, close: vi.fn(async () => {}),
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
    createBufferSource: vi.fn(() => source), createBiquadFilter: vi.fn(() => filter),
    createGain: vi.fn().mockReturnValueOnce(gain).mockReturnValue(accentGain),
    createOscillator: vi.fn(() => accent),
  };
  vi.stubGlobal("window", { AudioContext: class { constructor() { return context; } } });
  return { audio: createGrazeAudio(), context, source, filter, gain, accent, accentGain };
}

afterEach(() => vi.unstubAllGlobals());

describe("graze scraping sound", () => {
  it("layers a brief scraping burst with a short, bright downward accent", () => {
    const { audio, context, source, filter, gain, accent, accentGain } = setup();
    audio.playGrazeSound(1);
    expect(context.createOscillator).toHaveBeenCalledOnce();
    expect(accent.type).toBe("sine");
    expect(accent.frequency.setValueAtTime).toHaveBeenCalledWith(1812, 0);
    expect(accent.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(1158, 0.028);
    expect(accent.stop).toHaveBeenCalledWith(0.08);
    expect(context.createBuffer).toHaveBeenCalledWith(1, 2880, 48000);
    expect(filter.type).toBe("bandpass");
    expect(filter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(2000, 0.045);
    expect(source.stop).toHaveBeenCalledWith(0.06);
    source.onended?.();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(filter.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
    accent.onended?.();
    expect(accent.disconnect).toHaveBeenCalledOnce();
    expect(accentGain.disconnect).toHaveBeenCalledOnce();
    audio.dispose();
  });

  it("limits dense grazes, reuses the noise buffer, and stops after disposal", () => {
    const { audio, context } = setup();
    for (let index = 0; index < 50; index += 1) audio.playGrazeSound(index);
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    context.currentTime = 0.04;
    audio.playGrazeSound(25);
    expect(context.createBufferSource).toHaveBeenCalledTimes(2);
    expect(context.createOscillator).toHaveBeenCalledTimes(2);
    expect(context.createBuffer).toHaveBeenCalledOnce();
    audio.dispose();
    context.currentTime = 1;
    audio.playGrazeSound(1);
    expect(context.createBufferSource).toHaveBeenCalledTimes(2);
    expect(context.close).toHaveBeenCalledOnce();
  });
});
