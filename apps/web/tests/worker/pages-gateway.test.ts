import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import gateway from "../../src/pages/gateway.mjs";
import worker from "../../src/worker/index";
import { migrateTestDatabase } from "../migrate-test-database";
import type { ServerMessage } from "../../src/shared/protocol";
import { hashIdentifier } from "../../src/worker/identity-hash";

beforeAll(migrateTestDatabase);
afterAll(async () => {
  const ip = await hashIdentifier("staging:ip:192.0.2.90");
  await vi.waitFor(async () => { expect(await env.ABUSE_GUARDS.getByName("admission").admissionCount(ip)).toBe(0); });
  await new Promise(resolve => setTimeout(resolve, 200));
});

const origin = "https://develop.virtual-gamecenter.pages.dev";
const authorization = "Basic " + btoa("test:test");
const backend = {
  fetch(request: Request) {
    return worker.fetch(request as Parameters<typeof worker.fetch>[0], { ...env, APP_ENV: "staging", BASIC_AUTH_USERNAME: "test", BASIC_AUTH_PASSWORD: "test", GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test", ASSETS: { fetch: async () => new Response("<html>game</html>", { headers: { "Content-Type": "text/html" } }) } } as unknown as Env);
  },
};
const forwarded = (path: string, init?: RequestInit) => gateway.fetch(new Request(origin + path, {
  ...init, headers: { Authorization: authorization, "CF-Connecting-IP": "192.0.2.90", ...Object.fromEntries(new Headers(init?.headers)) },
}), { APP_ENV: "staging", BACKEND: backend });

function nextMessage(socket: WebSocket, predicate: (message: ServerMessage) => boolean) {
  return new Promise<ServerMessage>((resolve, reject) => {
    const timer = setTimeout(() => { socket.removeEventListener("message", receive); reject(Error("WebSocket message timed out")); }, 4000);
    const receive = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.removeEventListener("message", receive);
      resolve(message);
    };
    socket.addEventListener("message", receive);
  });
}

describe("Pages to Worker gateway", () => {
  it.each([undefined, "null", "https://untrusted.example", "https://virtual-gamecenter.pages.dev"])(
    "rejects unsafe API and WebSocket origins: %s", async unsafeOrigin => {
      const headers: Record<string, string> = unsafeOrigin ? { Origin: unsafeOrigin } : {};
      const mutation = await forwarded("/api/platform/auth/logout", { method: "POST", headers });
      expect(mutation.status).toBe(403);
      expect(await mutation.json()).toEqual({ error: "invalid_origin" });
      const socket = await forwarded(`/api/cabinets/${crypto.randomUUID()}/ws?gameId=graze-duel`, { headers: { ...headers, Upgrade: "websocket" } });
      expect(socket.status).toBe(403);
      expect(await socket.json()).toEqual({ error: "invalid_origin" });
    },
  );

  it("does not cache personal balances and keeps signed webhook authentication separate", async () => {
    expect((await forwarded("/api/platform/bootstrap")).headers.get("cache-control")).toBe("private, no-store");
    const webhook = await forwarded("/api/platform/stripe/webhook", { method: "POST", body: "{}" });
    expect(webhook.status).not.toBe(200);
    expect(await webhook.json()).not.toEqual({ error: "invalid_origin" });
  });

  it("preserves origin, query, authorization, body and cookies", async () => {
    let captured: Request | undefined;
    const response = await gateway.fetch(new Request(origin + "/api/test?game=dot-wave", {
      method: "POST", headers: { Origin: origin, Cookie: "vgc_session=test", Authorization: authorization, "X-Pulbase-Gateway-Environment": "production" }, body: "payload",
    }), { APP_ENV: "staging", BACKEND: { fetch(request: Request) { captured = request; return new Response("ok", { headers: { "Set-Cookie": "vgc_session=server; Secure; HttpOnly" } }); } } });
    expect(captured!.url).toBe(origin + "/api/test?game=dot-wave");
    expect(captured!.headers.get("origin")).toBe(origin);
    expect(captured!.headers.get("authorization")).toBe(authorization);
    expect(captured!.headers.get("cookie")).toBe("vgc_session=test");
    expect(captured!.headers.get("X-Pulbase-Gateway-Environment")).toBe("staging");
    expect(await captured!.text()).toBe("payload");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("does not fall back to public assets when binding or backend fails", async () => {
    for (const BACKEND of [undefined, { fetch() { throw Error("private error"); } }]) {
      const response = await gateway.fetch(new Request(origin), { APP_ENV: "staging", BACKEND });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private error");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("rejects preview requests routed into production", async () => {
    const response = await gateway.fetch(new Request(origin), { APP_ENV: "production", BACKEND: backend });
    expect(response.status).toBe(403);
    const mismatch = await worker.fetch(new Request(origin + "/api/platform/bootstrap", { headers: { "X-Pulbase-Gateway-Environment": "production" } }) as Parameters<typeof worker.fetch>[0], env);
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toEqual({ error: "backend_environment_mismatch" });
  });

  it("serves the game shell and retains Basic authentication", async () => {
    const denied = await gateway.fetch(new Request(origin + "/"), { APP_ENV: "staging", BACKEND: backend });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("Basic");
    expect(await (await forwarded("/")).text()).toContain("<html>game</html>");
  });

  it("keeps Google login callback and return URL on the Pages host", async () => {
    const bootstrap = await forwarded("/api/platform/bootstrap");
    const initial = await bootstrap.json() as { playerId: string; consent: { termsVersion: string; privacyVersion: string } };
    const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
    await env.DB.batch(["terms", "privacy"].map(kind => env.DB.prepare("INSERT INTO consent_records (id, player_id, policy_type, policy_version) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), initial.playerId, kind, kind === "terms" ? initial.consent.termsVersion : initial.consent.privacyVersion)));
    const login = await forwarded("/api/platform/auth/google/start?returnTo=%2Fcabinets%2Fsample", { headers: { Cookie: cookie } });
    expect(login.status).toBe(302);
    const target = new URL(login.headers.get("location")!);
    expect(target.searchParams.get("redirect_uri")).toBe(origin + "/api/platform/auth/google/callback");
    expect(login.headers.get("set-cookie")).toContain("Secure");
    const developer = await forwarded("/api/platform/auth/developer");
    expect(developer.headers.get("location")).toContain("developer_auth_unavailable");
  });

  it("returns WebSocket upgrades without rebuilding the response", async () => {
    const pair = new WebSocketPair();
    pair[1].accept();
    const upgrade = new Response(null, { status: 101, webSocket: pair[0] });
    const response = await gateway.fetch(new Request(origin + "/api/cabinets/test/ws", { headers: { Upgrade: "websocket" } }), { APP_ENV: "staging", BACKEND: { fetch: () => upgrade } });
    expect(response).toBe(upgrade);
    expect(response.status).toBe(101);
    pair[1].close();
  });

  it("completes the Google callback, keeps the Pages return path and adds registration credits", async () => {
    const bootstrap = await forwarded("/api/platform/bootstrap");
    const initial = await bootstrap.json() as { playerId: string; consent: { termsVersion: string; privacyVersion: string } };
    const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
    await env.DB.batch(["terms", "privacy"].map(kind => env.DB.prepare("INSERT INTO consent_records (id, player_id, policy_type, policy_version) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), initial.playerId, kind, kind === "terms" ? initial.consent.termsVersion : initial.consent.privacyVersion)));
    await forwarded("/api/platform/welcome-credit", { method: "POST", headers: { Cookie: cookie, Origin: origin }, body: "{}" });
    const state = crypto.randomUUID();
    const stateCookie = "vgc_oauth_state=" + encodeURIComponent(JSON.stringify({ state, returnTo: "/cabinets/callback-test" }));
    const subject = crypto.randomUUID();
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "test-token" });
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({ sub: subject, name: "Callback test", email: "callback@example.invalid" });
      throw Error("unexpected upstream");
    });
    try {
      const callback = await forwarded(`/api/platform/auth/google/callback?state=${state}&code=test-code`, { headers: { Cookie: cookie + "; " + stateCookie } });
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe(origin + "/cabinets/callback-test?account=registered");
      const profile = await (await forwarded("/api/platform/bootstrap", { headers: { Cookie: cookie } })).json();
      expect(profile).toMatchObject({ accountRegistered: true, playerName: "Callback test", wallet: { availableTotal: 10 } });
      const logout = await forwarded("/api/platform/auth/logout", { method: "POST", headers: { Cookie: cookie, Origin: origin } });
      expect(logout.status).toBe(200);
      expect(await logout.json()).toMatchObject({ accountRegistered: false, welcomeCreditGranted: true, consent: { accepted: true }, wallet: { availableTotal: 0 } });
      expect(logout.headers.get("set-cookie")).toContain("Secure");
      const guestCookie = logout.headers.get("set-cookie")!.split(";", 1)[0]!;
      const oldSession = await forwarded("/api/platform/profile", { method: "PATCH", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ playerName: "Not allowed" }) });
      expect(oldSession.status).toBe(401);
      const relogin = await forwarded(`/api/platform/auth/google/callback?state=${state}&code=test-code`, { headers: { Cookie: guestCookie + "; " + stateCookie } });
      expect(relogin.headers.get("location")).toBe(origin + "/cabinets/callback-test?account=logged_in");
      const restored = await (await forwarded("/api/platform/bootstrap", { headers: { Cookie: guestCookie } })).json();
      expect(restored).toMatchObject({ accountRegistered: true, playerName: "Callback test", wallet: { availableTotal: 10 } });
    } finally { upstream.mockRestore(); }
  });

  it("disables analytics on the staging host", async () => {
    const response = await forwarded("/analytics.js");
    expect(await response.text()).toContain("window.PULBASE_ANALYTICS_DISABLED = true;");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("starts a credited game and sends live frames to another spectator through Pages", async () => {
    const cabinetId = crypto.randomUUID();
    const bootstrap = await forwarded("/api/platform/bootstrap");
    const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
    const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json" };
    expect((await forwarded("/api/platform/welcome-credit", { method: "POST", headers, body: "{}" })).status).toBe(200);
    const reserved = await forwarded("/api/platform/credit-reservations", { method: "POST", headers, body: JSON.stringify({ cabinetId, gameId: "deep-sea-salvage", purpose: "solo" }) });
    expect(reserved.status).toBe(200);
    const reservation = await reserved.json() as { reservationId: string };
    expect((await forwarded(`/api/platform/credit-reservations/${reservation.reservationId}/capture`, { method: "POST", headers, body: "{}" })).status).toBe(200);
    const hostResponse = await forwarded(`/api/cabinets/${cabinetId}/ws?gameId=deep-sea-salvage`, { headers: { Cookie: cookie, Origin: origin, Upgrade: "websocket" } });
    const viewerResponse = await forwarded(`/api/cabinets/${cabinetId}/ws?gameId=deep-sea-salvage`, { headers: { Origin: origin, Upgrade: "websocket" } });
    expect(hostResponse.status).toBe(101);
    expect(viewerResponse.status).toBe(101);
    const host = hostResponse.webSocket as WebSocket;
    const viewer = viewerResponse.webSocket as WebSocket;
    host.accept();
    viewer.accept();
    try {
      const joined = nextMessage(host, message => message.type === "joinedCabinet");
      host.send(JSON.stringify({ type: "joinCabinet", gameId: "deep-sea-salvage" }));
      expect(await joined).toMatchObject({ role: "player" });
      const watched = nextMessage(viewer, message => message.type === "joinedCabinet");
      viewer.send(JSON.stringify({ type: "joinCabinet", gameId: "deep-sea-salvage", watch: true }));
      expect(await watched).toMatchObject({ role: "spectator" });
      const playing = nextMessage(host, message => message.type === "cabinetState" && message.state.status === "soloPlaying");
      host.send(JSON.stringify({ type: "startSolo", reservationId: reservation.reservationId }));
      await playing;
      const frame = nextMessage(viewer, message => message.type === "viewerKeyframe");
      host.send(JSON.stringify({ type: "gameKeyframe", seq: 1, snapshot: { elapsedTime: 1, depth: 20 } }));
      expect(await frame).toMatchObject({ seq: 1, snapshot: { depth: 20 } });
    } finally { host.close(); viewer.close(); }
  });
});
