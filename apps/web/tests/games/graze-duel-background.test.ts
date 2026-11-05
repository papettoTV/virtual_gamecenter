import { afterEach, expect, it, vi } from "vitest";
import { createCyberCanyonBackground } from "../../src/games/graze-duel/rendering/cyber-canyon-background";

afterEach(() => vi.unstubAllGlobals());

it("scrolls both canyon contours and side streaks at half the previous rate", () => {
  const tileContext = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  const tile = { width: 0, height: 0, getContext: vi.fn(() => tileContext) };
  vi.stubGlobal("document", { createElement: vi.fn(() => tile) });
  const context = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  const background = createCyberCanyonBackground(392, 616);
  background.draw(context, 44, 74, 1);
  expect(context.translate).toHaveBeenCalledWith(44, 74);
  expect(context.drawImage).toHaveBeenNthCalledWith(1, tile, 0, 57.5 - 1232);
  expect(context.drawImage).toHaveBeenNthCalledWith(2, tile, 0, 57.5);
  const distance = (1.25 * 0.3) ** 1.55;
  expect(context.lineTo.mock.calls[0]![1]).toBeCloseTo(distance * (616 + 48) - 24);
  background.dispose();
  expect(tile.width).toBe(0);
  expect(tile.height).toBe(0);
});
