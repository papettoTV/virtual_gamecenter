import { afterEach, describe, expect, it, vi } from "vitest";
import { startShowcaseDemo } from "../../src/games/deep-sea-salvage/showcase-demo";

const renderer = vi.hoisted(() => ({ draw: vi.fn(), dispose: vi.fn() }));
vi.mock("../../src/games/deep-sea-salvage/renderer", () => ({ createRenderer: () => renderer }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("deep sea showcase demo", () => {
  it("animates actual game state and releases its animation and renderer", () => {
    let callback: FrameRequestCallback | undefined;
    const request = vi.fn((next: FrameRequestCallback) => { callback = next; return 17; });
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const stop = startShowcaseDemo({ width: 960, height: 640 } as HTMLCanvasElement);
    expect(request).toHaveBeenCalledOnce();
    callback?.(performance.now() + 33);
    expect(renderer.draw).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
    stop();
    expect(cancel).toHaveBeenCalledWith(17);
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});
