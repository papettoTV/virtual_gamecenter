export function nextHealthState(previous, healthy, slot) {
  if (!Number.isInteger(slot) || slot % 300000 !== 0) throw Error("invalid_monitor_slot");
  const valid = previous && Number.isInteger(previous.lastSlot) && typeof previous.incident === "boolean"
    && Number.isInteger(previous.failures) && previous.failures >= 0 && Number.isInteger(previous.successes) && previous.successes >= 0
    && Number.isInteger(previous.downAt) && Number.isInteger(previous.recoveredAt);
  if (previous != null && !valid) throw Error("invalid_monitor_state");
  const state = valid ? { ...previous } : { lastSlot: 0, failures: 0, successes: 0, incident: false, downAt: 0, recoveredAt: 0 };
  if (slot <= state.lastSlot) return null;
  if (slot - state.lastSlot > 450000) { state.failures = 0; state.successes = 0; }
  state.lastSlot = slot;
  state.failures = healthy ? 0 : Math.min(2, state.failures + 1);
  state.successes = healthy ? Math.min(3, state.successes + 1) : 0;
  if (!state.incident && state.failures >= 2) { state.incident = true; state.downAt = slot; }
  if (state.incident && state.successes >= 3) { state.incident = false; state.recoveredAt = slot; }
  return state;
}
