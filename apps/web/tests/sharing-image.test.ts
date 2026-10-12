import { afterEach, expect, it, vi } from "vitest";
import { drawSalvageResultImage } from "../src/games/deep-sea-salvage/sharing-image";
import { getResultImageRenderer } from "../src/features/sharing/result-images";
import type { SharedResult } from "../src/domain/shared-result";

afterEach(() => vi.unstubAllGlobals());

it("lets games replace image rendering while retaining a common default", async () => {
  expect(await getResultImageRenderer("graze-duel")).toBeNull();
  expect(await getResultImageRenderer("deep-sea-salvage")).toBe(drawSalvageResultImage);
});

it("recreates the saved survey rather than depending on the current game state", async () => {
  const paths: string[] = [];
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(path: string) { paths.push(path); this.onload?.(); }
  });
  const context = {
    createLinearGradient: () => ({ addColorStop: vi.fn() }), fillRect: vi.fn(),
    fillText: vi.fn(), drawImage: vi.fn(),
  };
  const result: SharedResult = {
    id: crypto.randomUUID(), gameId: "deep-sea-salvage", gameVersion: "test-1",
    elapsedTimeMs: 20000, cleared: false, score: 1200, playerName: "Player-test", createdAt: "2026-10-12T00:00:00Z",
    metrics: { maxDepth: 2500, discoveredCount: 2, totalSpeciesCount: 21, speciesIds: "sun-sardine,glass-bream,invalid-id" },
  };
  await drawSalvageResultImage(context as unknown as CanvasRenderingContext2D, result);
  expect(paths).toEqual(["/assets/deep-sea-salvage/encyclopedia/sun-sardine.png", "/assets/deep-sea-salvage/encyclopedia/glass-bream.png"]);
  expect(context.drawImage).toHaveBeenCalledTimes(2);
  expect(context.fillText).toHaveBeenCalledWith("ヒカリイワシ", expect.any(Number), expect.any(Number), 130);
  expect(context.fillText).toHaveBeenCalledWith("最大深度 2,500m", 64, 142, 1072);
});
