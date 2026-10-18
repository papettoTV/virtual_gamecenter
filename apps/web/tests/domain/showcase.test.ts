import { describe, expect, it } from "vitest";
import { getShowcaseCabinets, livePreviewUrl } from "../../src/features/arcade/showcase-model";

const entry = (cabinetId: string, status: string, spectatorCount = 0) => ({ cabinetId, status, spectatorCount, gameId: "graze-duel" });

describe("arcade showcases", () => {
  it("shows only active play and prefers watched cabinets without mutating the directory", () => {
    const entries = [entry("waiting", "occupied", 99), entry("solo", "soloPlaying"), entry("versus", "versusPlaying", 12), entry("result", "result", 30), entry("challenge", "challengePending", 2)];
    expect(getShowcaseCabinets(entries).map(value => value.cabinetId)).toEqual(["versus", "challenge", "solo"]);
    expect(entries[0]?.cabinetId).toBe("waiting");
  });
  it("uses a stable order when audiences tie", () => {
    expect(getShowcaseCabinets([entry("b", "soloPlaying"), entry("a", "soloPlaying")]).map(value => value.cabinetId)).toEqual(["a", "b"]);
  });
  it("leaves empty games in demo mode", () => {
    expect(getShowcaseCabinets([])).toEqual([]);
  });
  it("joins previews as observers, never as players", () => {
    const url = new URL(livePreviewUrl(entry("room", "soloPlaying")), "https://example.com");
    expect(url.pathname).toBe("/cabinets/room");
    expect(url.searchParams.get("game")).toBe("graze-duel");
    expect(url.searchParams.get("watch")).toBe("1");
    expect(url.searchParams.get("preview")).toBe("1");
    expect(url.searchParams.has("start")).toBe(false);
  });
  it("encodes identifiers", () => {
    expect(livePreviewUrl({ ...entry("a/b", "soloPlaying"), gameId: "game & other" })).toContain("a%2Fb?game=game%20%26%20other");
  });
});
