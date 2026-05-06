// Store unit tests. Cover the action surfaces that downstream
// components depend on. Each test resets the store via the same
// initialState() factory so the order of test execution doesn't
// matter.

import { describe, expect, it, vi } from "vitest";
import { useTetherStore } from "./index";

const reset = () => {
  // useTetherStore.setState supports a partial; the factory composition
  // gives us back fresh data when called like this. The actions stay
  // bound (zustand keeps function refs unless we replace explicitly).
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
  }));
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
});
