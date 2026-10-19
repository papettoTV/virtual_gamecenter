import { DurableObject } from "cloudflare:workers";
import type { CabinetRoom } from "./cabinet-room";
import { BUDGET_SHARDS, type AbuseGuard } from "./abuse-guard";
import { replayDeletionAudit } from "./data-lifecycle";

interface RecoveryEnvironment {
  DB: D1Database;
  DELETION_AUDIT: R2Bucket;
  CABINET_ROOMS: DurableObjectNamespace<CabinetRoom>;
  ABUSE_GUARDS: DurableObjectNamespace<AbuseGuard>;
}

interface RecoveryState { mode: "stopped" | "ready" | "open"; cabinetIds: string[] }
type RecoveryResult = RecoveryState & { error?: string };
export interface RecoveryBinding { getByName(name: string): { isOpen(): Promise<boolean> } }

export function recoveryResponse(request: Request): Response {
  const headers = { "Cache-Control": "no-store", "Retry-After": "300" };
  if (new URL(request.url).pathname.startsWith("/api/")) return Response.json({ error: "service_maintenance" }, { status: 503, headers });
  return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><title>メンテナンス中 | PULBASE</title><h1>ただいまメンテナンス中です</h1><p>復旧確認が終わるまで、プレイ・観戦を一時停止しています。</p></html>', { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

export class RecoveryControl extends DurableObject<RecoveryEnvironment> {
  private state: RecoveryState = { mode: "stopped", cabinetIds: [] };
  private readonly ready: Promise<void>;
  constructor(context: DurableObjectState, env: RecoveryEnvironment) {
    super(context, env);
    this.ready = context.blockConcurrencyWhile(async () => {
      const stored = await context.storage.get<RecoveryState>("recovery");
      if (stored) this.state = stored;
    });
  }

  async isOpen(): Promise<boolean> { await this.ready; return this.state.mode === "open"; }
  async status(): Promise<RecoveryState> { await this.ready; return structuredClone(this.state); }

  private async transition(operation: () => Promise<RecoveryState>): Promise<RecoveryResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await operation(); }
      catch (error) {
        const message = error instanceof Error ? error.message : "";
        const known = ["recovery_admissions_remaining", "recovery_data_not_ready", "recovery_deletion_failed", "recovery_room_not_empty"];
        return { ...structuredClone(this.state), error: known.includes(message) ? message : "recovery_operation_failed" };
      }
    });
  }

  async stop(): Promise<RecoveryResult> {
    await this.ready;
    return this.transition(async () => {
      this.state.mode = "stopped";
      await this.ctx.storage.put("recovery", this.state);
      const rows = await this.env.DB.prepare("SELECT cabinet_id FROM cabinet_directory UNION SELECT cabinet_id FROM player_cabinets").all<{ cabinet_id: string }>();
      this.state.cabinetIds = [...new Set([...this.state.cabinetIds, ...rows.results.map(row => row.cabinet_id)])]
        .filter(id => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id));
      await this.ctx.storage.put("recovery", this.state);
      for (const cabinetId of this.state.cabinetIds) await this.env.CABINET_ROOMS.getByName(cabinetId).suspendForRecovery();
      if (await this.env.ABUSE_GUARDS.getByName("admission").activeConnectionCount()) throw Error("recovery_admissions_remaining");
      await this.env.ABUSE_GUARDS.getByName("admission").suspendMaintenanceAlarm();
      for (let index = 0; index < BUDGET_SHARDS; index += 1) await this.env.ABUSE_GUARDS.getByName(`budget:${index}`).suspendMaintenanceAlarm();
      return this.status();
    });
  }

  private async verifyData(): Promise<void> {
    const pending = await this.env.DB.prepare("SELECT COUNT(*) AS count FROM data_deletions WHERE status != 'completed'").first<{ count: number }>();
    const sessions = await this.env.DB.prepare("SELECT COUNT(*) AS count FROM player_sessions").first<{ count: number }>();
    const mismatches = await this.env.DB.prepare(`SELECT COUNT(*) AS count FROM credit_wallets w WHERE
      w.free_balance != COALESCE((SELECT SUM(amount) FROM credit_ledger_entries WHERE player_id = w.player_id AND balance_type = 'free'), 0)
      OR w.purchased_balance != COALESCE((SELECT SUM(amount) FROM credit_ledger_entries WHERE player_id = w.player_id AND balance_type = 'purchased'), 0)`).first<{ count: number }>();
    if (!pending || !sessions || !mismatches || pending.count || sessions.count || mismatches.count) throw Error("recovery_data_not_ready");
    if (await this.env.ABUSE_GUARDS.getByName("admission").activeConnectionCount()) throw Error("recovery_admissions_remaining");
  }

  async reconcile(): Promise<RecoveryResult> {
    await this.ready;
    if (this.state.mode !== "stopped") return { ...await this.status(), error: "recovery_not_stopped" };
    return this.transition(async () => {
      if (await replayDeletionAudit(this.env.DB, this.env.CABINET_ROOMS, this.env.DELETION_AUDIT)) throw Error("recovery_deletion_failed");
      await this.env.DB.batch([
        ...["player_sessions", "verified_sessions", "deletion_confirmations"].map(table => this.env.DB.prepare(`DELETE FROM ${table}`)),
        this.env.DB.prepare("UPDATE credit_reservations SET status = 'released', updated_at = CURRENT_TIMESTAMP WHERE status = 'active'"),
        this.env.DB.prepare("UPDATE play_sessions SET status = 'ended', ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP) WHERE status != 'ended'"),
      ]);
      for (const cabinetId of this.state.cabinetIds) await this.env.CABINET_ROOMS.getByName(cabinetId).resetAfterRecovery();
      await this.verifyData();
      const next = { ...this.state, mode: "ready" as const };
      await this.ctx.storage.put("recovery", next);
      this.state = next;
      return this.status();
    });
  }

  async resume(): Promise<RecoveryResult> {
    await this.ready;
    if (this.state.mode !== "ready") return { ...await this.status(), error: "recovery_not_ready" };
    return this.transition(async () => {
      await this.verifyData();
      for (const cabinetId of this.state.cabinetIds) await this.env.CABINET_ROOMS.getByName(cabinetId).resumeAfterRecovery();
      const next = { ...this.state, mode: "open" as const };
      await this.ctx.storage.put("recovery", next);
      this.state = next;
      return this.status();
    });
  }
}
