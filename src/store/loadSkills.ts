// Skills loader. v0.1: returns the static mock list. Phase 9 swaps
// the body to call the Tauri command bridging `tether skill list`,
// keeping the function signature stable so consuming components
// don't change.
//
// D-20 freeze rule (spec §11.Z) requires that UI must NOT bake skill
// metadata into compiled-in arrays — it has to come from
// `tether skill list`. v0.1 mocks the call boundary; the contract is
// what gets locked.

import type { Skill } from "./types";

const MOCK_SKILLS: readonly Skill[] = [
  {
    name: "refactor.code",
    v: "0.4.2",
    on: true,
    desc: "DAG-driven code restructuring",
  },
  {
    name: "spec.write",
    v: "0.2.1",
    on: true,
    desc: "spec writeup with structured form",
  },
  {
    name: "triage.issues",
    v: "0.1.0",
    on: true,
    update: "→ 0.2.0",
    desc: "candidate issue surfacer",
  },
  {
    name: "diff.review",
    v: "0.3.0",
    on: false,
    desc: "interactive diff review",
  },
  {
    name: "research.synth",
    v: "0.1.5",
    on: true,
    desc: "media-heavy research synthesis",
  },
] as const;

/**
 * Load the user's installed skills.
 *
 * v0.1 returns a fixed mock list. Phase 9 will replace the body with
 * a Tauri command bridging to the Go-side `tether skill list` CLI.
 * The TS-facing signature does NOT change — but the body has to do
 * field translation, because the Go and TS shapes are not identical:
 *
 *   Go side (cmd/tether/skill.go → JSON over the bridge):
 *     {
 *       "name":        "refactor.code",
 *       "version":     "0.4.2",
 *       "description": "DAG-driven code restructuring",
 *       // (no `on` — enablement lives in tether.toml; Go side returns
 *       //  it via a separate field once that PR lands; v0.1 mock
 *       //  hard-codes true)
 *       // (no `update` — pulled from a separate skill-registry probe)
 *     }
 *
 *   TS side (./types.ts Skill):
 *     {
 *       name:    string;
 *       v:       string;     // ← Go.version
 *       on:      boolean;    // ← Go.enabled (TBD field) || true
 *       update?: string;     // ← from the registry probe, optional
 *       desc:    string;     // ← Go.description
 *     }
 *
 * Phase 9 implementation skeleton (kept as a comment, not active):
 *
 *   const raw = await invoke<Array<{
 *     name: string; version: string; description: string;
 *     enabled?: boolean; updateAvailable?: string;
 *   }>>('tether_skill_list');
 *   return raw.map((s) => ({
 *     name: s.name,
 *     v:    s.version,
 *     on:   s.enabled ?? true,
 *     update: s.updateAvailable,
 *     desc: s.description,
 *   }));
 *
 * If we instead align the TS shape to the Go shape (name/version/
 * description/enabled), the rename touches every component that
 * reads `s.v` / `s.on` / `s.desc` (settings drawer, mobile skill
 * page) — Phase 9 should do the field mapping HERE rather than
 * propagate the Go names into the UI. This is the call site to come
 * back to; mock and real both pass through this function.
 */
export async function loadSkills(): Promise<Skill[]> {
  // Defer one tick so consumers see the "loading" empty-list state
  // before the data lands — mirrors the network round-trip Phase 9
  // will incur for real. Promise.resolve() (microtask) instead of
  // setTimeout(0) (macrotask) so vitest fake-timers don't have to
  // advance to drain the queue.
  await Promise.resolve();
  return MOCK_SKILLS.map((s) => ({ ...s }));
}
