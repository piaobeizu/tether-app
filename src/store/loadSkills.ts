// Skills loader.
//
// Phase 9: calls the Tauri command `tether_skill_list` (which shells
// out to `tether skill list --json` from the Rust side; see
// src-tauri/src/skills.rs for the rationale on subprocess vs in-proc).
//
// In a non-Tauri environment (e.g. plain `vite dev` browser preview,
// vitest happy-dom runtime), `@tauri-apps/api/core::invoke` is not
// wired and throws. The fallback behavior is **gated on `import.meta.env.DEV`**:
//
//   - DEV builds (vite dev / vitest): fall back to a small mock list
//     so the Settings → skills tab renders + tests can run without
//     mocking invoke explicitly.
//   - PROD builds (Tauri webview): the error PROPAGATES — we do NOT
//     silently substitute a hard-coded list. A missing `tether`
//     binary or subprocess failure must be surfaced to the user, not
//     hidden behind 5 fake skills that happen to look real.
//
// D-20 freeze rule (spec §11.Z): UI must NOT bake skill metadata into
// compiled-in arrays — it has to come from `tether skill list`. Gating
// the fallback on DEV keeps the freeze rule's spirit intact: the mock
// list cannot serve the production path even if the daemon disappears.

import { invoke } from "@tauri-apps/api/core";
import type { Skill } from "./types";

/** Wire shape from `tether skill list --json` (mirrored in
 *  src-tauri/src/skills.rs::SkillRow). */
interface RawSkill {
  name: string;
  version: string;
  description: string;
  enabled?: boolean;
  updateAvailable?: string;
}

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
 * Translate the Go-shape `RawSkill` rows to the TS-shape `Skill`. The
 * mapping is the contract documented in the original Phase-9-prep
 * comment: `version → v`, `description → desc`, `enabled → on`
 * (default true), `updateAvailable → update`.
 */
export function mapSkill(raw: RawSkill): Skill {
  const skill: Skill = {
    name: raw.name,
    v: raw.version,
    on: raw.enabled ?? true,
    desc: raw.description,
  };
  if (raw.updateAvailable !== undefined) {
    skill.update = raw.updateAvailable;
  }
  return skill;
}

/**
 * Load the user's installed skills.
 *
 * Path:
 *   1. Try the Tauri `tether_skill_list` command. In Tauri webview
 *      this round-trips to the Rust side which shells out to
 *      `tether skill list --json`.
 *   2a. On invoke failure in **DEV** (vite dev preview / vitest): fall
 *       back to MOCK_SKILLS so the UI stays usable.
 *   2b. On invoke failure in **PROD** (Tauri webview): RETHROW the
 *       error. The store's kickoff (src/store/index.ts) catches it
 *       and surfaces via the same `errorBannerVisible` path the
 *       attach socket uses. We do NOT silently render a hard-coded
 *       skill list in production — see the file header on D-20.
 */
export async function loadSkills(): Promise<Skill[]> {
  try {
    const raw = await invoke<RawSkill[]>("tether_skill_list");
    return raw.map(mapSkill);
  } catch (err) {
    if (import.meta.env.DEV) {
      // Defer one tick so consumers see the "loading" empty-list state
      // before the data lands. Promise.resolve() (microtask) instead of
      // setTimeout(0) (macrotask) so vitest fake-timers don't have to
      // advance to drain the queue.
      await Promise.resolve();
      return MOCK_SKILLS.map((s) => ({ ...s }));
    }
    throw err;
  }
}
