import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultSharingStore } from "../src/features/sharing/result-sharing";
import { presentResult } from "../src/features/sharing/result-presenters";
import { liveShareText, resultShareText } from "../src/features/sharing/share-service";
import type { SharedResult, SharedResultDraft } from "../src/domain/shared-result";

vi.mock("../src/features/platform/platform-client", () => ({ fetchPlatformBootstrap: vi.fn(async () => ({})) }));
const draft = (): SharedResultDraft => ({ id: crypto.randomUUID(), gameId: "graze-duel", gameVersion: "test-1", elapsedTimeMs: 18000, cleared: true, score: 12345, metrics: { maxLevel: 30, defeatedBossCount: 3 } });
const saved = (value: SharedResultDraft): SharedResult => ({ ...value, playerName: "Player-test", createdAt: "2026-10-12T00:00:00Z" });

afterEach(() => vi.unstubAllGlobals());

describe("game hashtags in share defaults", () => {
  it.each([
    ["graze-duel", "#バズバリア #BUZZBRRIER"],
    ["dot-wave", "#ドットウェーブ #DOTWAVE"],
    ["deep-sea-salvage", "#深海サルベージ #DEEPSEASALVAGE"],
  ])("includes %s tags in invitations and player/viewer results", (gameId, tags) => {
    const expected = `${tags} #PULBASE`;
    for (const role of ["player", "spectator"] as const) {
      for (const phase of ["ready", "playing", "paused", "finished"] as const) {
        expect(liveShareText({ gameId, cabinetId: "cabinet", role, phase }).split("\n").at(-1)).toBe(expected);
      }
    }
    const result = saved({ ...draft(), gameId });
    expect(presentResult(result).text.split("\n").at(-1)).toBe(expected);
    expect(resultShareText(result).split("\n").at(-1)).toBe(expected);
    expect(resultShareText(result, true).split("\n").at(-1)).toBe(expected);
  });

  it("does not add another game's tags for an unknown game", () => {
    const gameId = "new-game";
    const result = saved({ ...draft(), gameId });
    expect(liveShareText({ gameId, cabinetId: "cabinet", role: "player", phase: "ready" }).split("\n").at(-1)).toBe("#PULBASE");
    expect(resultShareText(result).split("\n").at(-1)).toBe("#PULBASE");
    expect(resultShareText(result, true).split("\n").at(-1)).toBe("#PULBASE");
  });
});

describe("game-specific result presenters", () => {
  it("describes clears without claiming unsupported personal best or rank", () => {
    const card = presentResult(draft());
    expect(card.headline).toBe("ALL CLEAR");
    expect(card.text).toContain("12,345");
    expect(card.text).not.toMatch(/自己ベスト|初クリア|位/);
    expect(presentResult({ ...draft(), cleared: false }).text).not.toContain("クリア");
  });
  it("prioritizes depth and current-run survey for salvage", () => {
    const card = presentResult({ ...draft(), gameId: "deep-sea-salvage", metrics: { maxDepth: 4567.8, discoveredCount: 8, totalSpeciesCount: 21 } });
    expect(card.headline).toBe("最大深度 4,567m");
    expect(card.text).toContain("今回の調査は8種");
    expect(card.imageLines[1]).toContain("8 / 21");
  });
  it("supports both sides of a battle without inventing reversals", () => {
    const result = { ...draft(), gameId: "dot-wave", metrics: { mode: "versus", outcome: "win", turns: 6, remainingHp: 10 } };
    expect(presentResult(result).text).toContain("対人戦で勝利");
    expect(presentResult({ ...result, metrics: { ...result.metrics, outcome: "lose" } }).text).not.toContain("勝利");
    expect(presentResult({ ...result, metrics: { ...result.metrics, outcome: "draw" } }).headline).toBe("引き分け");
  });
  it("provides a fallback for a future game", () => {
    expect(presentResult({ ...draft(), gameId: "new-game" }).text).toContain("new-game");
  });
  it("lets readers introduce someone else's result without claiming they played", () => {
    const text = resultShareText(saved(draft()), true);
    expect(text).toContain("Player-testさんのBUZZ BARRIERのプレイ結果");
    expect(text).not.toContain("に挑戦！");
  });
});

describe("live invitation copy", () => {
  const context = { gameId: "graze-duel", cabinetId: "cabinet", role: "player" as const, phase: "ready" as const };
  it("does not claim a live is running before start or after end", () => {
    expect(liveShareText(context)).toContain("これから");
    expect(liveShareText({ ...context, phase: "finished" })).toContain("終了しました");
  });
  it("distinguishes player, pause, and spectator messages", () => {
    expect(liveShareText({ ...context, phase: "playing" })).toContain("挑戦中");
    expect(liveShareText({ ...context, phase: "paused" })).toContain("休憩中");
    expect(liveShareText({ ...context, role: "spectator", phase: "playing" })).toContain("一緒に見ませんか");
  });
});

describe("result publication store", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  it("only saves on demand and coalesces concurrent publication", async () => {
    const store = new ResultSharingStore(); const value = draft();
    store.setResult(value);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(Response.json({ result: saved(value) }));
    const results = await Promise.all([store.ensureSaved(), store.ensureSaved()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
    await store.ensureSaved();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("allows a reader to reshare a published result without POSTing as its owner", async () => {
    const store = new ResultSharingStore(); const value = saved(draft());
    store.usePublished(value);
    expect(await store.ensureSaved()).toEqual(value);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not attach a late old result to the next run", async () => {
    const store = new ResultSharingStore(); const old = draft(); const next = draft();
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(done => { resolve = done; }));
    store.setResult(old); const request = store.ensureSaved();
    await Promise.resolve(); await Promise.resolve();
    store.setResult(next); resolve(Response.json({ result: saved(old) })); await request;
    vi.mocked(fetch).mockResolvedValue(Response.json({ result: saved(next) }));
    expect((await store.ensureSaved()).id).toBe(next.id);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("retries a failed save with the same id and clears only its own game", async () => {
    const store = new ResultSharingStore(); const value = draft(); store.setResult(value);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json({ result: saved(value) }));
    await expect(store.ensureSaved()).rejects.toThrow("result_save_failed");
    expect((await store.ensureSaved()).id).toBe(value.id);
    store.clear("dot-wave"); expect(store.getSnapshot()).not.toBeNull();
    store.clear(value.gameId); expect(store.getSnapshot()).toBeNull();
  });
});
