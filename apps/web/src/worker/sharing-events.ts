import { getGameDefinition } from "../domain/game";

const EVENTS = new Set(["share_opened", "share_link_copied", "share_target_opened", "share_native_handoff", "share_image_saved", "result_viewed", "play_started_from_result"]);
const CHANNELS = new Set(["native", "x", "line", "bluesky", "clipboard", "download"]);
const SAFE_ID = /^[a-zA-Z0-9-]{1,100}$/;

export async function handleSharingEvent(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return Response.json({ error: "invalid_origin" }, { status: 403 });
  if (!request.body) return Response.json({ error: "invalid_json" }, { status: 400 });
  const reader = request.body.getReader();
  const bytes = new Uint8Array(2048);
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (size + chunk.value.length > bytes.length) {
        await reader.cancel();
        return Response.json({ error: "payload_too_large" }, { status: 413 });
      }
      bytes.set(chunk.value, size); size += chunk.value.length;
    }
  } finally { reader.releaseLock(); }
  const raw = new TextDecoder().decode(bytes.subarray(0, size));
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || typeof body.eventId !== "string" || !SAFE_ID.test(body.eventId)
    || typeof body.targetId !== "string" || !SAFE_ID.test(body.targetId)
    || typeof body.eventType !== "string" || !EVENTS.has(body.eventType)
    || typeof body.gameId !== "string" || !getGameDefinition(body.gameId)
    || !["live", "result"].includes(String(body.kind))
    || (body.shareId !== undefined && body.shareId !== "" && (typeof body.shareId !== "string" || !SAFE_ID.test(body.shareId)))
    || (body.channel !== undefined && (typeof body.channel !== "string" || !CHANNELS.has(body.channel)))) return Response.json({ error: "invalid_event" }, { status: 400 });
  await db.prepare("INSERT OR IGNORE INTO sharing_events (id, event_type, kind, game_id, target_id, share_id, channel) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(body.eventId, body.eventType, body.kind, body.gameId, body.targetId, body.shareId || null, body.channel ?? null).run();
  return Response.json({ recorded: true });
}
