import { describe, expect, it } from "vitest";
import { canPrompt, FeedbackVisit, japanDay, readHistory, takeReturn } from "../src/features/feedback/prompt-policy";
import type { LiveShareContext } from "../src/features/sharing/share-service";
import { GAME_CATALOG } from "../src/domain/game";

const now = Date.parse("2026-10-25T12:00:00Z");
const context = (role: LiveShareContext["role"], phase: LiveShareContext["phase"]): LiveShareContext => ({ gameId: "graze-duel", cabinetId: "cabinet", role, phase });
const cabinet = "/cabinets/cabinet?game=graze-duel";

describe("feedback frequency", () => {
  it("uses Japan days and suppresses same-day prompts", () => {
    expect(japanDay(Date.parse("2026-10-25T15:00:00Z"))).toBe("2026-10-26");
    expect(canPrompt({ lastDay: "2026-10-25" }, now, "spectator")).toBe(false);
    expect(canPrompt({ lastDay: "2026-10-24" }, now, "spectator")).toBe(true);
  });
  it("only invites the first completed play and waits seven days after sending", () => {
    expect(canPrompt({ playPrompted: true }, now, "player")).toBe(false);
    expect(canPrompt({ playPrompted: true }, now, "spectator")).toBe(true);
    expect(canPrompt({ submittedAt: now - 7 * 86400000 + 1 }, now, "spectator")).toBe(false);
    expect(canPrompt({ submittedAt: now - 7 * 86400000 }, now, "spectator")).toBe(true);
  });
  it.each(["null", "[]", "bad json", '{"submittedAt":"1"}', '{"playPrompted":1}', '{"lastDay":"bad"}', "x".repeat(1025)])("suppresses automatic prompts on malformed history %s", raw => {
    expect(readHistory({ getItem: () => raw })).toBeNull();
  });
  it("safely handles unavailable storage", () => {
    expect(readHistory({ getItem: () => { throw Error("denied"); } })).toBeNull();
    expect(readHistory({ getItem: () => null })).toEqual({});
  });
});

describe("feedback visit", () => {
  it.each(GAME_CATALOG)("invites a completed $id play after top return but not during play", game => {
    const visit = new FeedbackVisit();
    visit.route(`/cabinets/check?game=${game.id}`, now);
    visit.live({ ...context("player", "playing"), gameId: game.id }, now, true);
    expect(visit.leaving(now + 10000)).toBeNull();
    visit.live({ ...context("player", "finished"), gameId: game.id }, now + 10000, true);
    visit.live(null, now + 11000, true);
    expect(visit.route("/", now + 12000)).toEqual({ gameId: game.id, activity: "player" });
  });
  it.each(GAME_CATALOG)("does not re-invite $id after opening manually in the game", game => {
    const visit = new FeedbackVisit();
    visit.route(`/cabinets/check?game=${game.id}`, now);
    visit.live({ ...context("player", "finished"), gameId: game.id }, now, true);
    visit.openedManually();
    expect(visit.leaving(now + 1000)).toBeNull();
    expect(visit.route("/", now + 2000)).toBeNull();
    visit.route(`/cabinets/next?game=${game.id}`, now + 3000);
    visit.live({ ...context("player", "finished"), gameId: game.id }, now + 4000, true);
    expect(visit.route("/", now + 5000)).toEqual({ gameId: game.id, activity: "player" });
  });
  it("preserves only eligible return context across a full page navigation", () => {
    const visit = new FeedbackVisit();
    visit.route(cabinet, now);
    visit.live(context("player", "playing"), now, true);
    expect(visit.leaving(now)).toBeNull();
    visit.live(context("player", "finished"), now + 1000, true);
    const candidate = visit.leaving(now + 2000);
    expect(candidate).toEqual({ gameId: "graze-duel", activity: "player" });
    let raw: string | null = JSON.stringify({ ...candidate, at: now });
    const storage = { getItem: () => raw, removeItem: () => { raw = null; } };
    expect(takeReturn(storage, now + 1000)).toEqual(candidate);
    expect(takeReturn(storage, now + 2000)).toBeNull();
    raw = JSON.stringify({ ...candidate, at: now });
    expect(takeReturn(storage, now + 300001)).toBeNull();
  });
  it("waits until a finished player returns to the top, even after context cleanup", () => {
    const visit = new FeedbackVisit();
    visit.route(cabinet, now);
    visit.live(context("player", "playing"), now, true);
    visit.live(context("player", "finished"), now + 1000, true);
    visit.live(null, now + 1500, true);
    expect(visit.route("/", now + 2000)).toEqual({ gameId: "graze-duel", activity: "player" });
    expect(visit.route("/", now + 3000)).toBeNull();
  });
  it("does not invite unfinished players or navigation to another screen", () => {
    const visit = new FeedbackVisit();
    visit.route(cabinet, now);
    visit.live(context("player", "playing"), now, true);
    expect(visit.route("/", now + 70000)).toBeNull();
    visit.route(cabinet, now);
    visit.live(context("player", "finished"), now, true);
    expect(visit.route("/legal/terms", now + 1)).toBeNull();
    expect(visit.route("/", now + 2)).toBeNull();
  });
  it.each([59999, 60000])("requires sixty seconds of active watching (%i)", duration => {
    const visit = new FeedbackVisit();
    visit.live(context("spectator", "playing"), now, true);
    visit.route(cabinet, now);
    expect(visit.route("/", now + duration)).toEqual(duration >= 60000 ? { gameId: "graze-duel", activity: "spectator" } : null);
  });
  it("excludes background, ready, paused and finished time", () => {
    const visit = new FeedbackVisit();
    visit.route(cabinet, now);
    visit.live(context("spectator", "ready"), now, true);
    visit.live(context("spectator", "playing"), now + 100000, true);
    visit.live(context("spectator", "playing"), now + 120000, false);
    visit.live(context("spectator", "paused"), now + 220000, true);
    visit.live(context("spectator", "playing"), now + 320000, true);
    visit.live(context("spectator", "finished"), now + 359999, true);
    expect(visit.route("/", now + 500000)).toBeNull();
  });
  it("does not transfer watching duration between games or roles", () => {
    const visit = new FeedbackVisit();
    visit.route(cabinet, now);
    visit.live(context("spectator", "playing"), now, true);
    visit.live({ ...context("spectator", "playing"), gameId: "dot-wave" }, now + 60000, true);
    expect(visit.route("/", now + 60001)).toBeNull();
  });
});
