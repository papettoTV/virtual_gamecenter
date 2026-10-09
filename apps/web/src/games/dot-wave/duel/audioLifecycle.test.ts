import { afterEach, expect, it, vi } from "vitest";
import { DuelAudio } from "./audio";

afterEach(() => vi.unstubAllGlobals());

it("does not schedule audio after a pending resume completes following disposal", async () => {
  let resolveResume!: () => void;
  const pending = new Promise<void>(resolve => { resolveResume = resolve; });
  const close = vi.fn();
  const createOscillator = vi.fn();
  vi.stubGlobal("AudioContext", class {
    state = "running";
    currentTime = 0;
    destination = {};
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    resume() { return pending; }
    close = close;
    createOscillator = createOscillator;
  });
  const audio = new DuelAudio();
  const started = audio.start(0);
  audio.dispose();
  audio.dispose();
  resolveResume();
  await started;
  audio.hit("perfect");
  expect(createOscillator).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});
