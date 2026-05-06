// AttachBridge — reconnect loop + lifecycle tests.
//
// The pure frame dispatcher tests live in AttachBridge.test.ts. This
// file is the COVERAGE the original PR was missing: it exercises the
// effect path that mounts the subscription, schedules the 2s backoff
// retry, caps at MAX_RECONNECTS, and resets the budget on a manual
// `triggerAttachReconnect()` call.
//
// Strategy: mock `@/transport/attach::subscribe` so we can drive the
// state callbacks deterministically (no real Tauri host needed), then
// assert the store's `attachState` transitions match the documented
// state machine in store/types.ts.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { act } from "react";

import type {
  AttachStateEvent,
  AttachSubscription,
} from "@/transport/attach";

vi.mock("@/transport/attach", () => {
  return {
    subscribe: vi.fn(),
  };
});

// Import AFTER the mock so the component picks up the mocked module.
// eslint-disable-next-line import/first
import { AttachBridge } from "./AttachBridge";
// eslint-disable-next-line import/first
import { useTetherStore } from "@/store";
// eslint-disable-next-line import/first
import * as transport from "@/transport/attach";

const subscribeMock = transport.subscribe as ReturnType<typeof vi.fn>;

interface FakeSub extends AttachSubscription {
  /** Push a state transition into the consumer's onState callback. */
  fireState: (e: AttachStateEvent) => void;
}

/**
 * Build a fake subscribe() result. Each call captures the consumer's
 * onState callback so the test can drive transitions deterministically.
 */
function makeSubscribeStub() {
  const subs: FakeSub[] = [];
  subscribeMock.mockImplementation(async (args: { onState: (e: AttachStateEvent) => void }) => {
    let consumerOnState = args.onState;
    const sub: FakeSub = {
      id: `fake-${subs.length + 1}`,
      dispose: vi.fn(async () => {}),
      fireState: (e) => consumerOnState(e),
    };
    subs.push(sub);
    return sub;
  });
  return subs;
}

function setSession(sid: string): void {
  useTetherStore.setState({ attachSessionId: sid, attachReconnectAttempt: 0 });
}

describe("AttachBridge — reconnect lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    subscribeMock.mockReset();
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
    // Effect runs synchronously on mount, but the `subscribe()` path is
    // skipped — store stays at "idle", and we never call subscribe.
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(useTetherStore.getState().attachState).toBe("idle");
  });

  it("transitions to backoff-pending on dropped, then schedules retry", async () => {
    const subs = makeSubscribeStub();
    setSession("sid-1");
    render(<AttachBridge />);

    // Wait for the async subscribe() to resolve.
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

    // After 2s, a new subscribe() call should fire (retry attempt 1).
    expect(subs.length).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await vi.waitFor(() => expect(subs.length).toBe(2));
  });

  it("caps at MAX_RECONNECTS attempts → no-daemon", async () => {
    const subs = makeSubscribeStub();
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
    // no-daemon and NOT call subscribe again even after another 2s.
    act(() => subs[5]!.fireState({ state: "dropped" }));
    expect(useTetherStore.getState().attachState).toBe("no-daemon");
    expect(useTetherStore.getState().attachError).toMatch(/gave up after 5/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(subs.length).toBe(6); // no further subscribe
  });

  it("manual triggerAttachReconnect resets the retry budget", async () => {
    const subs = makeSubscribeStub();
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
    // Effect re-runs on the dep change → fresh subscribe → store
    // transitions to "reconnecting" (manual) and a new sub appears.
    await vi.runOnlyPendingTimersAsync();
    await vi.waitFor(() => expect(subs.length).toBe(7));
  });

  it("dispose() runs on unmount before any in-flight retry fires", async () => {
    const subs = makeSubscribeStub();
    setSession("sid-4");
    const { unmount } = render(<AttachBridge />);

    await vi.runOnlyPendingTimersAsync();
    await vi.waitFor(() => expect(subs.length).toBe(1));

    act(() => subs[0]!.fireState({ state: "connected" }));
    act(() => subs[0]!.fireState({ state: "dropped" }));

    // Unmount BEFORE the 2s retry timer fires — the cleanup must
    // clear the timer so no new subscribe call sneaks through.
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(subs.length).toBe(1);
    // dispose() was called on the original sub.
    expect(subs[0]!.dispose).toHaveBeenCalled();
  });
});
