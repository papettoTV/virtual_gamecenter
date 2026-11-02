import { getPlayerIdentity } from "./platform";
import { hashIdentifier, registrationClaim } from "./identity-hash";
export { hashIdentifier } from "./identity-hash";

export interface LifecycleRooms {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { removePlayerData(playerId: string): Promise<void>; expireIdleData(cabinetId?: string): Promise<void> };
}

interface DeletionJob {
  id: string;
  player_id: string | null;
  scope: "all" | "public";
  status: string;
}

function sessionToken(request: Request): string {
  return /(?:^|;\s*)vgc_session=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1] ?? "";
}

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleDataLifecycleRequest(request: Request, database: D1Database, rooms: LifecycleRooms, audit?: R2Bucket): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/platform/data-deletion")) return null;
  const receiptMatch = /^\/api\/platform\/data-deletion\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (receiptMatch && request.method === "GET") {
    const receipt = request.headers.get("X-Deletion-Receipt");
    if (!receipt) return response({ error: "receipt_required" }, 401);
    const job = await database.prepare("SELECT status, scope, requested_at, completed_at FROM data_deletions WHERE id = ? AND receipt_hash = ? AND expires_at > CURRENT_TIMESTAMP")
      .bind(receiptMatch[1], await hashIdentifier(receipt)).first();
    return job ? response(job) : response({ error: "receipt_not_found" }, 404);
  }
  const identity = await getPlayerIdentity(request, database);
  if (!identity) return response({ error: "player_session_required" }, 401);
  const sessionHash = await hashIdentifier(sessionToken(request));
  if (url.pathname.endsWith("/preview") && request.method === "GET") {
    const scope = url.searchParams.get("scope") === "public" ? "public" : "all";
    const verified = await database.prepare("SELECT 1 FROM verified_sessions WHERE token_hash = ? AND player_id = ? AND verified_at >= datetime('now', '-10 minutes')")
      .bind(sessionHash, identity.playerId).first();
    const wallet = await database.prepare("SELECT free_balance, purchased_balance FROM credit_wallets WHERE player_id = ?").bind(identity.playerId).first();
    const token = crypto.randomUUID();
    await database.prepare("INSERT INTO deletion_confirmations (token_hash, session_hash, player_id, scope, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+10 minutes'))")
      .bind(await hashIdentifier(token), sessionHash, identity.playerId, scope).run();
    return response({ playerName: identity.playerName, accountRegistered: identity.accountRegistered, wallet, scope, confirmationToken: token, reauthRequired: identity.accountRegistered && !verified });
  }
  if (url.pathname.endsWith("/request") && request.method === "POST") {
    if (request.headers.get("Origin") !== url.origin) return response({ error: "invalid_origin" }, 403);
    if (!audit) return response({ error: "deletion_audit_unavailable" }, 503);
    let body: { confirmationToken?: string };
    try {
      const text = await request.text();
      if (text.length > 1024) return response({ error: "invalid_request" }, 400);
      body = JSON.parse(text);
    } catch { return response({ error: "invalid_request" }, 400); }
    if (typeof body?.confirmationToken !== "string") return response({ error: "confirmation_required" }, 400);
    const confirmation = await database.prepare("SELECT scope FROM deletion_confirmations WHERE token_hash = ? AND session_hash = ? AND player_id = ? AND expires_at > CURRENT_TIMESTAMP")
      .bind(await hashIdentifier(body.confirmationToken), sessionHash, identity.playerId).first<{ scope: "all" | "public" }>();
    if (!confirmation) return response({ error: "confirmation_expired" }, 409);
    const verified = await database.prepare("SELECT 1 FROM verified_sessions WHERE token_hash = ? AND player_id = ? AND verified_at >= datetime('now', '-10 minutes')")
      .bind(sessionHash, identity.playerId).first();
    if (identity.accountRegistered && !verified) return response({ error: "reauth_required" }, 403);
    const paid = await database.prepare("SELECT 1 FROM credit_wallets WHERE player_id = ? AND purchased_balance > 0 UNION ALL SELECT 1 FROM credit_purchases WHERE player_id = ? AND status IN ('pending', 'paid') LIMIT 1")
      .bind(identity.playerId, identity.playerId).first();
    if (confirmation.scope === "all" && paid) return response({ error: "purchase_support_required" }, 409);
    const id = crypto.randomUUID();
    const receipt = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 365 * 86400000).toISOString();
    try {
      await audit.put(`deletions/${id}.json`, JSON.stringify({ id, playerId: identity.playerId, scope: confirmation.scope, receiptHash: await hashIdentifier(receipt), expiresAt, accepted: false }));
    } catch { return response({ error: "deletion_audit_unavailable" }, 503); }
    const statements = [
      database.prepare("INSERT INTO data_deletions (id, player_id, receipt_hash, scope, account_id, expires_at) SELECT ?, ?, ?, ?, (SELECT account_id FROM players WHERE id = ?), datetime('now', '+1 year') WHERE EXISTS (SELECT 1 FROM deletion_confirmations WHERE token_hash = ? AND session_hash = ? AND expires_at > CURRENT_TIMESTAMP) AND (? = 'public' OR (NOT EXISTS (SELECT 1 FROM credit_wallets WHERE player_id = ? AND purchased_balance > 0) AND NOT EXISTS (SELECT 1 FROM credit_purchases WHERE player_id = ? AND status IN ('pending', 'paid'))))")
        .bind(id, identity.playerId, await hashIdentifier(receipt), confirmation.scope, identity.playerId, await hashIdentifier(body.confirmationToken), sessionHash, confirmation.scope, identity.playerId, identity.playerId),
      database.prepare("DELETE FROM deletion_confirmations WHERE token_hash = ?").bind(await hashIdentifier(body.confirmationToken)),
    ];
    if (confirmation.scope === "all") statements.push(
      database.prepare("UPDATE players SET deletion_requested_at = CURRENT_TIMESTAMP WHERE id = ? AND EXISTS (SELECT 1 FROM data_deletions WHERE id = ?)").bind(identity.playerId, id),
      database.prepare("DELETE FROM player_sessions WHERE player_id = ? AND EXISTS (SELECT 1 FROM data_deletions WHERE id = ?)").bind(identity.playerId, id),
    );
    const created = await database.batch(statements);
    if (!created[0]!.meta.changes) {
      await audit.delete(`deletions/${id}.json`);
      return response({ error: "confirmation_expired" }, 409);
    }
    try { await processDeletion(database, rooms, { id, player_id: identity.playerId, scope: confirmation.scope, status: "pending" }, audit); }
    catch { }
    const job = await database.prepare("SELECT status FROM data_deletions WHERE id = ?").bind(id).first<{ status: string }>();
    const result = response({ id, receipt, scope: confirmation.scope, status: job?.status ?? "pending" }, job?.status === "completed" ? 200 : 202);
    if (confirmation.scope === "all") result.headers.append("Set-Cookie", `vgc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${url.protocol === "https:" ? "; Secure" : ""}`);
    return result;
  }
  return response({ error: "method_not_allowed" }, 405);
}

export async function processDeletion(database: D1Database, rooms: LifecycleRooms, job: DeletionJob, audit?: R2Bucket): Promise<void> {
  if (!job.player_id || job.status === "completed") return;
  if (!audit) throw new Error("deletion_audit_unavailable");
  const playerId = job.player_id;
  const existingJob = await database.prepare("SELECT receipt_hash, expires_at, status FROM data_deletions WHERE id = ?").bind(job.id).first<{ receipt_hash: string; expires_at: string; status: string }>();
  if (!existingJob || existingJob.status === "completed") return;
  await audit.put(`deletions/${job.id}.json`, JSON.stringify({ id: job.id, playerId, scope: job.scope, receiptHash: existingJob.receipt_hash, expiresAt: existingJob.expires_at, accepted: true }));
  if (job.scope === "all") {
    const identities = await database.prepare("SELECT provider, provider_subject, created_at FROM account_identities WHERE account_id = (SELECT account_id FROM players WHERE id = ?)")
      .bind(playerId).all<{ provider: string; provider_subject: string; created_at: string }>();
    for (const identity of identities.results) {
      await database.prepare("INSERT OR IGNORE INTO retained_benefits (claim_hash, benefit_type, granted_at, expires_at) VALUES (?, 'registration', ?, datetime(?, '+5 years'))")
        .bind(await registrationClaim(identity.provider, identity.provider_subject), identity.created_at, identity.created_at).run();
      await database.prepare("UPDATE retained_benefits SET grant_id = NULL WHERE claim_hash = ? AND benefit_type = 'registration'").bind(await registrationClaim(identity.provider, identity.provider_subject)).run();
      await database.prepare("INSERT OR IGNORE INTO retained_daily_refills (device_hash, registration_hash, refill_date) SELECT device_hash, ?, refill_date FROM beta_daily_refills WHERE player_id = ?")
        .bind(await registrationClaim(identity.provider, identity.provider_subject), playerId).run();
    }
    const cabinets = await database.prepare("SELECT cabinet_id FROM player_cabinets WHERE player_id = ?").bind(playerId).all<{ cabinet_id: string }>();
    for (const cabinet of cabinets.results) await rooms.get(rooms.idFromName(cabinet.cabinet_id)).removePlayerData(playerId);
  }
  const statements = [
    database.prepare("DELETE FROM sharing_events WHERE target_id IN (SELECT id FROM shared_results WHERE owner_id = ?)").bind(playerId),
    database.prepare("DELETE FROM rankings WHERE owner_id = ?").bind(playerId),
    database.prepare("DELETE FROM shared_results WHERE owner_id = ?").bind(playerId),
    database.prepare("DELETE FROM game_results WHERE player_id = ?").bind(playerId),
  ];
  if (job.scope === "all") statements.push(
    database.prepare("INSERT OR IGNORE INTO deletion_evidence (request_id, policy_type, policy_version, accepted_at, expires_at) SELECT ?, policy_type, policy_version, accepted_at, datetime('now', '+1 year') FROM consent_records WHERE player_id = ?").bind(job.id, playerId),
    database.prepare("INSERT OR IGNORE INTO retained_benefits (claim_hash, benefit_type, granted_at, expires_at) SELECT device_hash, benefit_type, granted_at, datetime(granted_at, '+5 years') FROM device_benefits WHERE player_id = ?").bind(playerId),
    database.prepare("INSERT OR IGNORE INTO retained_daily_refills (device_hash, registration_hash, refill_date) SELECT device_hash, NULL, refill_date FROM beta_daily_refills WHERE player_id = ?").bind(playerId),
    database.prepare("DELETE FROM live_engagement_events WHERE player_id = ?").bind(playerId),
    database.prepare("DELETE FROM sharing_events WHERE actor_id = ?").bind(playerId),
    ...["credit_transactions", "credit_reservations", "credit_ledger_entries", "credit_accounts", "credit_wallets", "beta_daily_refills", "device_benefits", "consent_records", "player_benefits", "verified_sessions", "deletion_confirmations", "player_cabinets", "player_sessions", "credit_purchases"].map(table => database.prepare(`DELETE FROM ${table} WHERE player_id = ?`).bind(playerId)),
    database.prepare("UPDATE play_sessions SET host_player_id = NULL, status = 'ended', ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP) WHERE host_player_id = ?").bind(playerId),
    database.prepare("UPDATE play_sessions SET guest_player_id = NULL WHERE guest_player_id = ?").bind(playerId),
    database.prepare("DELETE FROM account_identities WHERE account_id = (SELECT account_id FROM players WHERE id = ?)").bind(playerId),
    database.prepare("UPDATE players SET display_name = NULL, guest_name = NULL, account_id = NULL WHERE id = ?").bind(playerId),
    database.prepare("DELETE FROM accounts WHERE id = (SELECT account_id FROM data_deletions WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM players WHERE account_id = accounts.id)").bind(job.id),
    database.prepare("DELETE FROM players WHERE id = ?").bind(playerId),
  );
  statements.push(database.prepare("UPDATE data_deletions SET status = 'completed', completed_at = CURRENT_TIMESTAMP, player_id = NULL, account_id = NULL WHERE id = ? AND status = 'pending'").bind(job.id));
  await database.batch(statements);
}

export async function replayDeletionAudit(database: D1Database, rooms: LifecycleRooms, audit: R2Bucket): Promise<number> {
  let cursor: string | undefined;
  let failures = 0;
  do {
    const listed = await audit.list({ prefix: "deletions/", cursor, limit: 100 });
    for (const object of listed.objects) {
      const stored = await audit.get(object.key);
      if (!stored) continue;
      const manifest = await stored.json<{ id: string; playerId: string; scope: "all" | "public"; receiptHash: string; expiresAt: string; accepted: boolean }>();
      if (new Date(manifest.expiresAt).getTime() <= Date.now()) { await audit.delete(object.key); continue; }
      if (!manifest.accepted) {
        if (object.uploaded.getTime() < Date.now() - 86400000 && !await database.prepare("SELECT 1 FROM data_deletions WHERE id = ?").bind(manifest.id).first()) await audit.delete(object.key);
        continue;
      }
      const job = await database.prepare("SELECT status FROM data_deletions WHERE id = ?").bind(manifest.id).first<{ status: string }>();
      if (job?.status === "completed") continue;
      await database.batch([
        database.prepare("INSERT INTO data_deletions (id, player_id, account_id, receipt_hash, scope, expires_at) VALUES (?, ?, (SELECT account_id FROM players WHERE id = ?), ?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(manifest.id, manifest.playerId, manifest.playerId, manifest.receiptHash, manifest.scope, manifest.expiresAt),
        ...(manifest.scope === "all" ? [database.prepare("UPDATE players SET deletion_requested_at = CURRENT_TIMESTAMP WHERE id = ?").bind(manifest.playerId), database.prepare("DELETE FROM player_sessions WHERE player_id = ?").bind(manifest.playerId)] : []),
      ]);
      try { await processDeletion(database, rooms, { id: manifest.id, player_id: manifest.playerId, scope: manifest.scope, status: "pending" }, audit); }
      catch { failures += 1; }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return failures;
}

export async function runRetention(database: D1Database, rooms: LifecycleRooms, audit?: R2Bucket): Promise<void> {
  if (!audit) throw new Error("deletion_audit_unavailable");
  let failures = await replayDeletionAudit(database, rooms, audit);
  const pending = await database.prepare("SELECT id, player_id, scope, status FROM data_deletions WHERE status = 'pending' LIMIT 100").all<DeletionJob>();
  for (const job of pending.results) {
    try { await processDeletion(database, rooms, job, audit); }
    catch { failures += 1; }
  }
  const inactive = await database.prepare("SELECT p.id FROM players p WHERE p.account_id IS NULL AND p.deletion_requested_at IS NULL AND p.created_at < datetime('now', '-1 year') AND NOT EXISTS (SELECT 1 FROM player_sessions WHERE player_id = p.id AND last_seen_at >= datetime('now', '-1 year')) AND NOT EXISTS (SELECT 1 FROM credit_purchases WHERE player_id = p.id) AND NOT EXISTS (SELECT 1 FROM credit_wallets WHERE player_id = p.id AND purchased_balance > 0) LIMIT 100").all<{ id: string }>();
  for (const player of inactive.results) {
    const id = crypto.randomUUID();
    await database.batch([
      database.prepare("INSERT INTO data_deletions (id, player_id, receipt_hash, scope, expires_at) VALUES (?, ?, ?, 'all', datetime('now', '+1 year'))").bind(id, player.id, await hashIdentifier(crypto.randomUUID())),
      database.prepare("UPDATE players SET deletion_requested_at = CURRENT_TIMESTAMP WHERE id = ?").bind(player.id),
      database.prepare("DELETE FROM player_sessions WHERE player_id = ?").bind(player.id),
    ]);
    try { await processDeletion(database, rooms, { id, player_id: player.id, scope: "all", status: "pending" }, audit); }
    catch { failures += 1; }
  }
  const idle = await database.prepare("SELECT cabinet_id FROM cabinet_directory WHERE updated_at < ? LIMIT 100").bind(Date.now() - 86400000).all<{ cabinet_id: string }>();
  for (const cabinet of idle.results) await rooms.get(rooms.idFromName(cabinet.cabinet_id)).expireIdleData(cabinet.cabinet_id);
  await database.batch([
    database.prepare("INSERT OR IGNORE INTO game_retirements (game_id, retired_at) SELECT id, CURRENT_TIMESTAMP FROM games WHERE status <> 'active'"),
    database.prepare("DELETE FROM game_retirements WHERE game_id IN (SELECT id FROM games WHERE status = 'active')"),
    database.prepare("DELETE FROM player_sessions WHERE expires_at <= CURRENT_TIMESTAMP"),
    database.prepare("UPDATE credit_reservations SET status = 'expired' WHERE status = 'active' AND expires_at <= CURRENT_TIMESTAMP"),
    database.prepare("DELETE FROM verified_sessions WHERE verified_at < datetime('now', '-10 minutes')"),
    database.prepare("DELETE FROM deletion_confirmations WHERE expires_at <= CURRENT_TIMESTAMP"),
    database.prepare("DELETE FROM beta_daily_refills WHERE refill_date < date('now', '+9 hours', '-90 days')"),
    database.prepare("DELETE FROM retained_benefits WHERE expires_at <= CURRENT_TIMESTAMP"),
    database.prepare("DELETE FROM device_benefits WHERE granted_at < datetime('now', '-5 years')"),
    database.prepare("DELETE FROM retained_daily_refills WHERE refill_date < date('now', '+9 hours', '-90 days')"),
    database.prepare("DELETE FROM deletion_evidence WHERE expires_at <= CURRENT_TIMESTAMP"),
    database.prepare("DELETE FROM data_deletions WHERE status = 'completed' AND expires_at <= CURRENT_TIMESTAMP"),
    database.prepare("DELETE FROM live_engagement_events WHERE created_at < datetime('now', '-90 days')"),
    database.prepare("DELETE FROM sharing_events WHERE created_at < datetime('now', '-90 days')"),
    database.prepare("DELETE FROM feedback WHERE created_at < datetime('now', '-90 days')"),
    database.prepare("DELETE FROM feedback_rate_buckets WHERE expires_at <= CURRENT_TIMESTAMP"),
    database.prepare("DELETE FROM credit_reservations WHERE status <> 'active' AND created_at < datetime('now', '-1 year') AND NOT EXISTS (SELECT 1 FROM credit_purchases WHERE player_id = credit_reservations.player_id)"),
    database.prepare("DELETE FROM credit_ledger_entries WHERE balance_type = 'free' AND created_at < datetime('now', '-1 year') AND NOT EXISTS (SELECT 1 FROM credit_purchases WHERE player_id = credit_ledger_entries.player_id)"),
    database.prepare("DELETE FROM credit_transactions WHERE created_at < datetime('now', '-1 year') AND NOT EXISTS (SELECT 1 FROM credit_purchases WHERE player_id = credit_transactions.player_id)"),
    database.prepare("UPDATE play_sessions SET status = 'ended', ended_at = created_at WHERE ended_at IS NULL AND created_at < datetime('now', '-1 year') AND NOT EXISTS (SELECT 1 FROM cabinet_directory WHERE cabinet_id = play_sessions.cabinet_id) AND NOT EXISTS (SELECT 1 FROM credit_reservations WHERE play_session_id = play_sessions.id AND status = 'active') AND NOT EXISTS (SELECT 1 FROM credit_purchases WHERE player_id = play_sessions.host_player_id OR player_id = play_sessions.guest_player_id)"),
    database.prepare("UPDATE game_results SET play_session_id = NULL WHERE play_session_id IN (SELECT id FROM play_sessions WHERE ended_at < datetime('now', '-1 year')) AND NOT EXISTS (SELECT 1 FROM credit_purchases WHERE player_id = game_results.player_id)"),
    database.prepare("UPDATE play_sessions SET host_player_id = NULL, guest_player_id = NULL WHERE ended_at < datetime('now', '-1 year')"),
    database.prepare("DELETE FROM play_sessions WHERE ended_at < datetime('now', '-1 year') AND NOT EXISTS (SELECT 1 FROM credit_reservations WHERE play_session_id = play_sessions.id) AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries WHERE play_session_id = play_sessions.id) AND NOT EXISTS (SELECT 1 FROM credit_transactions WHERE play_session_id = play_sessions.id) AND NOT EXISTS (SELECT 1 FROM game_results WHERE play_session_id = play_sessions.id)"),
    database.prepare("DELETE FROM rankings WHERE game_id IN (SELECT game_id FROM game_retirements WHERE retired_at < datetime('now', '-1 year'))"),
    database.prepare("DELETE FROM shared_results WHERE game_id IN (SELECT game_id FROM game_retirements WHERE retired_at < datetime('now', '-1 year'))"),
    database.prepare("DELETE FROM game_results WHERE game_id IN (SELECT game_id FROM game_retirements WHERE retired_at < datetime('now', '-1 year'))"),
  ]);
  if (failures) throw new Error(`data_deletion_retries_failed:${failures}`);
}
