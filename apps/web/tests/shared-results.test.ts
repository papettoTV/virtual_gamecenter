import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import migration from "../migrations/0016_shared_results.sql?raw";
import {
  getSharedResult, handleSharedResultsRequest, renderResultMetadata,
  rewriteResultPage, validateSharedResultDraft, type SharedResultDraft,
} from "../src/worker/shared-results";

const ownerId = "private-owner-id";
const token = "shared-result-session";
const playerName = '<script>alert("owner")</script>&';

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE accounts (id TEXT PRIMARY KEY, display_name TEXT, avatar_url TEXT)"),
    env.DB.prepare("CREATE TABLE players (id TEXT PRIMARY KEY, guest_name TEXT, account_id TEXT, deletion_requested_at TEXT)"),
    env.DB.prepare("CREATE TABLE player_sessions (token_hash TEXT PRIMARY KEY, player_id TEXT, expires_at TEXT, last_seen_at TEXT)"),
    env.DB.prepare("CREATE TABLE data_deletions (player_id TEXT, status TEXT)"),
    ...migration.trim().split(/;\s*(?=CREATE|$)/).filter(Boolean).map((statement) => env.DB.prepare(statement)),
  ]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO players (id, guest_name) VALUES (?, ?)").bind(ownerId, playerName),
    env.DB.prepare("INSERT INTO player_sessions (token_hash, player_id, expires_at) VALUES (?, ?, ?)")
      .bind(tokenHash, ownerId, "2099-01-01T00:00:00Z"),
  ]);
});

function draft(overrides: Partial<SharedResultDraft> = {}): SharedResultDraft {
  return { id: crypto.randomUUID(), gameId: "graze-duel", gameVersion: "test-1",
    elapsedTimeMs: 1234, cleared: false, score: 50, metrics: { maxLevel: 2, defeatedBossCount: 0 }, ...overrides };
}

async function post(value: unknown, authenticated = true, extraHeaders: Record<string, string> = {}) {
  return handleSharedResultsRequest(new Request("https://example.test/api/results", {
    method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Cookie: `vgc_session=${token}` } : {}), ...extraHeaders },
    body: JSON.stringify(value),
  }), env.DB);
}

describe("shared result validation", () => {
  it("accepts only whitelisted game metrics and canonicalizes UUIDs and slugs", () => {
    const value = draft({ gameId: "buzz-barrier" });
    expect(validateSharedResultDraft({ ...value, id: value.id.toUpperCase() }))?.toMatchObject({ id: value.id, gameId: "graze-duel" });
    expect(validateSharedResultDraft(draft({ gameId: "deep-sea-salvage", metrics: { maxDepth: 10.5, discoveredCount: 2, speciesIds: "fish-1,fish_2", totalSpeciesCount: 8 } }))).not.toBeNull();
    expect(validateSharedResultDraft(draft({ gameId: "dot-wave", metrics: { mode: "versus", outcome: "draw", turns: 5, remainingHp: 0 } }))).not.toBeNull();
    expect(validateSharedResultDraft(draft({ gameId: "mochi-beat", metrics: { completedSets: 3, accuracy: 1 } }))).toBeNull();
  });

  it.each([
    null, [], { id: "bad" }, { score: -1 }, { score: NaN }, { score: Infinity },
    { score: "10" }, { elapsedTimeMs: 1.5 }, { elapsedTimeMs: -1 }, { cleared: "false" },
    { gameId: "unknown" }, { gameVersion: "<script>" }, { gameVersion: "a".repeat(81) },
    { metrics: [] }, { metrics: { playerId: "secret" } }, { metrics: { maxDepth: 1 } },
    { metrics: { maxLevel: true } }, { metrics: { maxLevel: -1 } },
    { metrics: { maxLevel: Infinity } }, { metrics: JSON.parse('{"__proto__":1}') },
    { gameId: "dot-wave", metrics: { outcome: "winner" } },
    { gameId: "deep-sea-salvage", metrics: { speciesIds: "<img>" } },
  ])("rejects malformed or unsafe draft %j", (override) => {
    const value = override === null || Array.isArray(override) ? override : { ...draft(), ...override };
    expect(validateSharedResultDraft(value)).toBeNull();
  });
});

describe("shared result API", () => {
  it("requires an existing session and rejects cross-origin writes", async () => {
    expect((await post(draft(), false))?.status).toBe(401);
    expect((await post(draft(), true, { Origin: "https://attacker.test" }))?.status).toBe(403);
  });

  it("validates JSON, request size, paths, methods and missing IDs", async () => {
    expect((await post(null))?.status).toBe(400);
    expect((await post({ ...draft(), extra: "x".repeat(17000) }))?.status).toBe(413);
    const invalidJson = new Request("https://example.test/api/results", { method: "POST", headers: { Cookie: `vgc_session=${token}` }, body: "{" });
    expect((await handleSharedResultsRequest(invalidJson, env.DB))?.status).toBe(400);
    expect((await handleSharedResultsRequest(new Request("https://example.test/api/results/bad"), env.DB))?.status).toBe(400);
    expect((await handleSharedResultsRequest(new Request(`https://example.test/api/results/${crypto.randomUUID()}`), env.DB))?.status).toBe(404);
    expect((await handleSharedResultsRequest(new Request("https://example.test/api/results"), env.DB))?.status).toBe(405);
    expect(await handleSharedResultsRequest(new Request("https://example.test/api/other"), env.DB)).toBeNull();
  });

  it("snapshots server identity, returns only safe fields, and replays without mutation", async () => {
    const value = draft();
    const first = await post({ ...value, playerName: "spoof", ownerId: "spoof", playerId: "spoof" });
    expect(first?.status).toBe(201);
    const saved = (await first!.json<{ result: Record<string, unknown> }>()).result;
    expect(saved).toEqual({ ...value, playerName, createdAt: expect.stringMatching(/^\d{4}-.*Z$/) });
    await env.DB.prepare("UPDATE players SET guest_name = ? WHERE id = ?").bind("renamed", ownerId).run();
    const retry = await post({ ...value, metrics: { defeatedBossCount: 0, maxLevel: 2 } });
    expect(retry?.status).toBe(200);
    expect(await retry!.json()).toEqual({ result: saved });
    const read = await handleSharedResultsRequest(new Request(`https://example.test/api/results/${value.id}`), env.DB);
    expect(await read!.json()).toEqual({ result: saved });
    expect(await getSharedResult(env.DB, value.id.toUpperCase())).toEqual(saved);
    expect(await getSharedResult(env.DB, "bad")).toBeNull();
    const row = await env.DB.prepare("SELECT owner_id FROM shared_results WHERE id = ?").bind(value.id).first();
    expect(row?.owner_id).toBe(ownerId);
    expect(JSON.stringify(saved)).not.toContain(ownerId);
    await expect(env.DB.prepare("UPDATE shared_results SET score = 999 WHERE id = ?").bind(value.id).run()).rejects.toThrow("immutable");
  });

  it("rejects divergent retries and a different owner without leaking the saved result", async () => {
    const value = draft();
    await post(value);
    expect((await post({ ...value, score: 999 }))?.status).toBe(409);
    await env.DB.prepare("INSERT INTO players (id, guest_name) VALUES ('other-owner', 'Other')").run();
    await env.DB.prepare("UPDATE player_sessions SET player_id = 'other-owner'").run();
    const conflict = await post(value);
    expect(conflict?.status).toBe(409);
    expect(await conflict!.json()).toEqual({ error: "result_id_conflict" });
    await env.DB.prepare("UPDATE player_sessions SET player_id = ?").bind(ownerId).run();
    expect((await getSharedResult(env.DB, value.id))?.score).toBe(value.score);
  });

  it("handles simultaneous UUID retries with exactly one immutable row", async () => {
    const value = draft();
    const responses = await Promise.all([post(value), post(value)]);
    expect(responses.map((response) => response!.status).sort()).toEqual([200, 201]);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM shared_results WHERE id = ?").bind(value.id).first();
    expect(count?.count).toBe(1);
  });
});

describe("result page metadata", () => {
  it("escapes names, uses canonical absolute URLs and preserves the app shell", async () => {
    const result = { ...draft(), playerName, createdAt: "2026-01-01T00:00:00Z" };
    const metadata = renderResultMetadata(result, "https://example.test/?tracking=1");
    expect(metadata).not.toContain("<script>");
    expect(metadata).toContain("&lt;script&gt;alert(&quot;owner&quot;)&lt;/script&gt;&amp;");
    expect(metadata).toContain(`https://example.test/results/${result.id}/image.png`);
    const shell = new Response('<html><head><title>Old</title><meta property="og:title" content="Old"><meta name="description" content="Old"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>', {
      headers: { "Content-Type": "text/html", ETag: "old", "Content-Length": "999" },
    });
    const response = rewriteResultPage(shell, result, "https://example.test");
    const html = await response.text();
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html).not.toContain("Old");
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('src="/assets/app.js"');
    expect(html).not.toContain(ownerId);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("serves HTML with asset bindings and reports unavailable bindings", async () => {
    const value = draft();
    await post(value);
    const request = new Request(`https://example.test/results/${value.id}?tracking=1`);
    expect((await handleSharedResultsRequest(request, env.DB))?.status).toBe(503);
    let assetPath = "";
    const assets = { fetch: async (assetRequest: Request) => {
      assetPath = new URL(assetRequest.url).pathname;
      return new Response('<html><head></head><body><div id="root"></div></body></html>', { headers: { "Content-Type": "text/html" } });
    } } as unknown as Fetcher;
    const response = await handleSharedResultsRequest(request, env.DB, { ASSETS: assets });
    expect(response?.status).toBe(200);
    expect(assetPath).toBe("/index.html");
    expect(await response!.text()).toContain(`https://example.test/results/${value.id}`);
  });
});
