// Background timers driving the prototype's auto-advance behaviors:
//
//   - DAG ticker — advances the currently-running node ~once every
//     ~7s (15% chance per 1s tick), mirroring the prototype.
//   - Pair TTL countdown — decrements pairTtl every 1s; rolls over to
//     fresh code at 0.
//
// Both are mock affordances for the design canvas. Replaced by real
// daemon envelope events in Phase 5+:
//
//   - DAG progress arrives via JSONL watcher → wire envelope mapper.
//   - Pair TTL is server-issued (J2 token expiry) — clients should
//     just display the remaining time, not run their own timer.
//
// Use `startMockTimers()` from a top-level effect in App or main.tsx.
// Returns a teardown function that clears the intervals (idempotent).

import { useTetherStore } from "./index";

const TICK_MS = 1000;

export function startMockTimers(): () => void {
  const dagId = setInterval(() => useTetherStore.getState()._advanceDag(), TICK_MS);
  const pairId = setInterval(() => useTetherStore.getState()._tickPairTtl(), TICK_MS);
  return () => {
    clearInterval(dagId);
    clearInterval(pairId);
  };
}
