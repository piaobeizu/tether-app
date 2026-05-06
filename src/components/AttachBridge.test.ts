// AttachBridge — frame dispatcher unit tests. The full subscribe()
// effect is exercised end-to-end against the real Rust side (cargo
// test -p tether-app); here we just lock in the pure body
// classification path.

import { describe, expect, it, beforeEach } from "vitest";
import { handleFrame } from "./AttachBridge";
import { useTetherStore } from "@/store";

describe("AttachBridge.handleFrame", () => {
  beforeEach(() => {
    useTetherStore.getState().setAttachState("idle");
    // Clear any leftover reload state + safety timer from a prior test.
    useTetherStore.getState().clearReloading();
  });

  it("transitions to error on attach.lock-denied", () => {
    handleFrame({
      type: "attach.lock-denied",
      reason: "in use by client A",
      holder: { kind: "terminal", deviceId: "device-A" },
    });
    const s = useTetherStore.getState();
    expect(s.attachState).toBe("error");
    expect(s.attachError).toMatch(/lock-denied/);
  });

  it("ignores attach.ack frames (state machine handles connect)", () => {
    handleFrame({ type: "attach.ack", sessionId: "x", mode: "ro" });
    expect(useTetherStore.getState().attachState).toBe("idle");
  });

  it("ignores LocalEnvelope frames for attach-state purposes (Phase 10 will route to chat)", () => {
    handleFrame({
      kind: "output.agent-event",
      sessionId: "x",
      providerType: "claude-code",
    });
    expect(useTetherStore.getState().attachState).toBe("idle");
  });

  it("dispatches auth.tool-request envelopes into the auth-prompt slice", () => {
    useTetherStore.setState({
      pendingAuthRequest: null,
      authRequestQueue: [],
    });
    handleFrame({
      kind: "auth.tool-request",
      sessionId: "sid-1",
      plaintextMetadata: {
        requestId: "auth-xyz",
        toolName: "Bash",
        toolInput: { command: "ls" },
        summary: "Bash: ls",
      },
    });
    const s = useTetherStore.getState();
    expect(s.pendingAuthRequest).not.toBeNull();
    expect(s.pendingAuthRequest?.requestId).toBe("auth-xyz");
    expect(s.pendingAuthRequest?.toolName).toBe("Bash");
    expect(s.pendingAuthRequest?.summary).toBe("Bash: ls");
  });

  it("queues a second auth.tool-request behind the in-flight one", () => {
    useTetherStore.setState({
      pendingAuthRequest: null,
      authRequestQueue: [],
    });
    const make = (rid: string) => ({
      kind: "auth.tool-request",
      sessionId: "sid-1",
      plaintextMetadata: {
        requestId: rid,
        toolName: "Bash",
        toolInput: {},
        summary: rid,
      },
    });
    handleFrame(make("a"));
    handleFrame(make("b"));
    const s = useTetherStore.getState();
    expect(s.pendingAuthRequest?.requestId).toBe("a");
    expect(s.authRequestQueue).toHaveLength(1);
    expect(s.authRequestQueue[0]?.requestId).toBe("b");
  });

  it("ignores malformed auth.tool-request envelopes", () => {
    useTetherStore.setState({
      pendingAuthRequest: null,
      authRequestQueue: [],
    });
    // Missing required metadata fields.
    handleFrame({
      kind: "auth.tool-request",
      sessionId: "sid-1",
      plaintextMetadata: { requestId: "x" }, // missing toolName, summary
    });
    expect(useTetherStore.getState().pendingAuthRequest).toBeNull();
  });

  it("is null-safe", () => {
    handleFrame(null);
    handleFrame(undefined);
    handleFrame("string");
    handleFrame(42);
    expect(useTetherStore.getState().attachState).toBe("idle");
  });

  describe("reload signal", () => {
    it("session.state with recordType=system flips reload.active to true", () => {
      handleFrame({
        kind: "session.state",
        sessionId: "sid-A",
        providerType: "claude-code",
        plaintextMetadata: { recordType: "system", class: "STATE" },
      });
      const r = useTetherStore.getState().reload;
      expect(r.active).toBe(true);
      expect(r.reason).toBe("session.state");
    });

    it("a non-system session.state envelope does NOT trigger reload", () => {
      handleFrame({
        kind: "session.state",
        sessionId: "sid-A",
        providerType: "claude-code",
        plaintextMetadata: { recordType: "permission-mode", class: "STATE" },
      });
      expect(useTetherStore.getState().reload.active).toBe(false);
    });

    it("a subsequent agent-event clears an active reload", () => {
      // Arm reload.
      handleFrame({
        kind: "session.state",
        sessionId: "sid-A",
        providerType: "claude-code",
        plaintextMetadata: { recordType: "system" },
      });
      expect(useTetherStore.getState().reload.active).toBe(true);

      // Agent traffic resumes → reload clears.
      handleFrame({
        kind: "output.agent-event",
        sessionId: "sid-A",
        providerType: "claude-code",
      });
      expect(useTetherStore.getState().reload.active).toBe(false);
    });

    it("a subsequent hook-event also clears an active reload", () => {
      handleFrame({
        kind: "session.state",
        sessionId: "sid-A",
        providerType: "claude-code",
        plaintextMetadata: { recordType: "system" },
      });
      expect(useTetherStore.getState().reload.active).toBe(true);

      handleFrame({
        kind: "output.hook-event",
        sessionId: "sid-A",
        providerType: "claude-code",
      });
      expect(useTetherStore.getState().reload.active).toBe(false);
    });

    it("malformed envelopes (missing plaintextMetadata) are tolerated", () => {
      handleFrame({ kind: "session.state", sessionId: "x" });
      expect(useTetherStore.getState().reload.active).toBe(false);
      handleFrame({ kind: "session.state", sessionId: "x", plaintextMetadata: null });
      expect(useTetherStore.getState().reload.active).toBe(false);
    });
  });
});
