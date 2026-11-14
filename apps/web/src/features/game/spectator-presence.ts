type Tier = "none" | "watching" | "crowd";
export type PresencePhase = "idle" | "playing" | "paused" | "waiting" | "finished";

export function hasSpectatorPeak(count: number | undefined): count is number {
  return count !== undefined && Number.isInteger(count) && count > 0;
}

export function renderSpectatorGlow(element: Element | null, presence: { tier: Tier; pulse: boolean }) {
  if (!element) return;
  if (element.getAttribute("data-presence") !== presence.tier) element.setAttribute("data-presence", presence.tier);
  if (element.hasAttribute("data-pulse") !== presence.pulse) element.toggleAttribute("data-pulse", presence.pulse);
}

export function createSpectatorPresence() {
  let tier: Tier = "none";
  let pending: Tier = "none";
  let changedAt = 0;
  let pulsed = false;
  let pulseUntil = 0;
  let peak = 0;
  const order = { none: 0, watching: 1, crowd: 2 };

  return {
    reset() {
      tier = pending = "none";
      changedAt = pulseUntil = peak = 0;
      pulsed = false;
    },
    get peak() { return peak; },
    update(phase: PresencePhase, count: number | null, now: number) {
      if ((phase === "playing" || phase === "paused" || phase === "waiting") && count !== null) {
        peak = Math.max(peak, count);
      }
      if (phase !== "playing" || count === null) {
        tier = pending = "none";
        pulseUntil = 0;
      } else {
        const desired = count >= 3 ? "crowd" : count > 0 ? "watching" : "none";
        if (pending !== desired) {
          pending = desired;
          changedAt = now;
        }
        if (tier !== desired && now - changedAt >= (order[desired] > order[tier] ? 2000 : 3500)) {
          tier = desired;
          if (tier === "crowd" && !pulsed) {
            pulsed = true;
            pulseUntil = now + 1450;
          }
        }
      }
      return { tier, pulse: now < pulseUntil, pausedCount: phase === "paused" ? count : null };
    },
  };
}
