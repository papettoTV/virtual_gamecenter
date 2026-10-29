import { hashIdentifier } from "./identity-hash";

export function feedbackDevice(userAgent: string | null) {
  const agent = userAgent && userAgent.length <= 1024 ? userAgent : "";
  const device = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(agent) ? "スマホ"
    : /iPad|Tablet|Android/i.test(agent) ? "タブレット"
    : /Windows NT|Macintosh|X11|CrOS|Linux/i.test(agent) ? "PC" : "不明";
  const browser = /Edg(?:e|A|iOS)?\//i.test(agent) ? "Edge"
    : /OPR\/|OPiOS\//i.test(agent) ? "Opera"
    : /SamsungBrowser\//i.test(agent) ? "Samsung Internet"
    : /Firefox\/|FxiOS\//i.test(agent) ? "Firefox"
    : /Chrome\/|CriOS\//i.test(agent) ? "Chrome"
    : /Version\/.*Safari\//i.test(agent) ? "Safari" : "不明";
  return { device, browser };
}

export async function feedbackPlayerName(request: Request, database: D1Database): Promise<string | null> {
  const token = /(?:^|;\s*)vgc_session=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1];
  if (!token || token.length > 128) return null;
  const identity = await database.prepare(`SELECT COALESCE(NULLIF(a.display_name, ''), NULLIF(p.guest_name, ''), 'Player-' || substr(replace(p.id, '-', ''), 1, 8)) AS name
    FROM player_sessions s JOIN players p ON p.id = s.player_id LEFT JOIN accounts a ON a.id = p.account_id
    WHERE s.token_hash = ? AND datetime(s.expires_at) > CURRENT_TIMESTAMP AND p.deletion_requested_at IS NULL`)
    .bind(await hashIdentifier(token)).first<{ name: string }>();
  return identity?.name.slice(0, 100) ?? null;
}

export function feedbackJapanTime(createdAt: string): string {
  const date = new Date(createdAt.replace(" ", "T") + "Z");
  if (!Number.isFinite(date.getTime())) return "未記録";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date) + " JST";
}
