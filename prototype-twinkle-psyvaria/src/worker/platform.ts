const SESSION_COOKIE = "vgc_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const INITIAL_FREE_CREDITS = 5;
const PLAY_CREDIT_COST = 1;
const TERMS_VERSION = "2026-07-26";
const PRIVACY_VERSION = "2026-07-26";
const CREDIT_UNITS = new Set([1, 3, 5, 10]);
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface StripePaymentEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

interface PlayerSession {
  playerId: string;
  token: string;
  setCookie: boolean;
  secureCookie: boolean;
}

interface WalletSummary {
  freeBalance: number;
  purchasedBalance: number;
  reservedFree: number;
  reservedPurchased: number;
  availableFree: number;
  availablePurchased: number;
  availableTotal: number;
}

export async function handlePlatformRequest(
  request: Request,
  database: D1Database,
  paymentEnv: StripePaymentEnv = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/platform/")) return null;

  if (url.pathname === "/api/platform/stripe/webhook" && request.method === "POST") {
    return handleStripeWebhook(request, database, paymentEnv);
  }

  if (url.pathname === "/api/platform/bootstrap" && request.method === "GET") {
    const session = await getOrCreatePlayerSession(request, database);
    const consent = await getConsentState(database, session.playerId);
    const wallet = await getWalletSummary(database, session.playerId);
    return platformJson(
      {
        playerId: session.playerId,
        consent,
        wallet,
        creditCost: PLAY_CREDIT_COST,
      },
      session,
    );
  }

  const session = await getExistingPlayerSession(request, database);
  if (!session) return Response.json({ error: "player_session_required" }, { status: 401 });

  if (url.pathname === "/api/platform/consents" && request.method === "POST") {
    const body = await readJson(request);
    if (
      body?.termsVersion !== TERMS_VERSION
      || body?.privacyVersion !== PRIVACY_VERSION
    ) {
      return Response.json({ error: "policy_version_mismatch" }, { status: 409 });
    }

    await database.batch([
      database.prepare(
        `INSERT OR IGNORE INTO consent_records
          (id, player_id, policy_type, policy_version)
         VALUES (?, ?, 'terms', ?)`,
      ).bind(crypto.randomUUID(), session.playerId, TERMS_VERSION),
      database.prepare(
        `INSERT OR IGNORE INTO consent_records
          (id, player_id, policy_type, policy_version)
         VALUES (?, ?, 'privacy', ?)`,
      ).bind(crypto.randomUUID(), session.playerId, PRIVACY_VERSION),
      database.prepare(
        `INSERT OR IGNORE INTO credit_ledger_entries
          (id, player_id, balance_type, entry_type, amount, reference_id)
         VALUES (?, ?, 'free', 'free_granted', ?, 'initial-consent-grant')`,
      ).bind(`initial-grant:${session.playerId}`, session.playerId, INITIAL_FREE_CREDITS),
    ]);

    return Response.json({
      consent: await getConsentState(database, session.playerId),
      wallet: await getWalletSummary(database, session.playerId),
    });
  }

  if (url.pathname === "/api/platform/credits" && request.method === "GET") {
    return Response.json({ wallet: await getWalletSummary(database, session.playerId) });
  }

  if (url.pathname === "/api/platform/credit-purchases/checkout" && request.method === "POST") {
    if (!paymentEnv.STRIPE_SECRET_KEY) {
      return Response.json({ error: "stripe_not_configured" }, { status: 503 });
    }

    const body = await readJson(request);
    const unitCount = Number(body?.unitCount);
    const currency = body?.currency === "usd" ? "usd" : "jpy";
    if (!CREDIT_UNITS.has(unitCount)) {
      return Response.json({ error: "invalid_credit_unit" }, { status: 400 });
    }

    const creditAmount = getCreditAmount(unitCount);
    const amountTotal = unitCount * 100;
    const purchaseId = crypto.randomUUID();
    const returnPath = sanitizeReturnPath(body?.returnPath);
    const successUrl = new URL(returnPath, url.origin);
    successUrl.searchParams.set("purchase", "success");
    successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
    const cancelUrl = new URL(returnPath, url.origin);
    cancelUrl.searchParams.set("purchase", "cancelled");

    await database.prepare(
      `INSERT INTO credit_purchases
        (id, player_id, unit_count, credit_amount, currency, amount_total, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    ).bind(
      purchaseId,
      session.playerId,
      unitCount,
      creditAmount,
      currency,
      amountTotal,
    ).run();

    const form = new URLSearchParams({
      mode: "payment",
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      client_reference_id: purchaseId,
      "metadata[purchase_id]": purchaseId,
      "metadata[player_id]": session.playerId,
      "metadata[credit_amount]": String(creditAmount),
      "metadata[unit_count]": String(unitCount),
      "line_items[0][price_data][currency]": currency,
      "line_items[0][price_data][unit_amount]": String(amountTotal),
      "line_items[0][price_data][product_data][name]": `${creditAmount} Credits`,
      "line_items[0][price_data][product_data][description]": "Virtual Game Center play credits",
      "line_items[0][quantity]": "1",
      locale: "auto",
      submit_type: "pay",
    });

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paymentEnv.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": purchaseId,
      },
      body: form,
    });
    const stripeSession = await stripeResponse.json<{
      id?: string;
      url?: string;
      error?: { message?: string };
    }>();
    if (!stripeResponse.ok || !stripeSession.id || !stripeSession.url) {
      await database.prepare(
        "UPDATE credit_purchases SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).bind(purchaseId).run();
      return Response.json(
        { error: "stripe_checkout_failed", message: stripeSession.error?.message },
        { status: 502 },
      );
    }

    await database.prepare(
      `UPDATE credit_purchases
       SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(stripeSession.id, purchaseId).run();

    return Response.json({
      purchaseId,
      checkoutSessionId: stripeSession.id,
      checkoutUrl: stripeSession.url,
    });
  }

  if (url.pathname === "/api/platform/credit-purchases/status" && request.method === "GET") {
    const checkoutSessionId = url.searchParams.get("sessionId") ?? "";
    const purchase = await database.prepare(
      `SELECT id, status, credit_amount
       FROM credit_purchases
       WHERE stripe_checkout_session_id = ? AND player_id = ?`,
    ).bind(checkoutSessionId, session.playerId).first<{
      id: string;
      status: string;
      credit_amount: number;
    }>();
    if (!purchase) {
      return Response.json({ error: "purchase_not_found" }, { status: 404 });
    }
    return Response.json({
      purchaseId: purchase.id,
      status: purchase.status,
      creditAmount: purchase.credit_amount,
      wallet: await getWalletSummary(database, session.playerId),
    });
  }

  if (url.pathname === "/api/platform/credit-reservations" && request.method === "POST") {
    const consent = await getConsentState(database, session.playerId);
    if (!consent.accepted) {
      return Response.json({ error: "consent_required" }, { status: 403 });
    }

    const body = await readJson(request);
    const cabinetId = sanitizeId(body?.cabinetId, "cabinet");
    const purpose = body?.purpose === "challenge" || body?.purpose === "rematch"
      ? body.purpose
      : "solo";
    const reservationId = crypto.randomUUID();
    const playSessionId = crypto.randomUUID();
    const wallet = await getWalletSummary(database, session.playerId);
    const balanceType = wallet.availableFree >= PLAY_CREDIT_COST ? "free" : "purchased";
    const expiresAt = new Date(
      Date.now() + (purpose === "solo" ? 2 : purpose === "challenge" ? 120 : 15) * 60 * 1000,
    ).toISOString();

    try {
      await database.batch([
        database.prepare(
          `INSERT INTO play_sessions
            (id, cabinet_id, game_id, mode, status, host_player_id)
           VALUES (?, ?, 'graze-duel', ?, 'credit_reserved', ?)`,
        ).bind(playSessionId, cabinetId, purpose === "solo" ? "solo" : "versus", session.playerId),
        database.prepare(
          `INSERT INTO credit_reservations
            (id, player_id, play_session_id, amount, balance_type, status, expires_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        ).bind(
          reservationId,
          session.playerId,
          playSessionId,
          PLAY_CREDIT_COST,
          balanceType,
          expiresAt,
        ),
      ]);
    } catch (error) {
      if (String(error).includes("insufficient_credit")) {
        return Response.json(
          {
            error: "insufficient_credit",
            wallet: await getWalletSummary(database, session.playerId),
          },
          { status: 409 },
        );
      }
      throw error;
    }

    return Response.json({
      reservationId,
      playSessionId,
      wallet: await getWalletSummary(database, session.playerId),
    });
  }

  const reservationMatch = url.pathname.match(
    /^\/api\/platform\/credit-reservations\/([a-zA-Z0-9-]+)\/(capture|release)$/,
  );
  if (reservationMatch && request.method === "POST") {
    const reservationId = reservationMatch[1]!;
    const action = reservationMatch[2]!;
    const reservation = await database.prepare(
      `SELECT id, play_session_id, amount, balance_type, status
       FROM credit_reservations
       WHERE id = ? AND player_id = ?`,
    ).bind(reservationId, session.playerId).first<{
      id: string;
      play_session_id: string;
      amount: number;
      balance_type: "free" | "purchased";
      status: string;
    }>();

    if (!reservation) {
      return Response.json({ error: "reservation_not_found" }, { status: 404 });
    }
    if (reservation.status !== "active") {
      return Response.json({
        reservationId,
        status: reservation.status,
        wallet: await getWalletSummary(database, session.playerId),
      });
    }

    if (action === "capture") {
      await database.batch([
        database.prepare(
          `INSERT OR IGNORE INTO credit_ledger_entries
            (id, player_id, balance_type, entry_type, amount, play_session_id, reference_id)
           VALUES (?, ?, ?, 'consumed', ?, ?, ?)`,
        ).bind(
          `consume:${reservationId}`,
          session.playerId,
          reservation.balance_type,
          -reservation.amount,
          reservation.play_session_id,
          reservationId,
        ),
        database.prepare(
          `UPDATE credit_reservations
           SET status = 'captured', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'active'`,
        ).bind(reservationId),
        database.prepare(
          `UPDATE play_sessions
           SET status = 'playing', started_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(reservation.play_session_id),
      ]);
    } else {
      await database.batch([
        database.prepare(
          `UPDATE credit_reservations
           SET status = 'released', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'active'`,
        ).bind(reservationId),
        database.prepare(
          `UPDATE play_sessions
           SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(reservation.play_session_id),
      ]);
    }

    return Response.json({
      reservationId,
      status: action === "capture" ? "captured" : "released",
      wallet: await getWalletSummary(database, session.playerId),
    });
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}

async function handleStripeWebhook(
  request: Request,
  database: D1Database,
  paymentEnv: StripePaymentEnv,
): Promise<Response> {
  if (!paymentEnv.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "stripe_not_configured" }, { status: 503 });
  }
  const rawBody = await request.text();
  const signature = request.headers.get("Stripe-Signature");
  if (!signature || !await verifyStripeSignature(
    rawBody,
    signature,
    paymentEnv.STRIPE_WEBHOOK_SECRET,
  )) {
    return Response.json({ error: "invalid_stripe_signature" }, { status: 400 });
  }

  let event: StripeCheckoutEvent;
  try {
    event = JSON.parse(rawBody) as StripeCheckoutEvent;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return Response.json({ received: true });
  }
  const checkout = event.data?.object;
  if (!checkout || checkout.payment_status !== "paid") {
    return Response.json({ received: true });
  }

  const purchaseId = checkout.metadata?.purchase_id;
  if (!purchaseId) {
    return Response.json({ error: "purchase_metadata_missing" }, { status: 400 });
  }
  const purchase = await database.prepare(
    `SELECT id, player_id, credit_amount, currency, amount_total, status
     FROM credit_purchases WHERE id = ?`,
  ).bind(purchaseId).first<{
    id: string;
    player_id: string;
    credit_amount: number;
    currency: string;
    amount_total: number;
    status: string;
  }>();
  if (!purchase) return Response.json({ error: "purchase_not_found" }, { status: 404 });
  if (
    checkout.client_reference_id !== purchase.id
    || checkout.currency !== purchase.currency
    || checkout.amount_total !== purchase.amount_total
  ) {
    return Response.json({ error: "purchase_mismatch" }, { status: 409 });
  }

  await database.batch([
    database.prepare(
      `INSERT OR IGNORE INTO credit_ledger_entries
        (id, player_id, balance_type, entry_type, amount, reference_id)
       VALUES (?, ?, 'purchased', 'purchased', ?, ?)`,
    ).bind(
      `stripe-purchase:${checkout.id}`,
      purchase.player_id,
      purchase.credit_amount,
      checkout.id,
    ),
    database.prepare(
      `UPDATE credit_purchases
       SET stripe_checkout_session_id = ?, status = 'paid',
           paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status != 'paid'`,
    ).bind(checkout.id, purchase.id),
  ]);

  return Response.json({ received: true });
}

interface StripeCheckoutEvent {
  type?: string;
  data?: {
    object?: {
      id: string;
      payment_status?: string;
      client_reference_id?: string;
      currency?: string;
      amount_total?: number;
      metadata?: Record<string, string>;
    };
  };
}

export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, "0")
  )).join("");
  return signatures.some((candidate) => timingSafeEqual(candidate, expected));
}

export function getCreditAmount(unitCount: number): number {
  if (!CREDIT_UNITS.has(unitCount)) throw new Error("invalid_credit_unit");
  return unitCount === 10 ? 60 : unitCount * 5;
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function getOrCreatePlayerSession(
  request: Request,
  database: D1Database,
): Promise<PlayerSession> {
  const existing = await getExistingPlayerSession(request, database);
  if (existing) return existing;

  const token = createSessionToken();
  const tokenHash = await hashToken(token);
  const playerId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  await database.batch([
    database.prepare("INSERT INTO players (id) VALUES (?)").bind(playerId),
    database.prepare(
      `INSERT INTO player_sessions (token_hash, player_id, expires_at)
       VALUES (?, ?, ?)`,
    ).bind(tokenHash, playerId, expiresAt),
    database.prepare(
      "INSERT INTO credit_wallets (player_id) VALUES (?)",
    ).bind(playerId),
  ]);

  return {
    playerId,
    token,
    setCookie: true,
    secureCookie: new URL(request.url).protocol === "https:",
  };
}

async function getExistingPlayerSession(
  request: Request,
  database: D1Database,
): Promise<PlayerSession | null> {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const session = await database.prepare(
    `SELECT player_id
     FROM player_sessions
     WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP`,
  ).bind(tokenHash).first<{ player_id: string }>();
  if (!session) return null;

  await database.prepare(
    `UPDATE player_sessions
     SET last_seen_at = CURRENT_TIMESTAMP, expires_at = ?
     WHERE token_hash = ?`,
  ).bind(
    new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
    tokenHash,
  ).run();
  return {
    playerId: session.player_id,
    token,
    setCookie: true,
    secureCookie: new URL(request.url).protocol === "https:",
  };
}

async function getConsentState(database: D1Database, playerId: string) {
  const rows = await database.prepare(
    `SELECT policy_type, policy_version
     FROM consent_records
     WHERE player_id = ?
       AND (
         (policy_type = 'terms' AND policy_version = ?)
         OR (policy_type = 'privacy' AND policy_version = ?)
       )`,
  ).bind(playerId, TERMS_VERSION, PRIVACY_VERSION).all<{
    policy_type: string;
    policy_version: string;
  }>();
  const acceptedTypes = new Set(rows.results.map((row) => row.policy_type));
  return {
    accepted: acceptedTypes.has("terms") && acceptedTypes.has("privacy"),
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
  };
}

async function getWalletSummary(
  database: D1Database,
  playerId: string,
): Promise<WalletSummary> {
  const wallet = await database.prepare(
    `SELECT
       w.free_balance,
       w.purchased_balance,
       COALESCE(SUM(CASE
         WHEN r.status = 'active' AND r.expires_at > CURRENT_TIMESTAMP AND r.balance_type = 'free'
         THEN r.amount ELSE 0 END), 0) AS reserved_free,
       COALESCE(SUM(CASE
         WHEN r.status = 'active' AND r.expires_at > CURRENT_TIMESTAMP AND r.balance_type = 'purchased'
         THEN r.amount ELSE 0 END), 0) AS reserved_purchased
     FROM credit_wallets w
     LEFT JOIN credit_reservations r ON r.player_id = w.player_id
     WHERE w.player_id = ?
     GROUP BY w.player_id`,
  ).bind(playerId).first<{
    free_balance: number;
    purchased_balance: number;
    reserved_free: number;
    reserved_purchased: number;
  }>();

  const freeBalance = wallet?.free_balance ?? 0;
  const purchasedBalance = wallet?.purchased_balance ?? 0;
  const reservedFree = wallet?.reserved_free ?? 0;
  const reservedPurchased = wallet?.reserved_purchased ?? 0;
  const availableFree = Math.max(0, freeBalance - reservedFree);
  const availablePurchased = Math.max(0, purchasedBalance - reservedPurchased);
  return {
    freeBalance,
    purchasedBalance,
    reservedFree,
    reservedPurchased,
    availableFree,
    availablePurchased,
    availableTotal: availableFree + availablePurchased,
  };
}

function platformJson(
  body: unknown,
  session: PlayerSession,
): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (session.setCookie) {
    headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${session.secureCookie ? "; Secure" : ""}`,
    );
  }
  return new Response(JSON.stringify(body), { headers });
}

function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function sanitizeId(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const sanitized = value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80);
  return sanitized || fallback;
}

function sanitizeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  try {
    const url = new URL(value, "https://virtual-gamecenter.invalid");
    if (url.origin !== "https://virtual-gamecenter.invalid") return "/";
    url.searchParams.delete("purchase");
    url.searchParams.delete("session_id");
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return await request.json<Record<string, unknown>>();
  } catch {
    return null;
  }
}
