import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verifyMonitoringRecords(records, now = Date.now()) {
  if (!Array.isArray(records) || records.length < 4) throw new Error("正常な自動実行を4回以上確認できません。");
  const latest = [...records].sort((first, second) => second.double12 - first.double12).slice(0, 4);
  const times = latest.map(row => {
    if (row?.blob2 !== "ok" || !Number.isFinite(row.double12) || !Number.isFinite(row.double10) || row.double10 < 0) throw new Error("取得失敗または不正な監視データです。");
    for (let index = 1; index <= 9; index += 1) if (!Number.isFinite(row[`double${index}`]) || row[`double${index}`] < 0) throw new Error("利用量の指標が不足しています。");
    const time = row.double12 * 1000;
    if (Math.abs(time - Math.round(time / 900_000) * 900_000) > 120_000) throw new Error("予定時刻付近の実行を確認できません。");
    return time;
  });
  if (now - times[0] > 35 * 60_000 || times[0] - now > 120_000) throw new Error("最新の監視データが古いか、未来の時刻です。");
  for (let index = 1; index < times.length; index += 1) if (Math.abs(times[index - 1] - times[index] - 900_000) > 120_000) throw new Error("15分間隔の継続実行に欠落・重複があります。");
  return { consecutiveSnapshots: 4, latestAt: new Date(times[0]).toISOString(), highestPercent: latest[0].double10 };
}

async function main() {
  if (existsSync(".dev.vars")) process.loadEnvFile(".dev.vars");
  const token = process.env.CLOUDFLARE_METRICS_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_METRICS_TOKENが必要です。");
  const { experimental_readRawConfig } = await import("wrangler");
  const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
  const accountId = rawConfig.account_id;
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error("監視アカウントIDが不正です。");
  const columns = Array.from({ length: 12 }, (_, index) => `double${index + 1}`).join(", ");
  const query = `SELECT timestamp, blob2, ${columns} FROM events.analyticsEngine.pulbase_account_usage WHERE accountTag = '${accountId}' AND timestamp >= NOW() - INTERVAL '120' MINUTE ORDER BY timestamp DESC LIMIT 4`;
  const response = await fetch("https://api.cloudflare.com/client/v4/analytics/sql", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" }, body: query,
    redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`監視SQLの取得に失敗しました（HTTP ${response.status}）。`);
  const result = await response.json();
  console.log(JSON.stringify(verifyMonitoringRecords(result.data)));
  console.log("読み取り検証のみ。Cron・Worker・DB・通知設定は変更していません。");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error instanceof Error ? error.message : "監視検証に失敗しました。");
  process.exitCode = 1;
});
