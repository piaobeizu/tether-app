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

  it("is null-safe", () => {
    handleFrame(null);
    handleFrame(undefined);
    handleFrame("string");
    handleFrame(42);
    expect(useTetherStore.getState().attachState).toBe("idle");
  });
});
