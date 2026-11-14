import { expect, it } from "vitest";
import { createSpectatorPresence } from "../../src/features/game/spectator-presence";

it("smooths changes and pulses just once per play, including across pauses", () => {
  const presence = createSpectatorPresence();
  expect(presence.update("playing", 1, 0).tier).toBe("none");
  expect(presence.update("playing", 1, 2000).tier).toBe("watching");
  expect(presence.update("playing", 3, 2100).pulse).toBe(false);
  expect(presence.update("playing", 2, 2700).tier).toBe("watching");
  expect(presence.update("playing", 3, 3000).tier).toBe("watching");
  expect(presence.update("playing", 4, 5000)).toEqual({ tier: "crowd", pulse: true, pausedCount: null });
  expect(presence.update("playing", 4, 6450).pulse).toBe(false);
  expect(presence.update("playing", 1, 6500).tier).toBe("crowd");
  expect(presence.update("playing", 1, 10000).tier).toBe("watching");
  expect(presence.update("paused", 2, 10010)).toEqual({ tier: "none", pulse: false, pausedCount: 2 });
  presence.update("playing", 5, 11000);
  expect(presence.update("playing", 5, 13000)).toEqual({ tier: "crowd", pulse: false, pausedCount: null });
  presence.reset();
  presence.update("playing", 3, 15000);
  expect(presence.update("playing", 3, 17000).pulse).toBe(true);
});

it("keeps the raw per-play peak, excludes READY and results, and hides unknown counts", () => {
  const presence = createSpectatorPresence();
  presence.update("idle", 9, 0);
  expect(presence.peak).toBe(0);
  expect(presence.update("paused", 0, 10).pausedCount).toBe(0);
  presence.update("paused", 8, 20);
  presence.update("waiting", 10, 30);
  expect(presence.update("paused", null, 40).pausedCount).toBeNull();
  presence.update("finished", 12, 50);
  expect(presence.peak).toBe(10);
  presence.reset();
  expect(presence.peak).toBe(0);
});
