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
): Promise<CreditPolicy> {
  const jstOffset = 9 * 60 * 60 * 1000;
  const refillDate = new Date(now.getTime() + jstOffset).toISOString().slice(0, 10);
  const nextRefillAt = new Date(
    Date.parse(`${refillDate}T00:00:00+09:00`) + 24 * 60 * 60 * 1000,
  ).toISOString();
  const claimId = crypto.randomUUID();
  const results = await database.batch<{ amount?: number; used?: number }>([
    database.prepare(
      `INSERT OR IGNORE INTO beta_daily_refills (id, player_id, device_hash, refill_date, amount)
       SELECT ?, wallet.player_id, ?, ?, 3 - wallet.free_balance - wallet.purchased_balance
       FROM credit_wallets AS wallet
       WHERE wallet.player_id = ?
         AND wallet.free_balance + wallet.purchased_balance < 3
         AND (
           EXISTS (SELECT 1 FROM device_benefits
                   WHERE device_hash = ? AND benefit_type = 'welcome-credit')
           OR EXISTS (SELECT 1 FROM credit_ledger_entries
                      WHERE player_id = wallet.player_id AND entry_type = 'free_granted')
         )`,
    ).bind(claimId, deviceHash, refillDate, playerId, deviceHash),
    database.prepare("SELECT amount FROM beta_daily_refills WHERE id = ?").bind(claimId),
    database.prepare(
      `SELECT 1 AS used FROM beta_daily_refills
       WHERE refill_date = ? AND (player_id = ? OR device_hash = ?) LIMIT 1`,
    ).bind(refillDate, playerId, deviceHash),
  ]);
  return {
    purchasesEnabled,
    dailyRefillTarget: 3,
    timeZone: "Asia/Tokyo",
    nextRefillAt,
    refilledToday: results[2]!.results.length > 0,
    refilledAmount: Number(results[1]!.results[0]?.amount ?? 0),
  };
}
