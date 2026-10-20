import { hashIdentifier } from "./identity-hash";
import { operationReportQuery, summarizeOperations, monthlyOperationReportQuery, operationMonthWindow, summarizeMonthlyOperations } from "../shared/operation-report.mjs";

export interface OperatorEnv {
  APP_ENV?: string;
  OPERATOR_ACCOUNT_IDS?: string;
  CLOUDFLARE_METRICS_TOKEN?: string;
  DB: D1Database;
}

const dashboardPath = "/operator/operations";
const apiPath = "/api/operator/operations";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

async function collectRows(token: string, query: string, fetcher: typeof fetch) {
  if (!token) throw Error("metrics_unavailable");
  const response = await fetcher("https://api.cloudflare.com/client/v4/analytics/sql", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: query, redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Error("metrics_unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw Error("metrics_unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 64 * 1024) { await reader.cancel(); throw Error("metrics_unavailable"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (payload.success === false || payload.errors?.length) throw Error("metrics_unavailable");
  return payload.data;
}

export async function collectOperationReport(token: string, fetcher: typeof fetch = fetch) {
  const rows = await collectRows(token, operationReportQuery(), fetcher);
  return { checkedAt: new Date().toISOString(), environment: "staging", windowMinutes: 20,
    countsAreEstimates: true, families: summarizeOperations(rows) };
}

export async function collectMonthlyOperationReport(token: string, fetcher: typeof fetch = fetch, now = new Date()) {
  const rows = await collectRows(token, monthlyOperationReportQuery(now), fetcher);
  return { checkedAt: now.toISOString(), environment: "staging", window: operationMonthWindow(now),
    provisional: true, countsAreEstimates: true, measurementBoundary: "server_operation_only",
    families: summarizeMonthlyOperations(rows) };
}

export async function handleOperatorRequest(request: Request, env: OperatorEnv, fetcher: typeof fetch = fetch): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== dashboardPath && url.pathname !== apiPath) return null;
  const api = url.pathname === apiPath;
  const error = (status: number, message: string) => api
    ? Response.json({ error: message }, { status, headers })
    : page(`<h1>運営者専用</h1><p role="alert">${message}</p><p><a href="/">サイトに戻る</a> · Googleログイン後、この画面を開き直してください。</p>`, status);
  if (env.APP_ENV !== "staging") return error(404, "この環境では利用できません。");
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
  const topLevelNavigation = !api && request.headers.get("Sec-Fetch-Mode") === "navigate"
    && request.headers.get("Sec-Fetch-Dest") === "document";
  if (url.search || (request.headers.get("Sec-Fetch-Site") === "cross-site" && !topLevelNavigation)) return error(403, "アクセスできません。");
  const allowed = (env.OPERATOR_ACCOUNT_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (!allowed.length) return error(503, "運営者権限が設定されていません。");
  try {
    const token = /(?:^|;\s*)vgc_session=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1];
    if (!token || token.length > 128) return error(401, "Googleログインが必要です。");
    const session = await env.DB.prepare(`SELECT p.account_id,
      EXISTS (SELECT 1 FROM account_identities i WHERE i.account_id = p.account_id AND i.provider = 'google') AS google
      FROM player_sessions s JOIN players p ON p.id = s.player_id
      WHERE s.token_hash = ? AND datetime(s.expires_at) > CURRENT_TIMESTAMP AND p.deletion_requested_at IS NULL`)
      .bind(await hashIdentifier(token)).first<{ account_id: string | null; google: number }>();
    if (!session) return error(401, "Googleログインが必要です。");
    if (!session.google || !session.account_id || !allowed.includes(session.account_id)) return error(403, "運営者権限がありません。");
    const report = await collectOperationReport(env.CLOUDFLARE_METRICS_TOKEN ?? "", fetcher);
    const monthly = await collectMonthlyOperationReport(env.CLOUDFLARE_METRICS_TOKEN ?? "", fetcher);
    if (api) return Response.json({ ...report, monthly }, { headers });
    const labels: Record<string, string> = { start: "ゲーム開始", login: "Googleログイン", credit: "無料クレジット付与" };
    const rows = Object.entries(report.families).map(([key, value]) => `<tr><th scope="row">${labels[key]}</th>
      <td>${value.eligible}</td><td>${value.succeeded}</td><td>${value.failed}</td>
      <td class="${value.warning ? "warning" : ""}">${value.failureRate === null ? "—（対象なし）" : (value.failureRate * 100).toFixed(1) + "%"}</td>
      <td>${value.rejected}</td><td>${value.cancelled}</td>
      <td>${value.warning ? "要確認" : value.failureRate === null ? "判定対象なし" : "通知条件なし"}</td></tr>`).join("");
    const monthlyRows = Object.entries(monthly.families).map(([key, value]) => `<tr><th scope="row">${labels[key]}</th>
      <td>${value.eligible}</td><td>${value.succeeded}</td><td>${value.failed}</td>
      <td>${value.successRate === null ? "—（対象なし）" : (value.successRate * 100).toFixed(2) + "%"}</td>
      <td>${value.target === null ? "未設定" : (value.target * 100).toFixed(0) + "%"}</td>
      <td>${value.targetGap === null ? "—" : (value.targetGap >= 0 ? "+" : "") + (value.targetGap * 100).toFixed(2) + "pt"}</td>
      <td class="${value.assessment === "below_reference" ? "warning" : ""}">${value.assessment === "no_eligible_data" ? "判定対象なし" : value.assessment === "target_not_set" ? "目標未設定" : value.assessment === "below_reference" ? "目標水準未満（参考）" : "目標水準以上（参考）"}</td></tr>`).join("");
    return page(`<header><div><p class="eyebrow">PULBASE / 運営者専用 / 検証環境</p><h1>処理結果モニター</h1></div><a class="button" href="${dashboardPath}">集計を更新</a></header>
      <p>直近<strong>20分</strong>の推計件数・技術失敗率</p>
      <p>取得時刻：<time datetime="${report.checkedAt}">${report.checkedAt}</time>（UTC）</p>
      <div class="table"><table><caption>操作別の処理結果</caption><thead><tr><th scope="col">操作</th><th scope="col">判定対象</th><th scope="col">成功</th><th scope="col">技術失敗</th><th scope="col">失敗率</th><th scope="col">拒否</th><th scope="col">キャンセル</th><th scope="col">通知判定</th></tr></thead><tbody>${rows}</tbody></table></div>
      <section><h2>今月のサーバー処理（参考）</h2><p>${monthly.window.month}（日本時間）。月初から取得時刻の5分前までの推計です。</p>
      <p>対象期間（UTC）：${monthly.window.from} 以上 〜 ${monthly.window.to} 未満</p>
      <p>成功率 = 成功 ÷（成功 + 技術失敗）。拒否・キャンセルを除外。開始の参考目標は98%、ログイン・無料付与の目標は未設定です。</p>
      <p>月途中・計測開始前の空白・欠測・サンプリングがあります。開始要求前の障害や開始許可の受信失敗は未捕捉のため、月間SLOの達成判定ではありません。隔離通知訓練を除外しますが、通常の検証用疎通は含みます。</p></section>
      <div class="table"><table><caption>今月の参考成功率・目標との差（pt = パーセントポイント）</caption><thead><tr><th scope="col">操作</th><th scope="col">判定対象</th><th scope="col">成功</th><th scope="col">技術失敗</th><th scope="col">成功率</th><th scope="col">参考目標</th><th scope="col">目標との差</th><th scope="col">参考評価</th></tr></thead><tbody>${monthlyRows}</tbody></table></div>
      <section><h2>読み方</h2><p>失敗率 = 技術失敗 ÷（成功 + 技術失敗）。拒否・キャンセルは分母に含めません。</p>
      <p>技術失敗3件以上、かつ失敗率20%以上で「要確認」。対象なしは正常・復旧の証明ではありません。</p>
      <p>取り込みに数分の遅れやサンプリング・欠落があります。厳密な台帳件数、ユーザー数、月間SLOではありません。ゲーム開始はサーバー側の開始許可までを測ります。</p>
      <p>自動更新は行いません。「集計を更新」で再取得できます。本番の集計は対象外です。</p></section><a href="/">サイトに戻る</a>`);
  } catch { return error(503, "集計を取得できませんでした。時間をおいて更新してください。"); }
}

function page(content: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>処理結果モニター | PULBASE</title><style>
    :root{color-scheme:dark;font-family:system-ui,sans-serif;background:#080e1c;color:#edf4ff}body{max-width:1100px;margin:0 auto;padding:32px 20px;line-height:1.7}header{display:flex;align-items:center;justify-content:space-between;gap:20px}h1{font-size:clamp(24px,4vw,34px);margin:4px 0}.eyebrow{color:#6ae9ee;font-size:13px}a{color:#6ae9ee}.button{border:1px solid #57bccb;border-radius:8px;padding:10px 18px;text-decoration:none;white-space:nowrap}.table{overflow:auto;margin:26px 0;border:1px solid #30465e;border-radius:10px}table{border-collapse:collapse;width:100%;white-space:nowrap}caption{text-align:left;padding:14px;font-weight:bold;background:#142238}th,td{padding:15px 14px;text-align:right;border-bottom:1px solid #30465e}th:first-child{text-align:left}thead{background:#101d30}td.warning{color:#ffb398;font-weight:bold}section{padding:18px;background:#101a2a;border-radius:10px;margin-bottom:24px}h2{font-size:19px;margin:0}p{color:#b9c9df}@media(max-width:600px){body{padding:20px 12px}header{align-items:flex-start;flex-direction:column}th,td{padding:12px}}
    </style></head><body>${content}</body></html>`, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
