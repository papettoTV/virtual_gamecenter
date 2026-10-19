import { WorkerEntrypoint } from "cloudflare:workers";
import app, { CabinetRoom, AbuseGuard } from "../worker/index";
import { RecoveryControl } from "../worker/recovery-control";
import { hashIdentifier, processDeletion } from "../worker/data-lifecycle";

export { CabinetRoom, AbuseGuard, RecoveryControl };

interface DrillEnvironment extends Env {
  RECOVERY_DRILL: string;
  RECOVERY_CONTROL: DurableObjectNamespace<RecoveryControl>;
  ASSETS: Fetcher;
}

export default {
  fetch(request: Request, env: DrillEnvironment) {
    if (env.RECOVERY_DRILL !== "true") return new Response("Forbidden", { status: 403 });
    return app.fetch(request, env);
  },
};

export class RecoveryOperator extends WorkerEntrypoint<DrillEnvironment> {
  private control() {
    if (this.env.RECOVERY_DRILL !== "true") throw Error("not_a_recovery_drill");
    return this.env.RECOVERY_CONTROL.getByName("global");
  }
  async status() { return this.control().status(); }
  async stop() { return this.control().stop(); }
  async reconcile() { return this.control().reconcile(); }
  async resume() { return this.control().resume(); }
  async deleteFixture() {
    if ((await this.control().status()).mode !== "stopped") throw Error("drill_not_stopped");
    const guard = await this.env.DB.prepare("SELECT version FROM recovery_drill_guard").first<{ version: string }>();
    if (guard?.version !== "synthetic-only-v1") throw Error("not_a_drill_fixture");
    const id = "00000000-0000-4000-8000-000000000001";
    const playerId = "recovery-drill-deleted";
    await this.env.DB.prepare("INSERT INTO data_deletions (id, player_id, receipt_hash, scope, expires_at) VALUES (?, ?, ?, 'all', datetime('now', '+1 year'))").bind(id, playerId, await hashIdentifier("synthetic-receipt")).run();
    await processDeletion(this.env.DB, this.env.CABINET_ROOMS, { id, player_id: playerId, scope: "all", status: "pending" }, this.env.DELETION_AUDIT);
    return { deleted: !await this.env.DB.prepare("SELECT 1 FROM players WHERE id = ?").bind(playerId).first() };
  }
  async rooms() {
    const state = await this.control().status();
    const rooms = [];
    for (const id of state.cabinetIds) rooms.push({ id, ...await this.env.CABINET_ROOMS.getByName(id).recoveryStatus() });
    return { mode: state.mode, rooms, admissions: await this.env.ABUSE_GUARDS.getByName("admission").activeConnectionCount() };
  }
}
