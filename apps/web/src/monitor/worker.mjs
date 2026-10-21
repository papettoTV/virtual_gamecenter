import { checkService } from "../../scripts/service-check.mjs";
import { nextHealthState } from "./health-state.mjs";
import { checkDrill, DRILL_MARKER } from "./health-drill.mjs";
import { recordStartAlert } from "./start-slo-alert.mjs";
import { monitorPaused } from "./cron-pause.mjs";

export default {
  fetch() { return new Response("Not found", { status: 404 }); },
  async scheduled(event, env) {
    if (monitorPaused(env)) {
      console.log(JSON.stringify({ event: "monitor_cron_paused", environment: "staging" }));
      return;
    }
    const slot = Math.floor(event.scheduledTime / 300000) * 300000;
    if (!env.PULBASE_CHECK_USERNAME || !env.PULBASE_CHECK_PASSWORD) throw Error("monitor_auth_missing");
    const previous = await env.HEALTH_STATE.get("staging", "json");
    if (!nextHealthState(previous, true, slot)) return;
    const authorization = `Basic ${btoa(`${env.PULBASE_CHECK_USERNAME}:${env.PULBASE_CHECK_PASSWORD}`)}`;
    const result = await checkService({ environment: "staging", authorization });
    const drill = await checkDrill(env);
    const healthy = result.ok && drill.ok;
    const state = nextHealthState(previous, healthy, slot);
    if (!state) return;
    await env.HEALTH_STATE.put("staging", JSON.stringify(state));
    env.HEALTH_EVENTS.writeDataPoint({
      indexes: ["staging"], blobs: ["staging", healthy ? "ok" : "error", "v1", drill.active ? DRILL_MARKER : "normal"],
      doubles: [state.incident ? 1 : 0, state.failures, state.successes, slot / 1000, state.downAt / 1000, state.recoveredAt / 1000, drill.status ?? 0, result.ok ? 1 : 0],
    });
    console.log(JSON.stringify({ event: "service_check", environment: "staging", healthy, applicationHealthy: result.ok, drill: drill.active, drillStatus: drill.status, incident: state.incident, failures: state.failures, successes: state.successes }));
    if (env.START_SLO_ENABLED === "true") await recordStartAlert(env);
  },
};
