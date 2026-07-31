const SESSION_COOKIE = "vgc_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const INITIAL_FREE_CREDITS = 5;
const PLAY_CREDIT_COST = 1;
const TERMS_VERSION = "2026-07-26";
const PRIVACY_VERSION = "2026-07-26";

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
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/platform/")) return null;

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
           VALUES (?, ?, ?, ?, 'free', 'active', ?)`,
        ).bind(reservationId, session.playerId, playSessionId, PLAY_CREDIT_COST, expiresAt),
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
    "UPDATE player_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?",
  ).bind(tokenHash).run();
  return {
    playerId: session.player_id,
    token,
    setCookie: false,
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

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return await request.json<Record<string, unknown>>();
  } catch {
    return null;
  }
}
