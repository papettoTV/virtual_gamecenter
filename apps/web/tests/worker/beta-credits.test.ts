import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { reconcileBetaCredits, type CreditPolicy } from "../../src/worker/beta-credits";
import { handlePlatformRequest, type StripePaymentEnv } from "../../src/worker/platform";
import { registerGoogleAccount } from "../../src/worker/google-auth";

const migrations = import.meta.glob<string>("../../migrations/*.sql", {
  eager: true, query: "?raw", import: "default",
});

beforeAll(async () => {
  for (const path of Object.keys(migrations).sort()) {
    const sql = migrations[path]!.replace(/^--.*$/gm, "");
    await env.DB.batch(sql.split(/;\s*(?=(?:CREATE|ALTER|UPDATE|INSERT)\b)/)
      .filter((statement) => statement.trim()).map((statement) => env.DB.prepare(statement)));
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface State {
  playerId: string;
  creditPolicy: CreditPolicy;
  wallet: { freeBalance: number; purchasedBalance: number; availableTotal: number };
}

function cookies(response: Response): string {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

async function api(path: string, cookie = "", method = "GET", body?: unknown, paymentEnv: StripePaymentEnv = {}) {
  return (await handlePlatformRequest(new Request(`http://localhost/api/platform/${path}`, {
    method, headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env.DB, paymentEnv))!;
}

async function guest(device?: string) {
  const response = await api("bootstrap", device ? `vgc_device=${device}` : "");
  const state = await response.json<State>();
  return { ...state, cookie: [cookies(response), device ? `vgc_device=${device}` : ""].filter(Boolean).join("; ") };
}

async function balance(playerId: string, free: number, purchased = 0) {
  await env.DB.prepare("UPDATE credit_wallets SET free_balance = ?, purchased_balance = ? WHERE player_id = ?")
    .bind(free, purchased, playerId).run();
}

async function eligible(free = 0, purchased = 0) {
  const player = await guest();
  await api("welcome-credit", player.cookie, "POST");
  await balance(player.playerId, free, purchased);
  return player;
}

describe("free beta daily credits", () => {
  it("does not grant a new guest anything before the exact five-credit welcome", async () => {
    const player = await guest();
    expect(player.wallet.availableTotal).toBe(0);
    expect(player.creditPolicy).toMatchObject({ purchasesEnabled: false, dailyRefillTarget: 3, timeZone: "Asia/Tokyo", refilledToday: false, refilledAmount: 0 });
    expect((await (await api("credits", player.cookie)).json<State>()).wallet.availableTotal).toBe(0);
    const welcome = await (await api("welcome-credit", player.cookie, "POST")).json<State>();
    expect(welcome.wallet.availableTotal).toBe(5);
    const repeat = await (await api("bootstrap", player.cookie)).json<State>();
    expect(repeat.wallet.availableTotal).toBe(5);
    expect(repeat.creditPolicy.refilledToday).toBe(false);
    await balance(player.playerId, 1);
    const later = await (await api("credits", player.cookie)).json<State>();
    expect(later.wallet.freeBalance).toBe(3);
    expect(later.creditPolicy.refilledAmount).toBe(2);
  });

  it.each([[0, 0, 3], [1, 0, 2], [2, 0, 1], [0, 2, 1], [3, 0, 0], [5, 0, 0], [1, 2, 0], [0, 8, 0]])(
    "tops up gross free=%i paid=%i by %i without changing paid credits", async (free, purchased, amount) => {
      const player = await eligible(free, purchased);
      const result = await (await api("credits", player.cookie)).json<State>();
      expect(result.creditPolicy.refilledAmount).toBe(amount);
      expect(result.creditPolicy.refilledToday).toBe(amount > 0);
      expect(result.wallet.freeBalance).toBe(free + amount);
      expect(result.wallet.purchasedBalance).toBe(purchased);
    },
  );

  it("allows only a single positive grant per day, including parallel requests", async () => {
    const player = await eligible(1);
    const responses = await Promise.all(Array.from({ length: 12 }, () => api("credits", player.cookie)));
    const states = await Promise.all(responses.map((response) => response.json<State>()));
    expect(states.reduce((sum, state) => sum + state.creditPolicy.refilledAmount, 0)).toBe(2);
    expect(states.every((state) => state.creditPolicy.refilledToday)).toBe(true);
    await balance(player.playerId, 0);
    const repeat = await (await api("credits", player.cookie)).json<State>();
    expect(repeat.wallet.freeBalance).toBe(0);
    expect(repeat.creditPolicy).toMatchObject({ refilledToday: true, refilledAmount: 0 });
    const ledger = await env.DB.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE player_id = ? AND id LIKE 'beta-refill:%'")
      .bind(player.playerId).first<{ count: number }>();
    expect(ledger?.count).toBe(1);
  });

  it("uses JST midnight, not a rolling 24 hours", async () => {
    const player = await eligible();
    const before = await reconcileBetaCredits(env.DB, player.playerId, "midnight-device", false, new Date("2030-01-01T14:59:59Z"));
    expect(before).toMatchObject({ nextRefillAt: "2030-01-01T15:00:00.000Z", refilledAmount: 3 });
    await balance(player.playerId, 1);
    const repeat = await reconcileBetaCredits(env.DB, player.playerId, "midnight-device", false, new Date("2030-01-01T14:59:59.999Z"));
    expect(repeat.refilledAmount).toBe(0);
    const after = await reconcileBetaCredits(env.DB, player.playerId, "midnight-device", false, new Date("2030-01-01T15:00:00Z"));
    expect(after).toMatchObject({ nextRefillAt: "2030-01-02T15:00:00.000Z", refilledAmount: 2 });
  });

  it("reconciles bootstrap and a long-open tab's next reservation after JST midnight", async () => {
    const player = await eligible();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2032-01-01T14:59:59Z"));
    const bootstrap = await (await api("bootstrap", player.cookie)).json<State>();
    expect(bootstrap.creditPolicy).toMatchObject({ refilledAmount: 3, nextRefillAt: "2032-01-01T15:00:00.000Z" });
    await balance(player.playerId, 0);
    expect((await (await api("credits", player.cookie)).json<State>()).creditPolicy.refilledAmount).toBe(0);
    vi.setSystemTime(new Date("2032-01-01T15:00:00Z"));
    const reservation = await api("credit-reservations", player.cookie, "POST", { cabinetId: "midnight", gameId: "graze-duel" });
    expect(reservation.status).toBe(200);
    expect((await reservation.json<State>()).wallet.freeBalance).toBe(3);
    const credits = await (await api("credits", player.cookie)).json<State>();
    expect(credits.creditPolicy).toMatchObject({ refilledAmount: 0, refilledToday: true, nextRefillAt: "2032-01-02T15:00:00.000Z" });
  });

  it("supports legacy welcome grants and preserves legacy paid balances", async () => {
    const player = await guest();
    await env.DB.prepare(
      `INSERT INTO credit_ledger_entries (id, player_id, balance_type, entry_type, amount)
       VALUES (?, ?, 'free', 'free_granted', 5)`,
    ).bind(`initial-grant:${player.playerId}`, player.playerId).run();
    await balance(player.playerId, 0, 2);
    const sessionCookie = /vgc_session=[^;]+/.exec(player.cookie)![0];
    const response = await api("credits", sessionCookie);
    expect(cookies(response)).toContain("vgc_device=");
    const state = await response.json<State>();
    expect(state.creditPolicy.refilledAmount).toBe(1);
    expect(state.wallet).toMatchObject({ freeBalance: 1, purchasedBalance: 2 });
  });

  it("keeps account bonus at five and makes account-only users eligible", async () => {
    const player = await guest();
    const token = /vgc_session=([^;]+)/.exec(player.cookie)![1]!;
    const profile = { sub: crypto.randomUUID(), name: "Account" };
    await registerGoogleAccount(env.DB, { playerId: player.playerId, token, secureCookie: false }, profile);
    await registerGoogleAccount(env.DB, { playerId: player.playerId, token, secureCookie: false }, profile);
    const registered = await (await api("bootstrap", player.cookie)).json<State>();
    expect(registered.wallet.freeBalance).toBe(5);
    expect(registered.creditPolicy.refilledAmount).toBe(0);
    await api("welcome-credit", player.cookie, "POST");
    expect((await (await api("credits", player.cookie)).json<State>()).wallet.freeBalance).toBe(10);
    const accountOnly = await guest();
    await registerGoogleAccount(env.DB, { playerId: accountOnly.playerId, token: /vgc_session=([^;]+)/.exec(accountOnly.cookie)![1]!, secureCookie: false }, { sub: crypto.randomUUID(), name: "Other" });
    await balance(accountOnly.playerId, 0);
    expect((await (await api("credits", accountOnly.cookie)).json<State>()).creditPolicy.refilledAmount).toBe(3);
  });

  it("prevents same-device logout and login from claiming repeatedly", async () => {
    const player = await eligible();
    const token = /vgc_session=([^;]+)/.exec(player.cookie)![1]!;
    const device = /vgc_device=([^;]+)/.exec(player.cookie)![1]!;
    const profile = { sub: crypto.randomUUID(), name: "Account" };
    await registerGoogleAccount(env.DB, { playerId: player.playerId, token, secureCookie: false }, profile);
    await balance(player.playerId, 0);
    expect((await (await api("credits", player.cookie)).json<State>()).creditPolicy.refilledAmount).toBe(3);
    const logout = await api("auth/logout", player.cookie, "POST");
    const guestCookie = `${cookies(logout)}; vgc_device=${device}`;
    const loggedOut = await (await api("credits", guestCookie)).json<State>();
    expect(loggedOut.wallet.freeBalance).toBe(0);
    expect(loggedOut.creditPolicy).toMatchObject({ refilledToday: true, refilledAmount: 0 });
    await registerGoogleAccount(env.DB, { playerId: loggedOut.playerId, token: /vgc_session=([^;]+)/.exec(guestCookie)![1]!, secureCookie: false }, profile);
    await balance(player.playerId, 0);
    expect((await (await api("credits", guestCookie)).json<State>()).creditPolicy.refilledAmount).toBe(0);
  });

  it("enforces both player and device uniqueness under cross-session concurrency", async () => {
    const first = await eligible();
    const second = await eligible();
    const now = new Date("2031-01-01T00:00:00Z");
    const sameDevice = await Promise.all([first, second].map((player) => reconcileBetaCredits(env.DB, player.playerId, "shared-device", false, now)));
    expect(sameDevice.reduce((sum, policy) => sum + policy.refilledAmount, 0)).toBe(3);
    const winner = first.playerId;
    await balance(winner, 0);
    const nextDay = new Date("2031-01-02T00:00:00Z");
    const samePlayer = await Promise.all(["device-a", "device-b"].map((device) => reconcileBetaCredits(env.DB, winner, device, false, nextDay)));
    expect(samePlayer.reduce((sum, policy) => sum + policy.refilledAmount, 0)).toBe(3);
  });

  it("does not treat reservations as spending, refill on capture, or require bootstrap before next play", async () => {
    const player = await eligible(3);
    const sessionCookie = /vgc_session=[^;]+/.exec(player.cookie)![0];
    const reserve = await api("credit-reservations", sessionCookie, "POST", { cabinetId: "beta", gameId: "graze-duel" });
    expect(reserve.status).toBe(200);
    expect(cookies(reserve)).toContain("vgc_device=");
    const reservation = await reserve.json<{ reservationId: string }>();
    const held = await (await api("credits", sessionCookie)).json<State>();
    expect(held.creditPolicy.refilledAmount).toBe(0);
    expect(held.wallet.freeBalance).toBe(3);
    expect(held.wallet.availableTotal).toBe(2);
    const capture = await api(`credit-reservations/${reservation.reservationId}/capture`, sessionCookie, "POST");
    expect(cookies(capture)).toContain("vgc_device=");
    expect((await capture.json<State>()).wallet.freeBalance).toBe(2);
    const next = await api("credit-reservations", sessionCookie, "POST", { cabinetId: "beta", gameId: "graze-duel" });
    expect((await next.json<State>()).wallet.freeBalance).toBe(3);
    const direct = await api("credits", sessionCookie);
    expect(cookies(direct)).toContain("vgc_device=");
    expect((await direct.json<State>()).creditPolicy.refilledAmount).toBe(0);
    const missing = await api("credit-reservations/missing/capture", sessionCookie, "POST");
    expect(missing.status).toBe(404);
    expect(cookies(missing)).toContain("vgc_device=");
    const invalid = await api("credit-reservations", sessionCookie, "POST", { gameId: "missing" });
    expect(invalid.status).toBe(404);
    expect(cookies(invalid)).toContain("vgc_device=");
  });

  it("denies unknown sessions without creating credits or reservations", async () => {
    for (const [path, method] of [["credits", "GET"], ["credit-reservations", "POST"], ["credit-reservations/unknown/capture", "POST"]]) {
      const response = await api(path!, "vgc_session=unknown", method!);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "player_session_required" });
    }
  });
});

describe("beta purchase gate", () => {
  it.each([undefined, "false", "TRUE", "1"])("rejects disabled checkout (%s) before any DB or Stripe access", async (enabled) => {
    const stripe = vi.spyOn(globalThis, "fetch");
    const database = { prepare: vi.fn(() => { throw new Error("database must not be accessed"); }) } as unknown as D1Database;
    const response = await handlePlatformRequest(new Request("http://localhost/api/platform/credit-purchases/checkout", { method: "POST" }), database, { CREDIT_PURCHASES_ENABLED: enabled, STRIPE_SECRET_KEY: "sk_test_example" });
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "purchases_disabled" });
    expect(database.prepare).not.toHaveBeenCalled();
    expect(stripe).not.toHaveBeenCalled();
  });

  it("explicitly enables Stripe checkout, while disabled mode still processes existing webhook and status", async () => {
    const player = await guest();
    await api("consents", player.cookie, "POST", { termsVersion: "2026-10-12.2", privacyVersion: "2026-10-12.2" });
    const checkoutId = `cs_${crypto.randomUUID()}`;
    const stripe = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: checkoutId, url: "https://checkout.stripe.com/test" }));
    const checkout = await api("credit-purchases/checkout", player.cookie, "POST", { unitCount: 1 }, { CREDIT_PURCHASES_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_example" });
    expect(checkout.status).toBe(200);
    expect(stripe).toHaveBeenCalledTimes(1);
    const { purchaseId } = await checkout.json<{ purchaseId: string }>();
    const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: checkoutId, payment_status: "paid", client_reference_id: purchaseId, currency: "jpy", amount_total: 100, metadata: { purchase_id: purchaseId } } } });
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = "whsec_beta";
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`))), (byte) => byte.toString(16).padStart(2, "0")).join("");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const webhook = await handlePlatformRequest(new Request("http://localhost/api/platform/stripe/webhook", { method: "POST", headers: { "Stripe-Signature": `t=${timestamp},v1=${signature}` }, body: payload }), env.DB, { CREDIT_PURCHASES_ENABLED: "false", STRIPE_WEBHOOK_SECRET: secret });
      expect(webhook?.status).toBe(200);
    }
    const status = await api(`credit-purchases/status?sessionId=${checkoutId}`, player.cookie);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ status: "paid", wallet: { purchasedBalance: 5 } });
  });

  it("retains consent enforcement when purchases are explicitly enabled", async () => {
    const player = await guest();
    const stripe = vi.spyOn(globalThis, "fetch");
    const response = await api("credit-purchases/checkout", player.cookie, "POST", { unitCount: 1 }, { CREDIT_PURCHASES_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_example" });
    expect(await response.json()).toEqual({ error: "policy_consent_required" });
    expect(stripe).not.toHaveBeenCalled();
  });
});
