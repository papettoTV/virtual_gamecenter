import { describe, expect, it, vi } from "vitest";
import { createLevelUpLabel, drawLevelUpLabel, tickLevelUpLabel } from "../../src/games/graze-duel/level-up-label";

describe("level-up label", () => {
  it("fixes the new level in front of the original player position for one second", () => {
    const player = { x: 200, y: 400, fieldX: 44, level: 12 };
    const label = createLevelUpLabel(player);
    player.x += 100;
    player.y += 100;
    expect(label).toEqual({ x: 156, y: 372, level: 12, remaining: 1 });
    const updated = tickLevelUpLabel(label, 0.4)!;
    expect(updated).toEqual({ ...label, remaining: 0.6 });
    expect(label.remaining).toBe(1);
    expect(tickLevelUpLabel(updated, 0.6)).toBeNull();
    expect(tickLevelUpLabel(null, 0.1)).toBeNull();
  });

  it("replaces the displayed level and anchor on the next level-up", () => {
    const player = { x: 200, y: 400, fieldX: 44, level: 12 };
    const first = createLevelUpLabel(player);
    const second = createLevelUpLabel({ ...player, x: 240, level: 13 });
    expect(first.level).toBe(12);
    expect(second).toEqual({ x: 196, y: 372, level: 13, remaining: 1 });
  });

  it("draws thin text within the field and supports the opponent field offset", () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), measureText: vi.fn(() => ({ width: 50 })), fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    drawLevelUpLabel(context, { x: 156, y: 352, level: 12, remaining: 0.5 }, 524, 392, 74, 690);
    expect(context.fillText).toHaveBeenNthCalledWith(1, "LEVEL", 626, 352);
    expect(context.fillText).toHaveBeenNthCalledWith(2, "12", 684, 352);
    expect(context.font).toBe("300 44px system-ui");
    expect(context.fillStyle).toBe("rgba(153, 133, 255, 0.9)");
    drawLevelUpLabel(context, { x: 0, y: 20, level: 13, remaining: 1 }, 44, 392, 74, 690);
    expect(context.fillText).toHaveBeenNthCalledWith(3, "LEVEL", 52, 100);
    expect(context.fillText).toHaveBeenLastCalledWith("13", 110, 100);
    drawLevelUpLabel(context, null, 44, 392, 74, 690);
    expect(context.fillText).toHaveBeenCalledTimes(4);
  });
});
