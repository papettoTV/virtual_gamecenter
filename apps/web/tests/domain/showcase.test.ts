import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArcadeScreen } from "../../src/features/arcade/ArcadeScreen";
import { BRAND } from "../../src/domain/brand";
import { BUZZ_BARRIER, getActiveGames } from "../../src/domain/game";
import { getShowcaseCabinets, livePreviewUrl } from "../../src/features/arcade/showcase-model";

vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useEffect() {},
}));

const entry = (cabinetId: string, status: string, spectatorCount = 0) => ({ cabinetId, status, spectatorCount, gameId: "graze-duel" });

afterEach(() => vi.unstubAllGlobals());

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
  it("orders games as Buzz Barrier, Dot Wave, then Deep Sea Salvage", () => {
    expect(getActiveGames().map(game => game.id)).toEqual(["graze-duel", "dot-wave", "deep-sea-salvage"]);
  });
  it("retains the tagline while providing the brand pronunciation separately", () => {
    expect(BRAND.reading).toBe("パルベース");
    expect(BRAND.tagline).toBe("本気のプレイが、人を呼ぶ。");
  });
  it("uses the saved updated boss demo and matching poster", () => {
    expect(BUZZ_BARRIER.promoVideoUrl).toBe("/demos/buzz-barrier/boss-demo-v1.mp4");
    expect(BUZZ_BARRIER.promoPosterUrl).toBe("/demos/buzz-barrier/boss-demo-v1.jpg");
  });
  it("shows four showcases including Coming Soon and disabled watch actions when no one is playing", () => {
    vi.stubGlobal("document", { visibilityState: "visible" });
    const html = renderToStaticMarkup(createElement(ArcadeScreen, { onSelectGame() {} }));
    expect(html.match(/<article\b/g)).toHaveLength(4);
    expect(html.indexOf("showcase-graze-duel")).toBeLessThan(html.indexOf("showcase-dot-wave"));
    expect(html.indexOf("showcase-dot-wave")).toBeLessThan(html.indexOf("showcase-deep-sea-salvage"));
    expect(html.indexOf("showcase-deep-sea-salvage")).toBeLessThan(html.indexOf("COMING SOON"));
    expect(html.match(/class="showcase-watch" disabled=""/g)).toHaveLength(3);
    expect(html.match(/>遊ぶ /g)).toHaveLength(3);
  });
});
