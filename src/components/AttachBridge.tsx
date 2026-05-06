// AttachBridge — connects the React shell to the local daemon attach
// socket via the `tether_attach_*` Tauri commands.
//
// Mounts once near the top of AppShell. On mount:
//   1. If `attachSessionId` is empty → state = "idle" (user must enter
//      a sid in Settings → connection).
//   2. Otherwise call `subscribe()`, push state transitions into the
//      store, and pump frames into the chat / dag slices via simple
//      kind-dispatch (v0.1: append a debug chat row per envelope; the
//      Phase-10 work will turn these into proper chat / dag updates).
//
// Reconnect: on `state === "error" | "dropped"` we schedule a 2s
// backoff, capped at MAX_RECONNECTS attempts. After the cap we leave
// the bridge in `no-daemon` state — the user clicks "reconnect" in the
// connection panel to retry.
//
// This component renders nothing — it is mount-only effect glue.

import { useEffect, useRef, useState } from "react";
import { useTetherStore } from "@/store";
import { subscribe, type AttachSubscription } from "@/transport/attach";
import { isAuthToolRequest } from "@/transport/auth";
import { AuthPrompt } from "@/components/AuthPrompt";

const RECONNECT_BACKOFF_MS = 2000;
const MAX_RECONNECTS = 5;

/** Stable per-app device id. We just persist a uuid in localStorage so
 *  the daemon's lock-attribution treats reconnects from this app as the
 *  same client.
 *
 *  Uses `crypto.randomUUID()` (cryptographically secure RNG, available
 *  in all Tauri webview targets — desktop WebView2/WKWebView and
 *  mobile WebView 78+) instead of `Math.random()` so two app installs
 *  are vanishingly unlikely to collide on a deviceId. Collisions
 *  would mis-attribute another user's lock to this app in the
 *  daemon's `lock.History` audit trail. */
const DEVICE_ID_STORAGE_KEY = "tether.attach.deviceId";

function generateDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `ui-app-${crypto.randomUUID()}`;
  }
  // Last-resort fallback for ancient runtimes (should never trigger
  // in any Tauri-supported target). Marked with a -fallback suffix so
  // it shows up in lock.History if anyone ever sees one.
  return `ui-app-fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function deviceId(): string {
  if (typeof window === "undefined") return "ui-app-headless";
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const fresh = generateDeviceId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return generateDeviceId();
  }
}

export function AttachBridge() {
  const sessionId = useTetherStore((s) => s.attachSessionId);
  const reconnectTrigger = useTetherStore((s) => s.attachReconnectAttempt);
  const setAttachState = useTetherStore((s) => s.setAttachState);

  // Track the live subscription + retry counter across renders without
  // triggering re-renders. The effect below is the single owner.
  const subRef = useRef<AttachSubscription | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Generation counter — bumped on every effect run so a late frame
  // event from a previous run can be discarded.
  const genRef = useRef(0);
  // Mirror of subRef into render state so <AuthPrompt /> can react when
  // the subscription comes online / drops. Updated via setLiveSub in the
  // effect alongside subRef.
  const [liveSub, setLiveSub] = useState<AttachSubscription | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setAttachState("idle");
      return;
    }

    let cancelled = false;
    const myGen = ++genRef.current;
    // Each effect run is a fresh attempt — reset the retry counter so
    // a manual reconnect after MAX_RECONNECTS exhausts the previous
    // generation's budget.
    retriesRef.current = 0;

    const tryConnect = async (): Promise<void> => {
      if (cancelled || myGen !== genRef.current) return;
      try {
        const sub = await subscribe({
          sessionId,
          // rw mode is required so auth.tool-decision frames can be
          // routed back via sendInput. The Rust bridge auto-downgrades
          // if the daemon refused; that's reflected in the ack message
          // handled in the state callback.
          mode: "rw",
          client: { kind: "terminal", deviceId: deviceId() },
          onFrame: (frame) => {
            if (cancelled || myGen !== genRef.current) return;
            handleFrame(frame.body);
          },
          onState: (event) => {
            if (cancelled || myGen !== genRef.current) return;
            if (event.state === "connected") {
              retriesRef.current = 0;
              setAttachState("connected");
            } else if (event.state === "connecting") {
              setAttachState("connecting");
            } else if (event.state === "error") {
              setAttachState("error", event.error ?? "attach error");
              scheduleReconnect();
            } else if (event.state === "dropped") {
              setAttachState("backoff-pending", "daemon dropped the connection");
              scheduleReconnect();
            }
          },
        });
        if (cancelled || myGen !== genRef.current) {
          // Unmount race — drop the just-opened subscription.
          void sub.dispose();
          return;
        }
        subRef.current = sub;
        setLiveSub(sub);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setAttachState("error", `subscribe failed: ${msg}`);
        scheduleReconnect();
      }
    };

    const scheduleReconnect = (): void => {
      if (cancelled || myGen !== genRef.current) return;
      if (reconnectTimerRef.current !== null) return; // already scheduled
      retriesRef.current += 1;
      if (retriesRef.current > MAX_RECONNECTS) {
        setAttachState(
          "no-daemon",
          `gave up after ${MAX_RECONNECTS} reconnect attempts — is the daemon running?`,
        );
        return;
      }
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        // Tear the previous handle FIRST so the new connect can reclaim
        // resources cleanly. Best-effort.
        if (subRef.current) {
          const old = subRef.current;
          subRef.current = null;
          setLiveSub(null);
          void old.dispose();
        }
        void tryConnect();
      }, RECONNECT_BACKOFF_MS);
    };

    void tryConnect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const sub = subRef.current;
      subRef.current = null;
      setLiveSub(null);
      if (sub) void sub.dispose();
    };
    // sessionId / reconnectTrigger are the only inputs that should
    // restart the bridge. setAttachState is stable (zustand action).
  }, [sessionId, reconnectTrigger, setAttachState]);

  return <AuthPrompt subscription={liveSub} />;
}

/**
 * Handle a single attach frame body. v0.1: classifies the frame type
 * for the connection-state machine + dispatches auth.tool-request
 * envelopes into the auth-prompt slice. Phase 10 will route the rest
 * of the LocalEnvelope kinds into chat / DAG.
 *
 * Reload signal — see also `setReloading` in the store. We treat a
 * `session.state` envelope whose `plaintextMetadata.recordType` is
 * `"system"` as the proxy for "the cc subprocess just (re)started":
 * after `Session.Recover` re-spawns cc, the next prompt drives a fresh
 * `system` JSONL record into the watcher → mapper → attach socket
 * pipeline. We use that as the closest approximation of "reload
 * happening" until the daemon emits an explicit `session.reloading`
 * envelope (tracked as a follow-up). Any subsequent envelope of a
 * different kind (`output.agent-event` or `output.hook-event`) means
 * agent work has resumed → clear the banner. The store also arms a
 * 30s safety timeout so the UI never wedges if no clearing event
 * arrives.
 *
 * Exported for tests.
 */
export function handleFrame(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const type = (body as { type?: unknown }).type;
  if (type === "attach.lock-denied") {
    // The daemon's lock is held by another client — surface as a
    // banner. v0.1: the bridge is read-only so this should not fire,
    // but lock the UX surface in case a future rw call is gated.
    useTetherStore.getState().setAttachState(
      "error",
      "lock-denied: another client holds the writer lock",
    );
    return;
  }
  if (type === "attach.ack") {
    // Already handled via the state callback's "connected" transition.
    return;
  }
  // Auth tool authorization request — push into the prompt queue. The
  // <AuthPrompt /> component reads pendingAuthRequest from the store
  // and renders the modal.
  if (isAuthToolRequest(body)) {
    const meta = body.plaintextMetadata;
    useTetherStore.getState().pushAuthRequest({
      requestId: meta.requestId,
      toolName: meta.toolName,
      toolInput: meta.toolInput,
      summary: meta.summary,
      sessionId: body.sessionId,
    });
    return;
  }

  // LocalEnvelope shape (kind / sessionId / plaintextMetadata / payload).
  const kind = (body as { kind?: unknown }).kind;
  if (typeof kind !== "string") return;

  if (isReloadSignal(kind, body)) {
    useTetherStore.getState().setReloading(kind);
    return;
  }
  // Any other envelope kind (output.agent-event / output.hook-event /
  // session.state without a system recordType) means traffic resumed —
  // clear any in-flight reload banner. clearReloading is idempotent.
  if (kind === "output.agent-event" || kind === "output.hook-event") {
    useTetherStore.getState().clearReloading();
  }
  // (Intentionally no console.log on the hot path — production builds
  // shouldn't spam the devtools console with envelope traffic.)
}

/** True when the envelope kind/payload pair indicates a session reload
 *  is in progress. Today: `session.state` + `recordType === "system"`.
 *  Encapsulated so a future explicit `session.reloading` envelope kind
 *  is a one-line change here. */
function isReloadSignal(kind: string, body: unknown): boolean {
  if (kind !== "session.state") return false;
  const meta = (body as { plaintextMetadata?: unknown }).plaintextMetadata;
  if (!meta || typeof meta !== "object") return false;
  const recordType = (meta as { recordType?: unknown }).recordType;
  return recordType === "system";
}
