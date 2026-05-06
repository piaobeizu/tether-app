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
 * `await invoke<Skill[]>('tether_skill_list')` once the Tauri command
 * bridges to the Go-side `tether skill list` CLI. The signature does
 * not change.
 */
export async function loadSkills(): Promise<Skill[]> {
  // Defer one tick so consumers see the "loading" empty-list state
  // before the data lands — mirrors the network round-trip Phase 9
  // will incur for real.
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK_SKILLS.map((s) => ({ ...s }))), 0);
  });
}
