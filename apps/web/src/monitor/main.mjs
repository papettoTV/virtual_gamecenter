import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "./worker.mjs";
import { DRILL_KEY, drillProbe, finishDrill, recoverDrill, startDrill, validDrill } from "./health-drill.mjs";

function guarded(env) {
  if (env.MONITOR_ENVIRONMENT !== "staging") throw Error("staging_monitor_required");
}

export class HealthDrillProbe extends WorkerEntrypoint {
  async fetch(request) { guarded(this.env); return drillProbe(request, this.env.HEALTH_STATE); }
}

export class HealthDrillOperator extends WorkerEntrypoint {
  async start() { guarded(this.env); return startDrill(this.env.HEALTH_STATE); }
  async recover() { guarded(this.env); return recoverDrill(this.env.HEALTH_STATE); }
  async finish() { guarded(this.env); return finishDrill(this.env.HEALTH_STATE); }
  async status() {
    guarded(this.env);
    return { drill: validDrill(await this.env.HEALTH_STATE.get(DRILL_KEY, "json")), state: await this.env.HEALTH_STATE.get("staging", "json") };
  }
}

export default worker;
