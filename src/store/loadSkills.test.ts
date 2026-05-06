// Phase 9: loadSkills() now invokes the Tauri command
// `tether_skill_list` and translates the raw Go-shape rows to TS-shape
// Skills. These tests mock @tauri-apps/api/core::invoke to verify both
// the success path (field translation) and the failure path (mock
// fallback for non-Tauri runtimes).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("loadSkills (Phase 9 Tauri path)", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    mockInvoke.mockReset();
  });

  it("invokes tether_skill_list and translates fields Go→TS", async () => {
    mockInvoke.mockResolvedValue([
      {
        name: "refactor.code",
        version: "0.4.2",
        description: "DAG-driven code restructuring",
      },
      {
        name: "triage.issues",
        version: "0.1.0",
        description: "candidate issue surfacer",
        enabled: false,
        updateAvailable: "→ 0.2.0",
      },
    ]);

    const { loadSkills } = await import("./loadSkills");
    const skills = await loadSkills();

    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("tether_skill_list");
    expect(skills).toEqual([
      {
        name: "refactor.code",
        v: "0.4.2",
        on: true,
        desc: "DAG-driven code restructuring",
      },
      {
        name: "triage.issues",
        v: "0.1.0",
        on: false,
        desc: "candidate issue surfacer",
        update: "→ 0.2.0",
      },
    ]);
  });

  it("defaults `on` to true when the Go side omits `enabled`", async () => {
    mockInvoke.mockResolvedValue([
      { name: "x", version: "1", description: "d" },
    ]);
    const { loadSkills } = await import("./loadSkills");
    const skills = await loadSkills();
    expect(skills[0]?.on).toBe(true);
  });

  it("does NOT include `update` in the output when Go side omits updateAvailable", async () => {
    mockInvoke.mockResolvedValue([
      { name: "x", version: "1", description: "d" },
    ]);
    const { loadSkills } = await import("./loadSkills");
    const skills = await loadSkills();
    expect(skills[0]).not.toHaveProperty("update");
  });

  it("falls back to MOCK_SKILLS when invoke throws (no Tauri host)", async () => {
    mockInvoke.mockRejectedValue(new Error("ipc not available"));
    const { loadSkills } = await import("./loadSkills");
    const skills = await loadSkills();
    expect(skills).toHaveLength(5);
    expect(skills.map((s) => s.name)).toEqual([
      "refactor.code",
      "spec.write",
      "triage.issues",
      "diff.review",
      "research.synth",
    ]);
  });

  it("returns an empty list when the daemon reports no installed skills", async () => {
    mockInvoke.mockResolvedValue([]);
    const { loadSkills } = await import("./loadSkills");
    const skills = await loadSkills();
    expect(skills).toEqual([]);
  });

  it("mapSkill is exported and pure", async () => {
    const { mapSkill } = await import("./loadSkills");
    const out = mapSkill({
      name: "n",
      version: "v",
      description: "d",
      enabled: false,
      updateAvailable: "u",
    });
    expect(out).toEqual({ name: "n", v: "v", on: false, desc: "d", update: "u" });
  });
});
