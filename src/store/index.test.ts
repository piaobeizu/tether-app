// Store unit tests. Cover the action surfaces that downstream
// components depend on. Each test resets the store via the same
// initialState() factory so the order of test execution doesn't
// matter.

import { describe, expect, it, vi } from "vitest";
import { loadSkills } from "./loadSkills";
import { useTetherStore } from "./index";

const SEED_SKILLS = await loadSkills();

const reset = () => {
  // useTetherStore.setState supports a partial; the factory composition
  // gives us back fresh data when called like this. The actions stay
  // bound (zustand keeps function refs unless we replace explicitly).
  // Skills are seeded synchronously via _setSkills so tests don't race
  // the loader.
  useTetherStore.setState((s) => ({
    ...s,
    composerText: "",
    slashOpen: false,
    chat: s.chat.slice(0, 6), // restore initial 6 messages
    picked: ["c2"],
    pairTtl: 47,
    pairMobileStep: "scan",
    drawerOpen: false,
    mobileRoute: "main",
    errorBannerVisible: true,
    wtState: "live",
    connection: { state: "live", latency: 14, attempt: 0 },
    skills: SEED_SKILLS.map((s) => ({ ...s })),
    reload: { active: false, reason: null, startedAt: null },
  }));
  // Cancel any in-flight safety timer left by a previous test before
  // it advanced its fake clock — otherwise a delayed real-timer could
  // race subsequent assertions.
  useTetherStore.getState().clearReloading();
};

describe("useTetherStore", () => {
  it("setComposer surfaces the slash popover when text starts with /", () => {
    reset();
    const { setComposer } = useTetherStore.getState();
    setComposer("/refactor");
    const state = useTetherStore.getState();
    expect(state.composerText).toBe("/refactor");
    expect(state.slashOpen).toBe(true);
  });

  it("setComposer hides the slash popover for plain text", () => {
    reset();
    const { setComposer } = useTetherStore.getState();
    setComposer("hello world");
    expect(useTetherStore.getState().slashOpen).toBe(false);
  });

  it("sendMessage appends a user message and queues a mock AI reply", async () => {
    reset();
    vi.useFakeTimers();

    const initialLen = useTetherStore.getState().chat.length;
    useTetherStore.getState().sendMessage("ping");
    expect(useTetherStore.getState().chat).toHaveLength(initialLen + 1);
    expect(useTetherStore.getState().composerText).toBe("");

    vi.advanceTimersByTime(900);
    expect(useTetherStore.getState().chat).toHaveLength(initialLen + 2);
    expect(useTetherStore.getState().chat.at(-1)?.from).toBe("ai");
  });

  it("sendMessage drops empty input", () => {
    reset();
    const initialLen = useTetherStore.getState().chat.length;
    useTetherStore.getState().sendMessage("   ");
    expect(useTetherStore.getState().chat).toHaveLength(initialLen);
  });

  it("toggleCandidate flips picked-set membership", () => {
    reset();
    const { toggleCandidate } = useTetherStore.getState();
    toggleCandidate("c1");
    expect(useTetherStore.getState().picked).toContain("c1");
    toggleCandidate("c1");
    expect(useTetherStore.getState().picked).not.toContain("c1");
  });

  it("regeneratePairCode produces a fresh code and resets TTL", () => {
    reset();
    const before = useTetherStore.getState().pairCode;
    useTetherStore.getState().regeneratePairCode();
    const { pairCode, pairTtl } = useTetherStore.getState();
    expect(pairCode).not.toBe(before);
    expect(pairCode).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
    expect(pairTtl).toBe(60);
  });

  it("rollbackDag resets the DAG to first node running, rest queued", () => {
    reset();
    useTetherStore.getState().rollbackDag();
    const { nodes, elapsedMs } = useTetherStore.getState().dag;
    expect(nodes[0]?.status).toBe("running");
    expect(nodes.slice(1).every((n) => n.status === "queued")).toBe(true);
    expect(elapsedMs).toBe(0);
  });

  it("toggleSkill flips a single skill's on flag without affecting siblings", () => {
    reset();
    const before = useTetherStore.getState().skills.find((s) => s.name === "diff.review")?.on;
    useTetherStore.getState().toggleSkill("diff.review");
    const after = useTetherStore.getState().skills.find((s) => s.name === "diff.review")?.on;
    expect(after).toBe(!before);
    // Sibling untouched
    const sibling = useTetherStore.getState().skills.find((s) => s.name === "spec.write");
    expect(sibling?.on).toBe(true);
  });

  it("triggerError flips wtState + connection + errorBannerVisible together", () => {
    reset();
    useTetherStore.getState().triggerError();
    const { connection, wtState, errorBannerVisible } = useTetherStore.getState();
    expect(connection.state).toBe("reconnecting");
    expect(wtState).toBe("reconnecting");
    expect(errorBannerVisible).toBe(true);
  });

  it("reconnect schedules a return to live state", () => {
    reset();
    vi.useFakeTimers();
    useTetherStore.getState().triggerError();
    useTetherStore.getState().reconnect();
    expect(useTetherStore.getState().wtState).toBe("reconnecting");

    vi.advanceTimersByTime(1900);
    const after = useTetherStore.getState();
    expect(after.wtState).toBe("live");
    expect(after.connection.state).toBe("live");
    expect(after.errorBannerVisible).toBe(false);
  });

  it("setActiveWorkspace updates active and closes the drawer", () => {
    reset();
    useTetherStore.setState({ drawerOpen: true });
    useTetherStore.getState().setActiveWorkspace("tether-doc");
    const state = useTetherStore.getState();
    expect(state.activeWorkspace).toBe("tether-doc");
    expect(state.drawerOpen).toBe(false);
  });

  it("confirmPair advances to success then auto-resets to scan", () => {
    reset();
    vi.useFakeTimers();
    useTetherStore.getState().confirmPair();
    expect(useTetherStore.getState().pairMobileStep).toBe("success");
    vi.advanceTimersByTime(3100);
    expect(useTetherStore.getState().pairMobileStep).toBe("scan");
  });

  it("toggleTheme flips light ↔ dark and persists to localStorage", () => {
    reset();
    useTetherStore.setState({ theme: "light" });
    useTetherStore.getState().toggleTheme();
    expect(useTetherStore.getState().theme).toBe("dark");
    expect(localStorage.getItem("tether.theme")).toBe("dark");
    useTetherStore.getState().toggleTheme();
    expect(useTetherStore.getState().theme).toBe("light");
    expect(localStorage.getItem("tether.theme")).toBe("light");
  });

  it("setTheme persists explicit value", () => {
    reset();
    useTetherStore.getState().setTheme("dark");
    expect(useTetherStore.getState().theme).toBe("dark");
    expect(localStorage.getItem("tether.theme")).toBe("dark");
  });

  it("_advanceDag is a no-op when route is not 'home'", () => {
    reset();
    useTetherStore.setState({ route: "settings" });
    const beforeElapsed = useTetherStore.getState().dag.elapsedMs;
    const beforeNodes = useTetherStore.getState().dag.nodes;
    useTetherStore.getState()._advanceDag();
    const after = useTetherStore.getState().dag;
    expect(after.elapsedMs).toBe(beforeElapsed);
    expect(after.nodes).toBe(beforeNodes); // identity preserved → no churn
  });

  it("_tickPairTtl is a no-op when route is not 'pair'", () => {
    reset();
    useTetherStore.setState({ route: "home", pairTtl: 30 });
    useTetherStore.getState()._tickPairTtl();
    expect(useTetherStore.getState().pairTtl).toBe(30);
  });

  it("setRoute changes the top-level route", () => {
    reset();
    useTetherStore.getState().setRoute("settings");
    expect(useTetherStore.getState().route).toBe("settings");
    useTetherStore.getState().setRoute("pair");
    expect(useTetherStore.getState().route).toBe("pair");
  });

  it("loadSkills() returns the v0.1 mock list", async () => {
    const skills = await loadSkills();
    expect(skills).toHaveLength(5);
    const names = skills.map((s) => s.name);
    expect(names).toEqual([
      "refactor.code",
      "spec.write",
      "triage.issues",
      "diff.review",
      "research.synth",
    ]);
  });

  it("_setSkills replaces the skills array deterministically", () => {
    reset();
    useTetherStore.getState()._setSkills([]);
    expect(useTetherStore.getState().skills).toEqual([]);
    const fresh = SEED_SKILLS.map((s) => ({ ...s, on: false }));
    useTetherStore.getState()._setSkills(fresh);
    expect(useTetherStore.getState().skills).toHaveLength(5);
    expect(useTetherStore.getState().skills.every((s) => !s.on)).toBe(true);
  });

  it("setReloading flips reload state and stamps reason + startedAt", () => {
    reset();
    vi.useFakeTimers();
    useTetherStore.setState({
      reload: { active: false, reason: null, startedAt: null },
    });
    const before = Date.now();
    useTetherStore.getState().setReloading("session.state");
    const r = useTetherStore.getState().reload;
    expect(r.active).toBe(true);
    expect(r.reason).toBe("session.state");
    expect(r.startedAt).not.toBeNull();
    expect(r.startedAt!).toBeGreaterThanOrEqual(before);
  });

  it("clearReloading reverts to inactive and is idempotent", () => {
    reset();
    vi.useFakeTimers();
    useTetherStore.getState().setReloading("foo");
    expect(useTetherStore.getState().reload.active).toBe(true);
    useTetherStore.getState().clearReloading();
    const r = useTetherStore.getState().reload;
    expect(r.active).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.startedAt).toBeNull();
    // Calling again is a no-op (idempotent).
    expect(() => useTetherStore.getState().clearReloading()).not.toThrow();
  });

  it("setReloading auto-clears after the 30s safety timeout", () => {
    reset();
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    useTetherStore.getState().setReloading("session.state");
    expect(useTetherStore.getState().reload.active).toBe(true);

    // Just under the bound — still active.
    vi.advanceTimersByTime(29_999);
    expect(useTetherStore.getState().reload.active).toBe(true);

    // Cross the boundary — auto-clear + console.warn.
    vi.advanceTimersByTime(2);
    expect(useTetherStore.getState().reload.active).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/safety timeout fired/),
    );
    warnSpy.mockRestore();
  });

  it("setReloading called twice resets the safety-timeout deadline", () => {
    reset();
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    useTetherStore.getState().setReloading("first");
    vi.advanceTimersByTime(20_000); // 10s remaining on the first timer
    useTetherStore.getState().setReloading("second"); // resets deadline
    expect(useTetherStore.getState().reload.reason).toBe("second");

    // Original 30s would have fired now (20s + 10s) — must NOT fire.
    vi.advanceTimersByTime(15_000);
    expect(useTetherStore.getState().reload.active).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();

    // Past the second timer's 30s — now it fires.
    vi.advanceTimersByTime(15_500);
    expect(useTetherStore.getState().reload.active).toBe(false);
    warnSpy.mockRestore();
  });

  it("clearReloading cancels the safety-timeout timer", () => {
    reset();
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    useTetherStore.getState().setReloading("x");
    useTetherStore.getState().clearReloading();
    vi.advanceTimersByTime(60_000);
    // Already cleared and timer canceled — no warn fired.
    expect(warnSpy).not.toHaveBeenCalled();
    expect(useTetherStore.getState().reload.active).toBe(false);
    warnSpy.mockRestore();
  });
});
