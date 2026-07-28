import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Cloudflare Worker", () => {
  it("serves the health endpoint locally", async () => {
    const response = await exports.default.fetch("http://localhost/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      runtime: "cloudflare-workers",
    });
  });

  it("validates ranking requests before writing to D1", async () => {
    const response = await exports.default.fetch("http://localhost/api/ranking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerName: "", clearTimeMs: 1000 }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_player_name",
    });
  });

  it("rejects writes to the cabinet directory endpoint", async () => {
    const response = await exports.default.fetch("http://localhost/api/cabinets", {
      method: "POST",
    });
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
    });
  });
});
