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

  it("ignores LocalEnvelope frames (Phase 10 will route)", () => {
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
});
