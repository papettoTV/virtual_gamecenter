import { WorkerEntrypoint } from "cloudflare:workers";
import { CabinetRoom as BaseCabinetRoom } from "../worker/cabinet-room";
import { AbuseGuard } from "../worker/abuse-guard";
import { getPlayerConnectionIdentity, handlePlatformRequest } from "../worker/platform";
import { registerGoogleAccount } from "../worker/google-auth";
import { hashIdentifier } from "../worker/identity-hash";
import { getGameDefinition } from "../domain/game";

export { AbuseGuard };
interface DrillEnv extends Env { REVOCATION_DRILL: string; CABINET_ROOMS: DurableObjectNamespace<CabinetRoom> }

function guarded(env: DrillEnv): void {
  if (env.APP_ENV !== "staging" || env.REVOCATION_DRILL !== "synthetic-only-v1") throw Error("drill_guard_failed");
}

function drillMetrics(env: DrillEnv): Pick<AnalyticsEngineDataset, "writeDataPoint"> {
  return { writeDataPoint(point) { if (!point) throw Error("drill_point_required"); env.SECURITY_EVENTS!.writeDataPoint({ ...point, blobs: [...(point.blobs ?? []), "revocation-drill-v1"] }); } };
}

function cabinetGuard(cabinet: string): void {
  if (!/^[a-f0-9-]{36}$/.test(cabinet)) throw Error("drill_cabinet_required");
}

export class CabinetRoom extends BaseCabinetRoom {
  constructor(ctx: DurableObjectState, env: DrillEnv) {
    guarded(env);
    super(ctx, { ...env, SECURITY_EVENTS: drillMetrics(env) });
  }
  async setRpcFault(enabled: boolean): Promise<void> {
    await this.ctx.storage.put("drillRpcFaultUntil", enabled ? Date.now() + 600000 : 0);
  }
  drillConnectionCount(playerId: string, sessionHash: string): number {
    return this.ctx.getWebSockets().filter(socket => {
      const attachment = socket.deserializeAttachment();
      return attachment?.playerId === playerId && attachment?.sessionHash === sessionHash && !attachment.revoked;
    }).length;
  }
  override async revokeSession(playerId: string, sessionHash: string): Promise<void> {
    if ((await this.ctx.storage.get<number>("drillRpcFaultUntil") ?? 0) > Date.now()) throw Error("revocation_drill_rpc_unavailable");
    return super.revokeSession(playerId, sessionHash);
  }
}

export default {
  async fetch(request: Request, env: DrillEnv): Promise<Response> {
    guarded(env);
    const url = new URL(request.url);
    const cabinet = /^\/api\/cabinets\/([^/]+)\/ws$/.exec(url.pathname)?.[1];
    if (!cabinet || request.headers.get("Upgrade") !== "websocket" || !getGameDefinition(url.searchParams.get("gameId"))) return new Response("Not found", { status: 404 });
    cabinetGuard(cabinet);
    if (!await env.DB.prepare("SELECT 1 FROM revocation_drill_cabinets WHERE cabinet_id = ? AND game_id = ?").bind(cabinet, url.searchParams.get("gameId")).first()) return new Response("Not found", { status: 404 });
    const identity = await getPlayerConnectionIdentity(request, env.DB);
    if (identity && !identity.playerId.startsWith("revocation-drill-")) throw Error("synthetic_player_required");
    const admissionId = crypto.randomUUID();
    const decision = await env.ABUSE_GUARDS.getByName("admission").admit(admissionId, cabinet,
      await hashIdentifier("revocation-drill-ip"), identity ? await hashIdentifier(identity.playerId) : undefined);
    if (!decision.success) return new Response("Drill connection limit", { status: 429 });
    const headers = new Headers(request.headers); headers.set("X-Pulbase-Admission", admissionId);
    try {
      const response = await env.CABINET_ROOMS.getByName(cabinet).fetch(new Request(request, { headers }));
      if (response.status !== 101) await env.ABUSE_GUARDS.getByName("admission").release(admissionId, cabinet);
      return response;
    } catch {
      await env.ABUSE_GUARDS.getByName("admission").release(admissionId, cabinet);
      throw Error("drill_connect_failed");
    }
  },
};

export class RevocationOperator extends WorkerEntrypoint<DrillEnv> {
  async prepare(gameId: string) {
    guarded(this.env);
    if (!getGameDefinition(gameId)) throw Error("unknown_drill_game");
    const otherPlayers = await this.env.DB.prepare("SELECT COUNT(*) AS count FROM account_identities WHERE provider_subject NOT LIKE 'revocation-drill-%'").first<{ count: number }>();
    if (otherPlayers?.count !== 0) throw Error("non_synthetic_database");
    const playerId = `revocation-drill-${crypto.randomUUID()}`;
    const tokens = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await this.env.DB.prepare("INSERT INTO players (id, guest_name) VALUES (?, ?)").bind(playerId, playerId).run();
    await this.env.DB.prepare("INSERT INTO credit_wallets (player_id) VALUES (?)").bind(playerId).run();
    for (const token of tokens) await this.env.DB.prepare("INSERT INTO player_sessions (token_hash, player_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))").bind(await hashIdentifier(token), playerId).run();
    await registerGoogleAccount(this.env.DB, { playerId, token: tokens[0]!, secureCookie: false }, { sub: playerId, name: "Synthetic RPC Drill" });
    const cabinet = crypto.randomUUID();
    await this.env.DB.prepare("CREATE TABLE IF NOT EXISTS revocation_drill_cabinets (cabinet_id TEXT PRIMARY KEY, game_id TEXT NOT NULL)").run();
    await this.env.DB.prepare("INSERT INTO revocation_drill_cabinets VALUES (?, ?)").bind(cabinet, gameId).run();
    return { cabinet, cookies: tokens.map(token => `vgc_session=${token}`) };
  }
  async fault(cabinet: string, enabled: boolean) {
    guarded(this.env); cabinetGuard(cabinet);
    if (typeof enabled !== "boolean") throw Error("boolean_required");
    if (!await this.env.DB.prepare("SELECT 1 FROM revocation_drill_cabinets WHERE cabinet_id = ?").bind(cabinet).first()) throw Error("drill_cabinet_required");
    await this.env.CABINET_ROOMS.getByName(cabinet).setRpcFault(enabled);
  }
  async logout(cookie: string) {
    guarded(this.env);
    const request = new Request("http://localhost/api/platform/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    const identity = await getPlayerConnectionIdentity(request, this.env.DB);
    if (!identity?.playerId.startsWith("revocation-drill-")) throw Error("synthetic_session_required");
    const cabinets = await this.env.DB.prepare("SELECT cabinet_id FROM player_cabinets WHERE player_id = ?").bind(identity.playerId).all<{ cabinet_id: string }>();
    const matched = async () => (await Promise.all(cabinets.results.map(row => this.env.CABINET_ROOMS.getByName(row.cabinet_id).drillConnectionCount(identity.playerId, identity.sessionHash)))).reduce((sum, count) => sum + count, 0);
    const before = await matched();
    const response = await handlePlatformRequest(request, this.env.DB, {}, this.env.CABINET_ROOMS, drillMetrics(this.env));
    return { status: response?.status, invalidated: !await getPlayerConnectionIdentity(request, this.env.DB), before, after: await matched() };
  }
  async status(cabinet: string) {
    guarded(this.env); cabinetGuard(cabinet);
    return { room: await this.env.CABINET_ROOMS.getByName(cabinet).recoveryStatus(), admissions: await this.env.ABUSE_GUARDS.getByName("admission").activeConnectionCount() };
  }
  async cleanup(cabinet: string) {
    guarded(this.env); cabinetGuard(cabinet);
    if (!await this.env.DB.prepare("SELECT 1 FROM revocation_drill_cabinets WHERE cabinet_id = ?").bind(cabinet).first()) throw Error("drill_cabinet_required");
    const room = this.env.CABINET_ROOMS.getByName(cabinet);
    await room.setRpcFault(false);
    await room.suspendForRecovery();
  }
  async quiesce() {
    guarded(this.env);
    const rows = await this.env.DB.prepare("SELECT cabinet_id FROM revocation_drill_cabinets LIMIT 51").all<{ cabinet_id: string }>();
    if (rows.results.length > 50) throw Error("drill_inventory_limit");
    for (const row of rows.results) await this.cleanup(row.cabinet_id);
    const guard = this.env.ABUSE_GUARDS.getByName("admission");
    await guard.reconcileConnections();
    const admissions = await guard.activeConnectionCount();
    if (admissions) throw Error("drill_admissions_remaining");
    await guard.suspendMaintenanceAlarm();
    return { cabinetIds: rows.results.map(row => row.cabinet_id), admissions };
  }
}
