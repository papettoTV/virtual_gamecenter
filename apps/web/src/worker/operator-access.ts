import { hashIdentifier } from "./identity-hash";

export async function operatorAccess(request: Request, env: { APP_ENV?: string; OPERATOR_ACCOUNT_IDS?: string; DB: D1Database }) {
  if (env.APP_ENV !== "staging") return { status: 404, message: "この環境では利用できません。" };
  const allowed = (env.OPERATOR_ACCOUNT_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (!allowed.length) return { status: 503, message: "運営者権限が設定されていません。" };
  const token = /(?:^|;\s*)vgc_session=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1];
  if (!token || token.length > 128) return { status: 401, message: "Googleログインが必要です。" };
  const session = await env.DB.prepare(`SELECT p.account_id,
    EXISTS (SELECT 1 FROM account_identities i WHERE i.account_id = p.account_id AND i.provider = 'google') AS google
    FROM player_sessions s JOIN players p ON p.id = s.player_id
    WHERE s.token_hash = ? AND datetime(s.expires_at) > CURRENT_TIMESTAMP AND p.deletion_requested_at IS NULL`)
    .bind(await hashIdentifier(token)).first<{ account_id: string | null; google: number }>();
  if (!session) return { status: 401, message: "Googleログインが必要です。" };
  if (!session.google || !session.account_id || !allowed.includes(session.account_id)) return { status: 403, message: "運営者権限がありません。" };
  return null;
}
