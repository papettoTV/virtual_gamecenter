import { WorkerEntrypoint } from "cloudflare:workers";
import { CabinetRoom as PreviousCabinetRoom, RevocationOperator, AbuseGuard } from "./revocation-drill";
import { handlePlatformRequest } from "../worker/platform";
import { hashIdentifier } from "../worker/identity-hash";

export { RevocationOperator, AbuseGuard };
interface DrillEnv extends Env {
  REVOCATION_DRILL: string;
  OPERATION_DRILL: string;
  CABINET_ROOMS: DurableObjectNamespace<CabinetRoom>;
}
type Family = "start" | "login" | "credit";
type Mode = "fail" | "recover";

export function assertOperationDrill(env: { APP_ENV?: string; REVOCATION_DRILL?: string; OPERATION_DRILL?: string }): void {
  if (env.APP_ENV !== "staging" || env.REVOCATION_DRILL !== "synthetic-only-v1" || env.OPERATION_DRILL !== "synthetic-only-v1") throw Error("operation_drill_guard_failed");
}

function metricSink(env: DrillEnv): AnalyticsEngineDataset {
  return { writeDataPoint(point) {
    if (!point || point.blobs?.[2] !== "operation-v1") throw Error("operation_drill_metric_required");
    env.SECURITY_EVENTS!.writeDataPoint({ ...point, blobs: [...point.blobs, "operation-drill-v1"] });
  } };
}

async function fixture(database: D1Database) {
  const playerId = `revocation-drill-operation-${crypto.randomUUID()}`;
  const token = crypto.randomUUID(), device = crypto.randomUUID();
  await database.batch([
    database.prepare("INSERT INTO players (id, guest_name) VALUES (?, ?)").bind(playerId, playerId),
    database.prepare("INSERT INTO credit_wallets (player_id) VALUES (?)").bind(playerId),
    database.prepare("INSERT INTO player_sessions (token_hash, player_id, expires_at) VALUES (?, ?, datetime('now', '+2 hours'))").bind(await hashIdentifier(token), playerId),
  ]);
  const cookie = `vgc_session=${token}; vgc_device=${device}`;
  const api = (path: string, body?: object) => handlePlatformRequest(new Request(`http://localhost/api/platform/${path}`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  }), database, {});
  return { playerId, cookie, api };
}

export class CabinetRoom extends PreviousCabinetRoom {
  private fault: { until: number };
  private originalDatabase: D1Database;
  private drillEnvironment: DrillEnv;
  constructor(ctx: DurableObjectState, env: DrillEnv) {
    assertOperationDrill(env);
    const fault = { until: 0 };
    const database = new Proxy(env.DB, { get(target, key) {
      if (key === "prepare") return (query: string) => target.prepare(fault.until > Date.now() && query.includes("INSERT OR IGNORE INTO credit_reservation_uses")
        ? "SELECT missing_column FROM operation_drill_missing_table" : query);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    super(ctx, { ...env, DB: database, SECURITY_EVENTS: metricSink(env) });
    this.fault = fault; this.originalDatabase = env.DB; this.drillEnvironment = env;
  }
  async operationStart(failing: boolean, cabinet: string) {
    assertOperationDrill(this.drillEnvironment);
    if (typeof failing !== "boolean" || !/^[a-f0-9-]{36}$/.test(cabinet)) throw Error("operation_drill_input");
    const player = await fixture(this.originalDatabase);
    if ((await player.api("welcome-credit"))?.status !== 200) throw Error("operation_drill_fixture");
    const reservation = await player.api("credit-reservations", { cabinetId: cabinet, gameId: "graze-duel", purpose: "solo" });
    if (reservation?.status !== 200) throw Error("operation_drill_reservation");
    const { reservationId } = await reservation.json<{ reservationId: string }>();
    if ((await player.api(`credit-reservations/${reservationId}/capture`))?.status !== 200) throw Error("operation_drill_capture");
    let client: WebSocket | null = null;
    try {
      const response = await this.fetch(new Request(`http://localhost/api/cabinets/${cabinet}/ws?gameId=graze-duel`, { headers: { Upgrade: "websocket", Cookie: player.cookie } }));
      client = response.webSocket;
      if (!client) throw Error("operation_drill_socket");
      client.accept();
      const server = this.ctx.getWebSockets()[0];
      if (!server) throw Error("operation_drill_socket");
      await this.webSocketMessage(server, JSON.stringify({ type: "joinCabinet", gameId: "graze-duel" }));
      this.fault.until = failing ? Date.now() + 60_000 : 0;
      let failed = false;
      try { await this.webSocketMessage(server, JSON.stringify({ type: "startSolo", reservationId })); }
      catch { failed = true; }
      if (failed !== failing) throw Error("operation_drill_unexpected_start");
      return { failed, started: !failed };
    } finally {
      this.fault.until = 0;
      await this.suspendForRecovery();
      client?.close();
    }
  }
}

export class OperationOperator extends WorkerEntrypoint<DrillEnv> {
  async exercise(family: Family, mode: Mode) {
    assertOperationDrill(this.env);
    if (!["start", "login", "credit"].includes(family) || !["fail", "recover"].includes(mode) || (family === "login" && mode === "recover")) throw Error("operation_drill_input");
    const foreign = await this.env.DB.prepare("SELECT COUNT(*) AS count FROM account_identities WHERE provider_subject NOT LIKE 'revocation-drill-%'").first<{ count: number }>();
    if (foreign?.count !== 0) throw Error("operation_drill_non_synthetic_database");
    await this.env.DB.prepare("CREATE TABLE IF NOT EXISTS operation_drill_executions (day TEXT, family TEXT, mode TEXT, status TEXT, completed_at TEXT, PRIMARY KEY(day, family, mode))").run();
    const day = new Date().toISOString().slice(0, 10);
    const inserted = await this.env.DB.prepare("INSERT OR IGNORE INTO operation_drill_executions (day, family, mode, status) VALUES (?, ?, ?, 'running')").bind(day, family, mode).run();
    if (inserted.meta.changes !== 1) throw Error("operation_drill_already_attempted_today");
    const count = mode === "fail" ? 3 : 13;
    for (let attempt = 0; attempt < count; attempt += 1) {
      if (family === "start") {
        const cabinet = crypto.randomUUID();
        await this.env.DB.prepare("INSERT INTO revocation_drill_cabinets (cabinet_id, game_id) VALUES (?, 'graze-duel')").bind(cabinet).run();
        await this.env.CABINET_ROOMS.getByName(cabinet).operationStart(mode === "fail", cabinet);
      } else {
        const player = await fixture(this.env.DB);
        if (family === "login") {
          await this.env.DB.batch(["terms", "privacy"].map(kind => this.env.DB.prepare("INSERT INTO consent_records (id, player_id, policy_type, policy_version) VALUES (?, ?, ?, ?)")
            .bind(crypto.randomUUID(), player.playerId, kind, kind === "terms" ? "2026-10-12.3" : "2026-10-14.1")));
          const state = crypto.randomUUID();
          const cookie = `${player.cookie}; vgc_oauth_state=${encodeURIComponent(JSON.stringify({ state, returnTo: "/" }))}`;
          const response = await handlePlatformRequest(new Request(`http://localhost/api/platform/auth/google/callback?state=${state}&error=temporarily_unavailable`, { headers: { Cookie: cookie } }), this.env.DB, { APP_ENV: "staging", SECURITY_EVENTS: metricSink(this.env) });
          if (response?.status !== 302 || !response.headers.get("Location")?.includes("account=error")) throw Error("operation_drill_login_not_failed");
        } else {
          const database = mode === "fail" ? new Proxy(this.env.DB, { get(target, key) {
            if (key === "batch") return () => target.batch([target.prepare("SELECT missing_column FROM operation_drill_missing_table")]);
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          } }) : this.env.DB;
          let failed = false;
          try {
            const response = await handlePlatformRequest(new Request("http://localhost/api/platform/welcome-credit", { method: "POST", headers: { Cookie: player.cookie } }), database, { APP_ENV: "staging", SECURITY_EVENTS: metricSink(this.env) });
            if (response?.status !== 200) throw Error("operation_drill_credit_response");
          } catch { failed = true; }
          if (failed !== (mode === "fail")) throw Error("operation_drill_unexpected_credit");
          const ledger = await this.env.DB.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE player_id = ?").bind(player.playerId).first<{ count: number }>();
          if (ledger?.count !== (failed ? 0 : 1)) throw Error("operation_drill_credit_atomicity");
        }
      }
    }
    await this.env.DB.prepare("UPDATE operation_drill_executions SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE day = ? AND family = ? AND mode = ?").bind(day, family, mode).run();
    return { family, mode, processed: count, environment: "isolated-staging-drill", loadTest: false, completedAt: new Date().toISOString() };
  }
}

export default { fetch() { return new Response("Not found", { status: 404 }); } };
