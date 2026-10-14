import { DurableObject } from "cloudflare:workers";

export type BudgetKind = "read" | "write" | "bootstrap" | "benefit" | "auth" | "socket";
export const BUDGET_SHARDS = 16;
export const SHARD_LIMITS: Record<BudgetKind, [number, number]> = {
  read: [120, 2000], write: [60, 1000], bootstrap: [30, 500], benefit: [20, 200], auth: [30, 200], socket: [60, 1000],
};
const ACTOR_LIMITS: Record<BudgetKind, [number, number]> = {
  read: [120, 2000], write: [60, 500], bootstrap: [10, 100], benefit: [10, 20], auth: [10, 100], socket: [30, 500],
};
export const GLOBAL_CONNECTION_LIMIT = 256;
export const GLOBAL_IP_CONNECTION_LIMIT = 16;
export const GLOBAL_PLAYER_CONNECTION_LIMIT = 8;
export const GLOBAL_CABINET_LIMIT = 200;
export interface Decision { success: boolean; retryAfter: number }
type ConnectionRow = { id: string; cabinet: string; created: number };

export class AbuseGuard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS budgets (key TEXT PRIMARY KEY, amount INTEGER NOT NULL, expires INTEGER NOT NULL)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS budget_expiry ON budgets(expires)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, cabinet TEXT NOT NULL, ip TEXT NOT NULL, player TEXT, created INTEGER NOT NULL)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS connection_ip ON connections(ip)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS connection_player ON connections(player)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS cabinets (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)");
  }

  async consume(kind: BudgetKind, ip: string, player?: string, shared = true): Promise<Decision> {
    if (!Object.hasOwn(SHARD_LIMITS, kind) || !this.validKey(ip) || (player && !this.validKey(player))) return { success: false, retryAfter: 60 };
    const now = Date.now();
    const decision = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM budgets WHERE expires <= ?", now);
      const budgets = [...(shared ? ["shared"] : []), ...(player ? [`player:${player}`] : [`ip:${ip}`])].flatMap(actor => {
        const limits = actor === "shared" ? SHARD_LIMITS[kind] : ACTOR_LIMITS[kind];
        return [60_000, 86_400_000].map((period, index) => ({ key: `${kind}:${actor}:${period}:${Math.floor(now / period)}`, limit: limits[index]!, expires: (Math.floor(now / period) + 1) * period }));
      });
      let retryAfter = 0;
      for (const budget of budgets) {
        const amount = this.ctx.storage.sql.exec<{ amount: number }>("SELECT amount FROM budgets WHERE key = ?", budget.key).toArray()[0]?.amount ?? 0;
        if (amount >= budget.limit) retryAfter = Math.max(retryAfter, Math.ceil((budget.expires - now) / 1000));
      }
      if (retryAfter) return { success: false, retryAfter };
      for (const budget of budgets) this.ctx.storage.sql.exec("INSERT INTO budgets VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET amount = amount + 1", budget.key, budget.expires);
      return { success: true, retryAfter: 0 };
    });
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + 300_000);
    return decision;
  }

  async admit(id: string, cabinet: string, ip: string, player?: string): Promise<Decision> {
    if (!/^[a-f0-9-]{36}$/i.test(id) || !/^[a-f0-9-]{36}$/i.test(cabinet) || !this.validKey(ip) || (player && !this.validKey(player))) return { success: false, retryAfter: 60 };
    const now = Date.now();
    const decision = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM cabinets WHERE expires <= ? AND id NOT IN (SELECT cabinet FROM connections)", now);
      const count = (query: string, ...values: string[]) => this.ctx.storage.sql.exec<{ count: number }>(query, ...values).one().count;
      const existing = this.ctx.storage.sql.exec<{ cabinet: string; ip: string; player: string | null }>("SELECT cabinet, ip, player FROM connections WHERE id = ?", id).toArray()[0];
      if (existing) return { success: existing.cabinet === cabinet && existing.ip === ip && existing.player === (player ?? null), retryAfter: 60 };
      if (count("SELECT count(*) AS count FROM connections") >= GLOBAL_CONNECTION_LIMIT
        || count("SELECT count(*) AS count FROM connections WHERE ip = ?", ip) >= GLOBAL_IP_CONNECTION_LIMIT
        || (player && count("SELECT count(*) AS count FROM connections WHERE player = ?", player) >= GLOBAL_PLAYER_CONNECTION_LIMIT)
        || (!count("SELECT count(*) AS count FROM cabinets WHERE id = ?", cabinet) && count("SELECT count(*) AS count FROM cabinets") >= GLOBAL_CABINET_LIMIT)) return { success: false, retryAfter: 60 };
      this.ctx.storage.sql.exec("INSERT INTO cabinets VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET expires = excluded.expires", cabinet, now + 86_400_000);
      this.ctx.storage.sql.exec("INSERT INTO connections VALUES (?, ?, ?, ?, ?)", id, cabinet, ip, player ?? null, now);
      return { success: true, retryAfter: 0 };
    });
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + 300_000);
    return decision;
  }

  release(id: string, cabinet: string): void {
    this.ctx.storage.sql.exec("DELETE FROM connections WHERE id = ? AND cabinet = ?", id, cabinet);
  }

  admissionCount(ip: string): number {
    if (!this.validKey(ip)) return 0;
    return this.ctx.storage.sql.exec<{ count: number }>("SELECT count(*) AS count FROM connections WHERE ip = ?", ip).one().count;
  }

  async alarm(): Promise<void> {
    await this.reconcileConnections();
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM budgets WHERE expires <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM cabinets WHERE expires <= ? AND id NOT IN (SELECT cabinet FROM connections)", now);
    const remaining = this.ctx.storage.sql.exec<{ count: number }>("SELECT (SELECT count(*) FROM budgets) + (SELECT count(*) FROM cabinets) + (SELECT count(*) FROM connections) AS count").one().count;
    if (remaining) await this.ctx.storage.setAlarm(now + 300_000);
  }

  async reconcileConnections(): Promise<void> {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec<ConnectionRow>("SELECT id, cabinet, created FROM connections WHERE created < ?", now - 60_000).toArray();
    for (const cabinet of new Set(rows.map(row => row.cabinet))) {
      try {
        const active = new Set(await this.env.CABINET_ROOMS.getByName(cabinet).activeAdmissionIds());
        for (const row of rows.filter(row => row.cabinet === cabinet)) if (!active.has(row.id)) this.release(row.id, cabinet);
      } catch { }
    }
  }

  private validKey(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
}
