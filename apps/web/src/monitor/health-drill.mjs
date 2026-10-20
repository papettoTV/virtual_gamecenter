export const DRILL_KEY = "staging-http-drill-v1";
export const DRILL_MARKER = "controlled-http-drill-v1";

export function validDrill(value, now = Date.now()) {
  if (value == null) return null;
  if (value.version !== 1 || !Number.isSafeInteger(value.startedAt)
    || !Number.isSafeInteger(value.faultUntil) || !Number.isSafeInteger(value.expiresAt)
    || value.startedAt > now || value.expiresAt - value.startedAt !== 3600000
    || value.faultUntil < value.startedAt || value.faultUntil > value.startedAt + 1200000) {
    throw Error("invalid_health_drill");
  }
  return value.expiresAt > now ? value : null;
}

export async function startDrill(storage, now = Date.now()) {
  if (validDrill(await storage.get(DRILL_KEY, "json"), now)) throw Error("health_drill_already_active");
  const state = await storage.get("staging", "json");
  if (!state || state.incident !== false || state.successes !== 3
    || !Number.isSafeInteger(state.lastSlot) || state.lastSlot > now || now - state.lastSlot > 600000) {
    throw Error("healthy_baseline_required");
  }
  const drill = { version: 1, startedAt: now, faultUntil: now + 1200000, expiresAt: now + 3600000 };
  await storage.put(DRILL_KEY, JSON.stringify(drill), { expirationTtl: 3600 });
  return drill;
}

export async function recoverDrill(storage, now = Date.now()) {
  const drill = validDrill(await storage.get(DRILL_KEY, "json"), now);
  if (!drill) throw Error("active_health_drill_required");
  drill.faultUntil = Math.min(drill.faultUntil, now);
  await storage.put(DRILL_KEY, JSON.stringify(drill), { expirationTtl: Math.max(60, Math.ceil((drill.expiresAt - now) / 1000)) });
  return drill;
}

export async function finishDrill(storage, now = Date.now()) {
  const drill = validDrill(await storage.get(DRILL_KEY, "json"), now);
  const state = await storage.get("staging", "json");
  if (drill && drill.faultUntil > now) throw Error("drill_fault_still_active");
  if (!state || state.incident !== false || state.successes !== 3
    || !Number.isSafeInteger(state.lastSlot) || state.lastSlot > now || now - state.lastSlot > 600000) {
    throw Error("healthy_recovery_required");
  }
  await storage.delete(DRILL_KEY);
  return { finished: true, healthy: true };
}

export async function checkDrill(env, now = Date.now()) {
  const drill = validDrill(await env.HEALTH_STATE.get(DRILL_KEY, "json"), now);
  if (!drill) return { active: false, ok: true, status: null };
  if (!env.HEALTH_DRILL_PROBE) throw Error("health_drill_binding_missing");
  const response = await env.HEALTH_DRILL_PROBE.fetch(new Request("https://health-drill.invalid/probe", {
    method: "GET", redirect: "manual", signal: AbortSignal.timeout(10000),
  }));
  await response.body?.cancel();
  return { active: true, ok: response.status === 200 && response.headers.get("X-Pulbase-Health-Drill") === DRILL_MARKER, status: response.status };
}

export async function drillProbe(request, storage, now = Date.now()) {
  const url = new URL(request.url);
  if (url.origin !== "https://health-drill.invalid" || url.pathname !== "/probe" || url.search
    || request.method !== "GET" || request.headers.has("Authorization") || request.headers.has("Cookie")) {
    return new Response(null, { status: 404 });
  }
  const drill = validDrill(await storage.get(DRILL_KEY, "json"), now);
  return new Response(null, { status: drill && drill.faultUntil > now ? 503 : 200,
    headers: { "X-Pulbase-Health-Drill": DRILL_MARKER, "Cache-Control": "no-store" } });
}
