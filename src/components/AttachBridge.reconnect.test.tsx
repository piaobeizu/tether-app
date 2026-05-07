// AttachBridge — reconnect loop + lifecycle tests.
//
// The pure frame dispatcher tests live in AttachBridge.test.ts. This
// file is the COVERAGE the original PR was missing: it exercises the
// effect path that mounts the subscription, schedules the 2s backoff
// retry, caps at MAX_RECONNECTS, and resets the budget on a manual
// `triggerAttachReconnect()` call.
//
// Slice #5 / D-21 retrofit — the bridge now goes over WT, not UDS.
// Mocks updated:
//   - `@/transport/wt-attach::connectWtAttach` is the new transport
//     entrypoint (was `@/transport/attach::subscribe`)
//   - `@/transport/pair::pairListDevices` must return at least one
//     paired device or AttachBridge stops at `needs-pair` and never
//     calls connectWtAttach. Tests that want the WT path to fire stub
//     this with a single device.
//
// The state-machine semantics (state values, retry budget, generation
// counter) are unchanged — the swap is transport-only.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { act } from "react";

import type { AttachStateEvent } from "@/transport/attach";
import type { WtAttachClient } from "@/transport/wt-attach";

vi.mock("@/transport/wt-attach", () => {
  return {
    connectWtAttach: vi.fn(),
  };
});

vi.mock("@/transport/pair", () => {
  return {
    pairListDevices: vi.fn(async () => [
      // Default: one paired device so AttachBridge proceeds past the
      // needs-pair gate. Tests that want the unpaired path override
      // via mockResolvedValueOnce([]).
      { deviceId: "test-device-1", displayName: "test", pairedAt: 0 },
    ]),
  };
});

// Import AFTER the mocks so the component picks up the mocked modules.
// eslint-disable-next-line import/first
import { AttachBridge } from "./AttachBridge";
// eslint-disable-next-line import/first
import { useTetherStore } from "@/store";
// eslint-disable-next-line import/first
import * as wtTransport from "@/transport/wt-attach";

const connectMock = wtTransport.connectWtAttach as ReturnType<typeof vi.fn>;

interface FakeWtSub {
  /** Push a state transition into the consumer's onState callback. */
  fireState: (e: AttachStateEvent) => void;
  /** The mock client returned to AttachBridge — its `dispose` is a vi.fn. */
  client: WtAttachClient;
}

/**
 * Build a fake `connectWtAttach()` implementation. Each call captures
 * the consumer's onState callback so the test can drive transitions
 * deterministically. Returns a list that grows as AttachBridge calls
 * connectWtAttach (initial connect + each retry).
 */
function makeConnectStub() {
  const subs: FakeWtSub[] = [];
  connectMock.mockImplementation(
    async (args: { onState: (e: AttachStateEvent) => void }) => {
      const consumerOnState = args.onState;
      const client: WtAttachClient = {
        dispose: vi.fn(async () => {}),
        sendInput: vi.fn(async (_b: Uint8Array) => {}),
      };
      const sub: FakeWtSub = {
        client,
        fireState: (e) => consumerOnState(e),
      };
      subs.push(sub);
      return client;
    },
  );
  return subs;
}

function setSession(sid: string): void {
  useTetherStore.setState({
    attachSessionId: sid,
    attachReconnectAttempt: 0,
    daemonUrl: "https://test:4444",
    pinnedCertSha256: "",
  });
}

describe("AttachBridge — reconnect lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    connectMock.mockReset();
    useTetherStore.setState({
      attachSessionId: "",
      attachReconnectAttempt: 0,
      attachState: "idle",
      attachError: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("idle when no sessionId is set", async () => {
    setSession("");
    render(<AttachBridge />);
    // Effect runs synchronously on mount, but connectWtAttach is
    // skipped — store stays at "idle".
    expect(connectMock).not.toHaveBeenCalled();
    expect(useTetherStore.getState().attachState).toBe("idle");
  });

  it("transitions to backoff-pending on dropped, then schedules retry", async () => {
    const subs = makeConnectStub();
    setSession("sid-1");
    render(<AttachBridge />);

    // Wait for connectWtAttach() + pickPairedDeviceId() to resolve.
    // The pair-list mock returns synchronously but goes through a
    // microtask, so a runOnlyPendingTimersAsync + waitFor handles it.
    await vi.runOnlyPendingTimersAsync();
    await vi.waitFor(() => expect(subs.length).toBe(1));

    // Drive the state machine: connecting -> connected.
    act(() => {
      subs[0]!.fireState({ state: "connecting" });
    });
    expect(useTetherStore.getState().attachState).toBe("connecting");
    act(() => {
      subs[0]!.fireState({ state: "connected" });
    });
    expect(useTetherStore.getState().attachState).toBe("connected");

    // Daemon drops the connection — bridge must transition to
    // backoff-pending (NOT "reconnecting", which is reserved for
    // user-clicked retries).
    act(() => {
      subs[0]!.fireState({ state: "dropped" });
    });
    expect(useTetherStore.getState().attachState).toBe("backoff-pending");
    expect(useTetherStore.getState().attachError).toMatch(/daemon dropped/);

    // After 2s, a new connectWtAttach() call should fire (retry attempt 1).
    expect(subs.length).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await vi.waitFor(() => expect(subs.length).toBe(2));
  });

  it("caps at MAX_RECONNECTS attempts → no-daemon", async () => {
    const subs = makeConnectStub();
    setSession("sid-2");
    render(<AttachBridge />);

    await vi.runOnlyPendingTimersAsync();
    await vi.waitFor(() => expect(subs.length).toBe(1));

    // Drive 5 retries — each one fires a "dropped" then advances 2s.
    // After the 5th, the next dropped should hit the no-daemon cap.
    for (let i = 0; i < 5; i++) {
      act(() => subs[i]!.fireState({ state: "dropped" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await vi.waitFor(() => expect(subs.length).toBe(i + 2));
    }

    // The 6th drop is over budget — bridge should transition to
    // no-daemon and NOT call connectWtAttach again even after another 2s.
    act(() => subs[5]!.fireState({ state: "dropped" }));
    expect(useTetherStore.getState().attachState).toBe("no-daemon");
    expect(useTetherStore.getState().attachError).toMatch(/gave up after 5/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(subs.length).toBe(6); // no further connect
  });

  it("manual triggerAttachReconnect resets the retry budget", async () => {
    const subs = makeConnectStub();
    setSession("sid-3");
    render(<AttachBridge />);

    await vi.runOnlyPendingTimersAsync();
    await vi.waitFor(() => expect(subs.length).toBe(1));

    // Burn the auto-retry budget.
    for (let i = 0; i < 5; i++) {
      act(() => subs[i]!.fireState({ state: "dropped" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await vi.waitFor(() => expect(subs.length).toBe(i + 2));
    }
    act(() => subs[5]!.fireState({ state: "dropped" }));
    expect(useTetherStore.getState().attachState).toBe("no-daemon");

    // User clicks reconnect → bumps attachReconnectAttempt.
    act(() => {
      useTetherStore.getState().triggerAttachReconnect();
    });
    // Effect re-runs on the dep change → fresh connectWtAttach call →
    // store transitions to "reconnecting" (manual) and a new sub appears.
    await vi.runOnlyPendingTimersAsync();
    await vi.waitFor(() => expect(subs.length).toBe(7));
  });

  it("M2: pairListDevices throw is surfaced as 'error' state, not 'needs-pair'", async () => {
    // Pre-fix, AttachBridge mapped (a) Tauri runtime missing, (b) empty
    // list, (c) pairListDevices throwing ALL to needs-pair "no paired
    // devices". A transient Tauri-bridge error therefore lied to the
    // user — they'd be told to re-pair when their pairing was fine.
    const subs = makeConnectStub();
    const pairTransport = await import("@/transport/pair");
    const listMock = pairTransport.pairListDevices as ReturnType<typeof vi.fn>;
    listMock.mockRejectedValueOnce(new Error("boom: invoke unavailable"));

    setSession("sid-tauri-error");
    render(<AttachBridge />);

    await vi.runOnlyPendingTimersAsync();
    await vi.waitFor(() => {
      const s = useTetherStore.getState();
      expect(s.attachState).toBe("error");
    });
    const s = useTetherStore.getState();
    expect(s.attachError).toMatch(/Tauri runtime unavailable/);
    expect(s.attachError).toMatch(/boom: invoke unavailable/);
    // No WT connect should have been attempted.
    expect(subs.length).toBe(0);
  });

  it("M2: pairListDevices empty array still maps to 'needs-pair'", async () => {
    const subs = makeConnectStub();
    const pairTransport = await import("@/transport/pair");
    const listMock = pairTransport.pairListDevices as ReturnType<typeof vi.fn>;
    listMock.mockResolvedValueOnce([]);

    setSession("sid-empty-pair");
    render(<AttachBridge />);

    await vi.runOnlyPendingTimersAsync();
    await vi.waitFor(() => {
      expect(useTetherStore.getState().attachState).toBe("needs-pair");
    });
    expect(subs.length).toBe(0);
  });

  it("dispose() runs on unmount before any in-flight retry fires", async () => {
    const subs = makeConnectStub();
    setSession("sid-4");
    const { unmount } = render(<AttachBridge />);

    await vi.runOnlyPendingTimersAsync();
    await vi.waitFor(() => expect(subs.length).toBe(1));

    act(() => subs[0]!.fireState({ state: "connected" }));
    act(() => subs[0]!.fireState({ state: "dropped" }));

    // Unmount BEFORE the 2s retry timer fires — the cleanup must
    // clear the timer so no new connectWtAttach call sneaks through.
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(subs.length).toBe(1);
    // dispose() was called on the original WT client.
    expect(subs[0]!.client.dispose).toHaveBeenCalled();
  });
});
