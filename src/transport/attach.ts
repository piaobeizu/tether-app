// Frontend bridge to the daemon attach socket.
//
// Wraps the `tether_attach_*` Tauri commands defined in
// src-tauri/src/attach/mod.rs. Surface stays small — `subscribe()`
// returns an `AttachSubscription` handle, `.dispose()` tears down.
//
// Protocol mirrored from `internal/agent/attach_socket.go`:
//   1. Open ~/.tether/attach.sock
//   2. Write JSON header line
//   3. First frame is `attach.ack` (mode confirmation)
//   4. Subsequent frames are LocalEnvelope JSON or `attach.lock-denied`
//
// Cancellability: dispose() calls tether_attach_unsubscribe and
// removes the Tauri event listeners. Idempotent.
//
// Errors → onState({ state: "error", error }). Reconnect policy lives
// at the call site (AppShell), not here.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AttachMode = "ro" | "rw";

export interface AttachClient {
  kind: string;
  deviceId: string;
}

export interface AttachOptions {
  /** Override the socket path. Default: ~/.tether/attach.sock */
  socketPath?: string;
  connectTimeoutMs?: number;
}

/** A frame received from the daemon. We expose the raw JSON text + a
 *  parsed-on-demand `body` getter so the consumer doesn't pay the
 *  parse cost twice. */
export interface AttachFrame {
  /** Raw JSON text (no leading length prefix). */
  json: string;
  /** Parsed JSON body. Throws on malformed JSON, but the Rust side
   *  validates JSON shape before emitting so this should not fire in
   *  practice. */
  body: unknown;
}

export type AttachStateValue = "connecting" | "connected" | "error" | "dropped";

export interface AttachStateEvent {
  state: AttachStateValue;
  /** Populated when state === "error". */
  error?: string;
}

export interface AttachSubscription {
  readonly id: string;
  /** Tear down the subscription. Idempotent. */
  dispose: () => Promise<void>;
}

interface SubscribeArgs {
  sessionId: string;
  mode: AttachMode;
  client: AttachClient;
  options?: AttachOptions;
  onFrame: (frame: AttachFrame) => void;
  onState: (event: AttachStateEvent) => void;
}

interface SubscribeRawFrameEvent {
  subscriptionId: string;
  json: string;
}

interface SubscribeRawStateEvent {
  subscriptionId: string;
  state: AttachStateValue;
  error?: string;
}

/**
 * Open an attach subscription against the local daemon. The returned
 * promise resolves once the Tauri command has issued the subscription
 * id; the actual connection completes asynchronously and is reported
 * via the `onState` callback.
 *
 * The caller MUST call `.dispose()` when done — otherwise the spawned
 * Rust task keeps the socket open until the app exits.
 */
export async function subscribe(
  args: SubscribeArgs,
): Promise<AttachSubscription> {
  // Set up listeners FIRST so we don't miss the initial "connecting"
  // event the Rust side emits before its tokio::spawn returns.
  const unlisteners: UnlistenFn[] = [];
  let disposed = false;
  let id: string | undefined;

  const matches = (sub: string): boolean => sub === id;

  unlisteners.push(
    await listen<SubscribeRawFrameEvent>("attach://frame", (e) => {
      if (!matches(e.payload.subscriptionId)) return;
      let body: unknown;
      try {
        body = JSON.parse(e.payload.json);
      } catch {
        // Should not happen — the Rust side validates JSON shape.
        // But if it does, surface as a parse error and drop the frame.
        args.onState({
          state: "error",
          error: `frame is not valid JSON: ${e.payload.json.slice(0, 80)}`,
        });
        return;
      }
      args.onFrame({ json: e.payload.json, body });
    }),
  );
  unlisteners.push(
    await listen<SubscribeRawStateEvent>("attach://state", (e) => {
      if (!matches(e.payload.subscriptionId)) return;
      args.onState({ state: e.payload.state, error: e.payload.error });
    }),
  );

  try {
    id = await invoke<string>("tether_attach_subscribe", {
      sessionId: args.sessionId,
      mode: args.mode,
      client: args.client,
      options: args.options ?? null,
    });
  } catch (e) {
    // Roll back listeners on a synchronous subscribe failure.
    for (const u of unlisteners) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    throw e;
  }

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    for (const u of unlisteners) {
      try {
        u();
      } catch {
        /* ignore — listener may have already auto-removed. */
      }
    }
    if (id !== undefined) {
      try {
        await invoke("tether_attach_unsubscribe", { subscriptionId: id });
      } catch {
        // The task may have already exited; unsubscribe is best-effort.
      }
    }
  };

  return { id: id!, dispose };
}

/**
 * Send a single user-input frame down an rw subscription. Throws if
 * the subscription was opened in ro mode or has already been disposed.
 */
export async function sendInput(
  subscription: AttachSubscription,
  bytes: Uint8Array,
): Promise<void> {
  await invoke("tether_attach_send_input", {
    subscriptionId: subscription.id,
    bytes: Array.from(bytes),
  });
}
