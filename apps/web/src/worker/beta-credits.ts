import { observeOperation, type OperationMetrics } from "./operation-metrics";
import { recoverExpiredUnusedCaptures } from "./credit-reservations";

export interface CreditPolicy {
  purchasesEnabled: boolean;
  dailyRefillTarget: 3;
  timeZone: "Asia/Tokyo";
  nextRefillAt: string;
  refilledToday: boolean;
  refilledAmount: number;
}

export async function reconcileBetaCredits(
  database: D1Database,
  playerId: string,
  deviceHash: string,
  purchasesEnabled: boolean,
  now = new Date(),
  metrics?: OperationMetrics,
): Promise<CreditPolicy> {
  const jstOffset = 9 * 60 * 60 * 1000;
  const refillDate = new Date(now.getTime() + jstOffset).toISOString().slice(0, 10);
  const nextRefillAt = new Date(
    Date.parse(`${refillDate}T00:00:00+09:00`) + 24 * 60 * 60 * 1000,
  ).toISOString();
  const claimId = crypto.randomUUID();
  const results = await observeOperation(metrics, "daily_credit", async () => {
    await recoverExpiredUnusedCaptures(database, playerId);
    return database.batch<{ amount?: number; used?: number }>([
    database.prepare(
      `INSERT OR IGNORE INTO beta_daily_refills (id, player_id, device_hash, refill_date, amount)
       SELECT ?, wallet.player_id, ?, ?, 3 - wallet.free_balance - wallet.purchased_balance
       FROM credit_wallets AS wallet
       WHERE wallet.player_id = ?
         AND wallet.free_balance + wallet.purchased_balance < 3
         AND NOT EXISTS (SELECT 1 FROM retained_daily_refills
           WHERE refill_date = ? AND (device_hash = ? OR registration_hash = (SELECT registration_hash FROM player_benefits WHERE player_id = wallet.player_id)))
         AND (
           EXISTS (SELECT 1 FROM player_benefits WHERE player_id = wallet.player_id AND refill_eligible = 1)
           OR
           EXISTS (SELECT 1 FROM device_benefits
                   WHERE device_hash = ? AND benefit_type = 'welcome-credit')
           OR EXISTS (SELECT 1 FROM credit_ledger_entries
                      WHERE player_id = wallet.player_id AND entry_type = 'free_granted')
         )`,
    ).bind(claimId, deviceHash, refillDate, playerId, refillDate, deviceHash, deviceHash),
    database.prepare("SELECT amount FROM beta_daily_refills WHERE id = ?").bind(claimId),
    database.prepare(
      `SELECT 1 AS used FROM beta_daily_refills
       WHERE refill_date = ? AND (player_id = ? OR device_hash = ?)
       UNION ALL SELECT 1 FROM retained_daily_refills WHERE refill_date = ? AND (device_hash = ? OR registration_hash = (SELECT registration_hash FROM player_benefits WHERE player_id = ?)) LIMIT 1`,
    ).bind(refillDate, playerId, deviceHash, refillDate, deviceHash, playerId),
    ]);
  }, values => Number(values[1]!.results[0]?.amount ?? 0) > 0 ? "success" : "noop");
  return {
    purchasesEnabled,
    dailyRefillTarget: 3,
    timeZone: "Asia/Tokyo",
    nextRefillAt,
    refilledToday: results[2]!.results.length > 0,
    refilledAmount: Number(results[1]!.results[0]?.amount ?? 0),
  };
}
