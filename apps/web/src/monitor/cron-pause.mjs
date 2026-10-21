export const CRON_PAUSE_MARKER = "monitor-cron-pause-v1";
export const CRON_PAUSE_DURATION = 1200000;

export function monitorPaused(env, now = Date.now()) {
  const values = [env.MONITOR_PAUSE_KIND, env.MONITOR_PAUSE_STARTED_MS, env.MONITOR_PAUSE_UNTIL_MS];
  if (values.every(value => value === undefined)) return false;
  const started = Number(env.MONITOR_PAUSE_STARTED_MS), until = Number(env.MONITOR_PAUSE_UNTIL_MS);
  if (env.MONITOR_ENVIRONMENT !== "staging" || env.MONITOR_PAUSE_KIND !== CRON_PAUSE_MARKER
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(started) || !Number.isSafeInteger(until)
    || started <= 0 || started > now || until - started !== CRON_PAUSE_DURATION) throw Error("invalid_monitor_pause");
  return now < until;
}
