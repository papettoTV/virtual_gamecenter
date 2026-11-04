import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrazeAudio } from "../../src/games/graze-duel/audio";

function setup() {
  const sources: Array<ReturnType<typeof sourceNode>> = [];
  const gains: Array<ReturnType<typeof gainNode>> = [];
  function sourceNode() {
    return { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  }
  function gainNode() {
    return { gain: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }
  const buffer = { duration: 0.4 };
  const context = {
    currentTime: 0, state: "running", destination: {}, close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => buffer),
    createBufferSource: vi.fn(() => { const source = sourceNode(); sources.push(source); return source; }),
    createGain: vi.fn(() => { const gain = gainNode(); gains.push(gain); return gain; }),
    createOscillator: vi.fn(), createBiquadFilter: vi.fn(),
  };
  const fetchSound = vi.fn(async (_url: string) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal("window", { AudioContext: class { constructor() { return context; } } });
  vi.stubGlobal("fetch", fetchSound);
  return { audio: createGrazeAudio(), context, sources, gains, buffer, fetchSound };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("selected U graze sound", () => {
  it("plays the selected one-shot without adding a pitched accent or changing its speed", async () => {
    const { audio, context, sources, gains, buffer, fetchSound } = setup();
    await audio.playGrazeSound(1);
    expect(fetchSound).toHaveBeenCalledOnce();
    expect(fetchSound.mock.calls[0]?.[0]).toContain("graze-u.wav");
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    expect(context.createOscillator).not.toHaveBeenCalled();
    expect(context.createBiquadFilter).not.toHaveBeenCalled();
    expect(sources[0]!.buffer).toBe(buffer);
    expect(sources[0]!.start).toHaveBeenCalledWith(0);
    expect(gains[0]!.gain.setValueAtTime).toHaveBeenCalledWith(1, 0);
    sources[0]!.onended?.();
    expect(sources[0]!.disconnect).toHaveBeenCalledOnce();
    expect(gains[0]!.disconnect).toHaveBeenCalledOnce();
    audio.dispose();
  });

  it("limits dense grazes and reuses the decoded sample", async () => {
    const { audio, context, sources, fetchSound } = setup();
    await Promise.all(Array.from({ length: 50 }, (_, index) => audio.playGrazeSound(index)));
    expect(sources).toHaveLength(1);
    for (let index = 1; index <= 20; index += 1) {
      context.currentTime = index * 0.04;
      await audio.playGrazeSound(index);
    }
    expect(sources).toHaveLength(8);
    expect(fetchSound).toHaveBeenCalledOnce();
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    sources[0]!.onended?.();
    context.currentTime += 0.04;
    await audio.playGrazeSound(24);
    expect(sources).toHaveLength(9);
    audio.dispose();
    expect(sources[8]!.stop).toHaveBeenCalledOnce();
    await audio.playGrazeSound(1);
    expect(sources).toHaveLength(9);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("does not start a delayed sound after the game is disposed", async () => {
    const { audio, context, sources } = setup();
    const pending = audio.playGrazeSound(1);
    audio.dispose();
    await pending;
    expect(sources).toHaveLength(0);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("allows a retry if the asset could not be loaded", async () => {
    const { audio, context, sources, fetchSound } = setup();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSound.mockRejectedValueOnce(new Error("offline"));
    await audio.playGrazeSound(1);
    expect(sources).toHaveLength(0);
    expect(warning).toHaveBeenCalledOnce();
    context.currentTime = 0.04;
    await audio.playGrazeSound(2);
    expect(sources).toHaveLength(1);
    expect(fetchSound).toHaveBeenCalledTimes(2);
    audio.dispose();
  });
});
