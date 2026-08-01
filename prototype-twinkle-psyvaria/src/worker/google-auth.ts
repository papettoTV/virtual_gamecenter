const OAUTH_STATE_COOKIE = "vgc_oauth_state";
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const REGISTRATION_BONUS_CREDITS = 5;

export interface GoogleAuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DEVELOPER_AUTH_ENABLED?: string;
}

interface PlayerSession {
  playerId: string;
  token: string;
  secureCookie: boolean;
}

export interface GoogleProfile {
  sub: string;
  name: string;
  picture?: string;
  email?: string;
}

export async function handleGoogleAuthRequest(
  request: Request,
  database: D1Database,
  env: GoogleAuthEnv,
  getOrCreateSession: (request: Request, database: D1Database) => Promise<PlayerSession & { setCookie: boolean }>,
  getExistingSession: (request: Request, database: D1Database) => Promise<PlayerSession | null>,
  sessionCookie: (session: PlayerSession & { setCookie: boolean }) => string,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/platform/auth/developer" && request.method === "GET") {
    const returnTo = sanitizeReturnPath(url.searchParams.get("returnTo"));
    const redirect = new URL(returnTo, url.origin);
    if (!isDeveloperAuthAvailable(url, env)) {
      redirect.searchParams.set("account", "error");
      redirect.searchParams.set("reason", "developer_auth_unavailable");
      return Response.redirect(redirect.toString(), 302);
    }

    const session = await getOrCreateSession(request, database);
    await registerAccount(database, session, {
      sub: "local-developer",
      name: "開発者ユーザー",
    }, "developer");
    redirect.searchParams.set("account", "registered");
    const headers = new Headers({ Location: redirect.toString() });
    if (session.setCookie) headers.append("Set-Cookie", sessionCookie(session));
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname === "/api/platform/auth/google/start" && request.method === "GET") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      const redirect = new URL(sanitizeReturnPath(url.searchParams.get("returnTo")), url.origin);
      redirect.searchParams.set("account", "error");
      redirect.searchParams.set("reason", "not_configured");
      return Response.redirect(redirect.toString(), 302);
    }
    const session = await getOrCreateSession(request, database);
    const state = createRandomToken();
    const returnTo = sanitizeReturnPath(url.searchParams.get("returnTo"));
    const stateValue = encodeURIComponent(JSON.stringify({ state, returnTo }));
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${url.origin}/api/platform/auth/google/callback`,
      response_type: "code",
      scope: "openid profile email",
      state,
      prompt: "select_account",
    }).toString();

    const headers = new Headers({ Location: authorizationUrl.toString() });
    if (session.setCookie) headers.append("Set-Cookie", sessionCookie(session));
    headers.append("Set-Cookie", oauthStateCookie(stateValue, session.secureCookie));
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname !== "/api/platform/auth/google/callback" || request.method !== "GET") return null;
  const session = await getExistingSession(request, database);
  const stateRecord = readStateCookie(request.headers.get("Cookie"));
  const returnTo = stateRecord?.returnTo ?? "/";
  const redirect = new URL(returnTo, url.origin);
  const clearStateCookie = `${OAUTH_STATE_COOKIE}=; Path=/api/platform/auth/google; HttpOnly; SameSite=Lax; Max-Age=0`;
  const fail = (code: string) => {
    redirect.searchParams.set("account", "error");
    redirect.searchParams.set("reason", code);
    return new Response(null, { status: 302, headers: { Location: redirect.toString(), "Set-Cookie": clearStateCookie } });
  };

  if (!session) return fail("session_expired");
  if (!stateRecord || !url.searchParams.get("state") || stateRecord.state !== url.searchParams.get("state")) {
    return fail("invalid_state");
  }
  if (url.searchParams.has("error")) return fail("cancelled");
  const code = url.searchParams.get("code");
  if (!code || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail("invalid_callback");

  try {
    const profile = await fetchGoogleProfile(code, url.origin, {
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    });
    await registerGoogleAccount(database, session, profile);
    redirect.searchParams.set("account", "registered");
    return new Response(null, {
      status: 302,
      headers: { Location: redirect.toString(), "Set-Cookie": clearStateCookie },
    });
  } catch (error) {
    console.error("Google account registration failed", error);
    return fail("registration_failed");
  }
}

async function fetchGoogleProfile(
  code: string,
  origin: string,
  env: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string },
): Promise<GoogleProfile> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/api/platform/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  const token = await tokenResponse.json<{ access_token?: string }>();
  if (!tokenResponse.ok || !token.access_token) throw new Error("google_token_exchange_failed");

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const profile = await profileResponse.json<Partial<GoogleProfile>>();
  if (!profileResponse.ok || !profile.sub || !profile.name) throw new Error("google_profile_failed");
  return profile as GoogleProfile;
}

export async function registerGoogleAccount(
  database: D1Database,
  session: PlayerSession,
  profile: GoogleProfile,
): Promise<void> {
  return registerAccount(database, session, profile, "google");
}

async function registerAccount(
  database: D1Database,
  session: PlayerSession,
  profile: GoogleProfile,
  provider: "google" | "developer",
): Promise<void> {
  const existingIdentity = await database.prepare(
    "SELECT account_id FROM account_identities WHERE provider = ? AND provider_subject = ?",
  ).bind(provider, profile.sub).first<{ account_id: string }>();

  if (existingIdentity) {
    const registeredPlayer = await database.prepare(
      "SELECT id FROM players WHERE account_id = ?",
    ).bind(existingIdentity.account_id).first<{ id: string }>();
    if (!registeredPlayer) throw new Error("registered_player_missing");
    const tokenHash = await hashToken(session.token);
    await database.prepare("UPDATE player_sessions SET player_id = ? WHERE token_hash = ?")
      .bind(registeredPlayer.id, tokenHash).run();
    return;
  }

  const player = await database.prepare(
    "SELECT account_id FROM players WHERE id = ?",
  ).bind(session.playerId).first<{ account_id: string | null }>();
  if (player?.account_id) throw new Error("player_already_registered");

  const accountId = crypto.randomUUID();
  await database.batch([
    database.prepare(
      "INSERT INTO accounts (id, display_name, avatar_url) VALUES (?, ?, ?)",
    ).bind(accountId, profile.name, profile.picture ?? null),
    database.prepare(
      `INSERT INTO account_identities (provider, provider_subject, account_id, email)
       VALUES (?, ?, ?, ?)`,
    ).bind(provider, profile.sub, accountId, profile.email ?? null),
    database.prepare(
      "UPDATE players SET account_id = ?, display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(accountId, profile.name, session.playerId),
    database.prepare(
      `INSERT OR IGNORE INTO credit_ledger_entries
        (id, player_id, balance_type, entry_type, amount, reference_id)
       VALUES (?, ?, 'free', 'free_granted', ?, 'account-registration-bonus')`,
    ).bind(`account-registration:${accountId}`, session.playerId, REGISTRATION_BONUS_CREDITS),
  ]);
}

export function isDeveloperAuthAvailable(url: URL, env: GoogleAuthEnv): boolean {
  if (env.DEVELOPER_AUTH_ENABLED !== "true") return false;
  const hostname = url.hostname;
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.startsWith("192.168.")
    || hostname.startsWith("10.")
    || isPrivate172Address(hostname);
}

function isPrivate172Address(hostname: string): boolean {
  const match = hostname.match(/^172\.(\d{1,3})\./);
  if (!match) return false;
  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

export function sanitizeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function readStateCookie(cookieHeader: string | null): { state: string; returnTo: string } | null {
  if (!cookieHeader) return null;
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${OAUTH_STATE_COOKIE}=`));
  if (!cookie) return null;
  try {
    const value = JSON.parse(decodeURIComponent(cookie.slice(OAUTH_STATE_COOKIE.length + 1))) as { state?: string; returnTo?: string };
    if (!value.state) return null;
    return { state: value.state, returnTo: sanitizeReturnPath(value.returnTo ?? null) };
  } catch {
    return null;
  }
}

function oauthStateCookie(value: string, secure: boolean): string {
  return `${OAUTH_STATE_COOKIE}=${value}; Path=/api/platform/auth/google; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`;
}

function createRandomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
