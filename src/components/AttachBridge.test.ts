// AttachBridge — frame dispatcher unit tests. The full subscribe()
// effect is exercised end-to-end against the real Rust side (cargo
// test -p tether-app); here we just lock in the pure body
// classification path.

import { describe, expect, it, beforeEach, vi } from "vitest";
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

  it("LocalEnvelope frames don't perturb attach-state (handled by chat / DAG dispatch)", () => {
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

  // -------- Phase 10: envelope → chat / DAG dispatch --------

  describe("envelope → chat dispatch (Phase 10)", () => {
    /** Build a base64-encoded JSON `message` payload mirroring the
     *  daemon-side mapEvent() (internal/cc/jsonl/mapper.go) which
     *  copies cc's `message` JSON verbatim into ciphertextPayload. */
    const encodePayload = (obj: unknown): string => {
      const json = JSON.stringify(obj);
      // happy-dom + jsdom + node all expose btoa. For non-ASCII we
      // would need a TextEncoder hop, but the test corpus is ASCII.
      return btoa(json);
    };

    beforeEach(() => {
      // Reset the chat array so length deltas are deterministic. We
      // also clear attachState since some assertions read it.
      useTetherStore.setState({ chat: [] });
    });

    it("output.agent-event with a text content block appends an ai chat row", () => {
      handleFrame({
        kind: "output.agent-event",
        sessionId: "sess-1",
        providerType: "claude-code",
        sourceUuid: "evt-1",
        plaintextMetadata: { uuid: "evt-1", role: "assistant" },
        ciphertextPayload: encodePayload({
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
        }),
      });
      const chat = useTetherStore.getState().chat;
      expect(chat).toHaveLength(1);
      expect(chat[0]?.from).toBe("ai");
      expect(chat[0]?.text).toBe("hi");
      expect(chat[0]?.id).toBe("evt-1");
    });

    it("output.agent-event joins multiple text content blocks", () => {
      handleFrame({
        kind: "output.agent-event",
        sessionId: "sess-1",
        providerType: "claude-code",
        sourceUuid: "evt-multi",
        plaintextMetadata: { uuid: "evt-multi", role: "assistant" },
        ciphertextPayload: encodePayload({
          role: "assistant",
          content: [
            { type: "text", text: "first" },
            { type: "tool_use", id: "t1", name: "Bash" },
            { type: "text", text: "second" },
          ],
        }),
      });
      const chat = useTetherStore.getState().chat;
      expect(chat).toHaveLength(1);
      expect(chat[0]?.text).toBe("first\nsecond");
    });

    it("output.agent-event with only tool_use (no text) is dropped", () => {
      handleFrame({
        kind: "output.agent-event",
        sessionId: "sess-1",
        providerType: "claude-code",
        sourceUuid: "evt-pure-tool",
        plaintextMetadata: { uuid: "evt-pure-tool", role: "assistant" },
        ciphertextPayload: encodePayload({
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Read" }],
        }),
      });
      expect(useTetherStore.getState().chat).toHaveLength(0);
    });

    it("output.agent-event from user role appends a user chat row", () => {
      handleFrame({
        kind: "output.agent-event",
        sessionId: "sess-1",
        providerType: "claude-code",
        sourceUuid: "evt-user-1",
        plaintextMetadata: { uuid: "evt-user-1", role: "user" },
        ciphertextPayload: encodePayload({
          role: "user",
          content: [{ type: "text", text: "hello there" }],
        }),
      });
      const chat = useTetherStore.getState().chat;
      expect(chat).toHaveLength(1);
      expect(chat[0]?.from).toBe("user");
      expect(chat[0]?.text).toBe("hello there");
    });

    it("output.agent-event with the same sourceUuid is deduplicated", () => {
      const env = {
        kind: "output.agent-event",
        sessionId: "sess-1",
        providerType: "claude-code",
        sourceUuid: "dup-1",
        plaintextMetadata: { uuid: "dup-1", role: "assistant" },
        ciphertextPayload: encodePayload({
          role: "assistant",
          content: [{ type: "text", text: "once" }],
        }),
      };
      handleFrame(env);
      handleFrame(env); // replay (e.g. reconnect catch-up)
      expect(useTetherStore.getState().chat).toHaveLength(1);
    });

    it("output.hook-event appends a from:'system' row with the hook name", () => {
      handleFrame({
        kind: "output.hook-event",
        sessionId: "sess-1",
        providerType: "claude-code",
        sourceUuid: "hook-1",
        plaintextMetadata: {
          uuid: "hook-1",
          hookEvent: "PreToolUse",
          hookName: "PreToolUse:Read",
        },
      });
      const chat = useTetherStore.getState().chat;
      expect(chat).toHaveLength(1);
      expect(chat[0]?.from).toBe("system");
      expect(chat[0]?.text).toContain("PreToolUse");
      expect(chat[0]?.text).toContain("PreToolUse:Read");
    });

    it("output.hook-event without hookEvent is dropped", () => {
      handleFrame({
        kind: "output.hook-event",
        sessionId: "sess-1",
        providerType: "claude-code",
        plaintextMetadata: { uuid: "broken" },
      });
      expect(useTetherStore.getState().chat).toHaveLength(0);
    });

    it("malformed ciphertextPayload (bad base64) drops silently", () => {
      handleFrame({
        kind: "output.agent-event",
        sessionId: "sess-1",
        providerType: "claude-code",
        sourceUuid: "evt-bad",
        plaintextMetadata: { uuid: "evt-bad", role: "assistant" },
        ciphertextPayload: "@@@not-base64@@@",
      });
      expect(useTetherStore.getState().chat).toHaveLength(0);
    });

    it("envelope-stamped timestamp is rendered as HH:MM", () => {
      handleFrame({
        kind: "output.agent-event",
        sessionId: "sess-1",
        providerType: "claude-code",
        sourceUuid: "evt-ts",
        plaintextMetadata: {
          uuid: "evt-ts",
          role: "assistant",
          timestamp: "2026-05-06T09:23:45.000Z",
        },
        ciphertextPayload: encodePayload({
          role: "assistant",
          content: [{ type: "text", text: "ts test" }],
        }),
      });
      const t = useTetherStore.getState().chat[0]?.t ?? "";
      // Don't lock to a TZ-specific value — just assert HH:MM shape.
      expect(t).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  describe("mock-chatter gating on attachState (Phase 10)", () => {
    beforeEach(() => {
      useTetherStore.setState({ chat: [] });
      useTetherStore.getState().setAttachState("idle");
    });

    it("_advanceDag is a no-op when attachState === 'connected'", () => {
      // Seed a running DAG so the ticker would otherwise advance it.
      useTetherStore.setState({
        route: "home",
        dag: {
          paused: false,
          elapsedMs: 0,
          nodes: [
            { id: "n1", label: "a", status: "running", ms: null },
            { id: "n2", label: "b", status: "queued", ms: null },
          ],
        },
      });
      useTetherStore.getState().setAttachState("connected");
      const before = useTetherStore.getState().dag;
      // Run many ticks — none should mutate when connected (the
      // mock advance has a 15% chance per tick so a single tick may
      // be a no-op anyway; here we test that the early-return fires
      // BEFORE the elapsedMs increment).
      for (let i = 0; i < 100; i++) {
        useTetherStore.getState()._advanceDag();
      }
      const after = useTetherStore.getState().dag;
      expect(after).toBe(before); // identity preserved → no set() at all
    });

    it("_advanceDag resumes when attachState drops back below 'connected'", () => {
      useTetherStore.setState({
        route: "home",
        dag: {
          paused: false,
          elapsedMs: 0,
          nodes: [
            { id: "n1", label: "a", status: "running", ms: null },
            { id: "n2", label: "b", status: "queued", ms: null },
          ],
        },
      });
      useTetherStore.getState().setAttachState("connected");
      useTetherStore.getState()._advanceDag();
      expect(useTetherStore.getState().dag.elapsedMs).toBe(0);
      useTetherStore.getState().setAttachState("idle");
      useTetherStore.getState()._advanceDag();
      // Now elapsed must have ticked up by 1000ms (mock fall-through).
      expect(useTetherStore.getState().dag.elapsedMs).toBe(1000);
    });

    it("sendMessage skips the mock AI reply when attachState === 'connected'", () => {
      vi.useFakeTimers();
      try {
        useTetherStore.getState().setAttachState("connected");
        useTetherStore.getState().sendMessage("hi");
        expect(useTetherStore.getState().chat).toHaveLength(1);
        expect(useTetherStore.getState().chat[0]?.from).toBe("user");
        // No mock AI reply should be queued.
        vi.advanceTimersByTime(2000);
        expect(useTetherStore.getState().chat).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("sendMessage still posts the mock AI reply when disconnected (dev fallback)", () => {
      vi.useFakeTimers();
      try {
        useTetherStore.getState().setAttachState("idle");
        useTetherStore.getState().sendMessage("hi");
        expect(useTetherStore.getState().chat).toHaveLength(1);
        vi.advanceTimersByTime(900);
        expect(useTetherStore.getState().chat).toHaveLength(2);
        expect(useTetherStore.getState().chat[1]?.from).toBe("ai");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
