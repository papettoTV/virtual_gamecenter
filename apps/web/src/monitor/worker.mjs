import { checkService } from "../../scripts/service-check.mjs";
import { nextHealthState } from "./health-state.mjs";

export default {
  fetch() { return new Response("Not found", { status: 404 }); },
  async scheduled(event, env) {
    const slot = Math.floor(event.scheduledTime / 300000) * 300000;
    if (!env.PULBASE_CHECK_USERNAME || !env.PULBASE_CHECK_PASSWORD) throw Error("monitor_auth_missing");
    const previous = await env.HEALTH_STATE.get("staging", "json");
    if (!nextHealthState(previous, true, slot)) return;
    const authorization = `Basic ${btoa(`${env.PULBASE_CHECK_USERNAME}:${env.PULBASE_CHECK_PASSWORD}`)}`;
    const result = await checkService({ environment: "staging", authorization });
    const state = nextHealthState(previous, result.ok, slot);
    if (!state) return;
    await env.HEALTH_STATE.put("staging", JSON.stringify(state));
    env.HEALTH_EVENTS.writeDataPoint({
      indexes: ["staging"], blobs: ["staging", result.ok ? "ok" : "error", "v1"],
      doubles: [state.incident ? 1 : 0, state.failures, state.successes, slot / 1000, state.downAt / 1000, state.recoveredAt / 1000],
    });
    console.log(JSON.stringify({ event: "service_check", environment: "staging", healthy: result.ok, incident: state.incident, failures: state.failures, successes: state.successes }));
  },
};
