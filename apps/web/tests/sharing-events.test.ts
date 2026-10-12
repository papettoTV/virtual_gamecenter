import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleSharingEvent } from "../src/worker/sharing-events";

beforeEach(async () => {
  await env.DB.prepare("DROP TABLE IF EXISTS sharing_events").run();
  await env.DB.prepare("CREATE TABLE sharing_events (id TEXT PRIMARY KEY, event_type TEXT, kind TEXT, game_id TEXT, target_id TEXT, share_id TEXT, channel TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
});

function post(body: unknown, origin = "http://localhost") {
  return handleSharingEvent(new Request("http://localhost/api/platform/sharing/events", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) }), env.DB);
}

describe("sharing interaction events", () => {
  it("records separately from actual SNS publication and deduplicates retries", async () => {
    const event = { eventId: crypto.randomUUID(), eventType: "share_target_opened", kind: "result", gameId: "graze-duel", targetId: crypto.randomUUID(), channel: "x", shareId: crypto.randomUUID() };
    expect((await post(event)).status).toBe(200); expect((await post(event)).status).toBe(200);
    const rows = await env.DB.prepare("SELECT * FROM sharing_events").all();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).not.toHaveProperty("player_id");
  });
  it("rejects arbitrary channels, types, names, and cross-origin requests", async () => {
    const event = { eventId: "test", eventType: "result_viewed", kind: "result", gameId: "graze-duel", targetId: "test" };
    expect((await post(event, "https://evil.test")).status).toBe(403);
    expect((await post({ ...event, eventType: "posted_successfully" })).status).toBe(400);
    expect((await post({ ...event, gameId: "not-a-game" })).status).toBe(400);
    expect((await post({ ...event, channel: "custom" })).status).toBe(400);
    expect((await post(null)).status).toBe(400);
  });
});
