// AttachBridge — connects the React shell to the daemon's WebTransport
// (HTTP/3) endpoint via the WT slice #5 transport (`@/transport/wt-attach`).
//
// Spec: D-13 / D-21 / §11.Y.5 — desktop is the daemon's REMOTE client,
// even on the same machine. The same-machine UDS path (`@/transport/attach`
// + `tether_attach_*` Tauri commands) is preserved for the `tether attach`
// TUI scenario but is no longer used by the React shell.
//
// Mounts once near the top of AppShell. On mount:
//   1. If `attachSessionId` is empty → state = "idle" (user must enter
//      a sid in Settings → connection).
//   2. If no paired devices on this user → state = "needs-pair". The
//      user navigates to Pair from Settings → Connection ("Pair new
//      device") and re-enters this surface after the long-term key is
//      persisted.
//   3. Otherwise call `connectWtAttach()` with the daemon URL +
//      pinned-cert sha256 from the store, push state transitions into
//      the store, and pump envelopes into the chat / dag slices via
//      kind-dispatch (Phase 10, transport-agnostic).
//
// Reconnect: on `state === "error" | "dropped"` we schedule a 2s
// backoff, capped at MAX_RECONNECTS attempts. After the cap we leave
// the bridge in `no-daemon` state — the user clicks "reconnect" in the
// connection panel to retry.
//
// This component renders the AuthPrompt modal (PR #15) wired to the
// active WT control stream as the input sender; otherwise no UI.

import { useEffect, useRef, useState } from "react";
import { useTetherStore } from "@/store";
import { connectWtAttach, type WtAttachClient } from "@/transport/wt-attach";
import { isAuthToolRequest } from "@/transport/auth";
import {
  decodePayload,
  EnvelopeKind,
  extractAgentRole,
  extractAgentText,
  type LocalEnvelope,
} from "@/transport/envelope";
import { pairListDevices } from "@/transport/pair";
import { AuthPrompt, type InputSender } from "@/components/AuthPrompt";
import type { ChatMessage } from "@/store/types";

const RECONNECT_BACKOFF_MS = 2000;
const MAX_RECONNECTS = 5;

/** Pick the device id this app should advertise on the SessionIDHeader.
 *  v0.1 single-user (D-04) → just the first paired record's deviceId.
 *  When the registry returns empty, the caller stops in `needs-pair`
 *  state; this function returns `null` in that case so the caller can
 *  branch without re-running the call. */
async function pickPairedDeviceId(): Promise<string | null> {
  try {
    const list = await pairListDevices();
    if (!Array.isArray(list) || list.length === 0) return null;
    const first = list[0];
    return first?.deviceId ?? null;
  } catch {
    // Tauri runtime missing (vitest happy-dom without invoke mock) →
    // treat as "no paired devices yet". Tests that want WT to actually
    // fire mock the pair_list_devices invoke.
    return null;
  }
}

export function AttachBridge() {
  const sessionId = useTetherStore((s) => s.attachSessionId);
  const daemonUrl = useTetherStore((s) => s.daemonUrl);
  const pinnedCertSha256 = useTetherStore((s) => s.pinnedCertSha256);
  const reconnectTrigger = useTetherStore((s) => s.attachReconnectAttempt);
  const setAttachState = useTetherStore((s) => s.setAttachState);

  // Track the live WT client + retry counter across renders without
  // triggering re-renders. The effect below is the single owner.
  const clientRef = useRef<WtAttachClient | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Generation counter — bumped on every effect run so a late envelope
  // event from a previous run can be discarded.
  const genRef = useRef(0);
  // Mirror of clientRef into render state so <AuthPrompt /> can react
  // when the WT client comes online / drops. The exposed shape is just
  // the `sendInput` writer (an InputSender), not the full client.
  const [liveSender, setLiveSender] = useState<InputSender | null>(null);

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

      // Resolve the device id from the local pair registry BEFORE we
      // open WT — if no devices are paired, we stop in `needs-pair`
      // state. Reconnect / "I just paired" flow goes through the
      // manual triggerAttachReconnect() path, which re-runs this
      // effect.
      const deviceId = await pickPairedDeviceId();
      if (cancelled || myGen !== genRef.current) return;
      if (deviceId === null) {
        setAttachState(
          "needs-pair",
          "no paired devices — pair first from Settings → Connection",
        );
        return;
      }

      try {
        const client = await connectWtAttach({
          daemonUrl,
          sessionId,
          deviceId,
          pinnedCertSha256: pinnedCertSha256 || undefined,
          onEnvelope: (env) => {
            if (cancelled || myGen !== genRef.current) return;
            // The Rust `wt_recv_envelope` returns a DecryptedEnvelope
            // whose `body` is the daemon's wire-shape LocalEnvelope as
            // a UTF-8 JSON string. Parse → handleFrame so the existing
            // dispatch logic (PR #16, PR #15, PR #14) works unchanged.
            let frame: unknown;
            try {
              frame = JSON.parse(env.body);
            } catch {
              // Defensive — daemon should always emit valid JSON. Drop
              // and let the loop continue.
              return;
            }
            handleFrame(frame);
          },
          onState: (event) => {
            if (cancelled || myGen !== genRef.current) return;
            if (event.state === "connected") {
              retriesRef.current = 0;
              setAttachState("connected");
            } else if (event.state === "connecting") {
              setAttachState("connecting");
            } else if (event.state === "error") {
              setAttachState("error", event.error ?? "wt-attach error");
              scheduleReconnect();
            } else if (event.state === "dropped") {
              setAttachState("backoff-pending", "daemon dropped the WT session");
              scheduleReconnect();
            }
          },
        });
        if (cancelled || myGen !== genRef.current) {
          // Unmount race — drop the just-opened client.
          void client.dispose();
          return;
        }
        clientRef.current = client;
        setLiveSender(() => client.sendInput.bind(client));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // connectWtAttach reports the same failure via onState above
        // (so the banner already shows the right state); re-asserting
        // here is harmless and covers the path where the throw races
        // ahead of the onState callback (e.g. synchronous validation).
        setAttachState("error", `wt-attach connect: ${msg}`);
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
        // Tear the previous client FIRST so the new connect can reclaim
        // resources cleanly. Best-effort.
        if (clientRef.current) {
          const old = clientRef.current;
          clientRef.current = null;
          setLiveSender(null);
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
      const c = clientRef.current;
      clientRef.current = null;
      setLiveSender(null);
      if (c) void c.dispose();
    };
    // sessionId / daemonUrl / pinnedCertSha256 / reconnectTrigger are
    // the only inputs that should restart the bridge. setAttachState is
    // stable (zustand action).
  }, [sessionId, daemonUrl, pinnedCertSha256, reconnectTrigger, setAttachState]);

  return <AuthPrompt sender={liveSender} />;
}

/**
 * Handle a single attach frame body. Three responsibilities, in
 * priority order:
 *
 *   1. **Connection-state frames** — `attach.lock-denied` / `attach.ack`.
 *      These have a top-level `type` field (NOT `kind`) and are
 *      handled before the LocalEnvelope branch. Legacy from the UDS
 *      path; the WT daemon does not emit these today, but the
 *      classifier stays so the dispatcher remains transport-agnostic.
 *   2. **Auth prompts** — `auth.tool-request` envelopes are routed
 *      into the auth-prompt slice for <AuthPrompt /> to render.
 *   3. **LocalEnvelope dispatch** (Phase 10) — `output.agent-event` →
 *      ChatMessage{from:"ai"}, `output.hook-event` →
 *      ChatMessage{from:"system"} announcing the hook name,
 *      `session.state` → reload-banner state machine.
 *
 * Reload signal — see also `setReloading` in the store. We treat a
 * `session.state` envelope whose `plaintextMetadata.recordType` is
 * `"system"` as the proxy for "the cc subprocess just (re)started":
 * after `Session.Recover` re-spawns cc, the next prompt drives a fresh
 * `system` JSONL record into the watcher → mapper → wire pipeline. We
 * use that as the closest approximation of "reload happening" until
 * the daemon emits an explicit `session.reloading` envelope (tracked
 * as a follow-up). Any subsequent envelope of a different kind
 * (`output.agent-event` or `output.hook-event`) means agent work has
 * resumed → clear the banner. The store also arms a 30s safety
 * timeout so the UI never wedges if no clearing event arrives.
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
  // Validate `kind` is a non-empty string — defensive against malformed
  // frames from a bad daemon build, and required for the type narrowing
  // below.
  const kind = (body as { kind?: unknown }).kind;
  if (typeof kind !== "string") return;
  // From here on we treat the body as a LocalEnvelope. Field-level
  // narrowing happens in the per-kind helpers (extractAgentText etc.)
  // so a malformed payload degrades to "envelope dropped, banner not
  // updated" rather than throwing.
  const env = body as LocalEnvelope;

  if (isReloadSignal(kind, env)) {
    useTetherStore.getState().setReloading(kind);
    return;
  }
  // Any other envelope kind (output.agent-event / output.hook-event /
  // session.state without a system recordType) means traffic resumed —
  // clear any in-flight reload banner. clearReloading is idempotent.
  if (
    kind === EnvelopeKind.AgentEvent ||
    kind === EnvelopeKind.HookEvent
  ) {
    useTetherStore.getState().clearReloading();
  }

  // -------- Phase 10: envelope → chat / DAG dispatch --------

  if (kind === EnvelopeKind.AgentEvent) {
    dispatchAgentEvent(env);
    return;
  }
  if (kind === EnvelopeKind.HookEvent) {
    dispatchHookEvent(env);
    return;
  }
  // session.state without a system recordType, and unknown kinds: no
  // chat / DAG side-effect today. The daemon may emit DAG-shaped
  // events in a future patch; until then we just no-op here (FOLLOW-UP
  // in the PR body). No console.log on the hot path.
}

/**
 * Append an `output.agent-event` envelope as a ChatMessage row.
 *
 * Payload shape — `ciphertextPayload` is base64-encoded JSON of the cc
 * `message` object: `{ role, content: [{ type, text? }, ...] }`.
 * See internal/cc/jsonl/mapper.go::mapEvent (line ~135 — sets
 * `payload = rec.Message`) and internal/cc/jsonl/record.go::Record.Message
 * for the wire-side source of truth.
 *
 * Pure tool_use turns (no `text` blocks) are intentionally dropped
 * here — surfacing them as empty bubbles is noisy. The DAG / fenced-
 * block layers will surface tool_use separately in a later phase.
 */
function dispatchAgentEvent(env: LocalEnvelope): void {
  const payload = decodePayload(env);
  const text = extractAgentText(payload);
  if (text === null) {
    // Tool-use-only assistant turn or undecodable payload — skip.
    return;
  }
  const role = extractAgentRole(env, payload);
  const from: ChatMessage["from"] = role === "user" ? "user" : "ai";
  // Stable id: prefer the cc record uuid (sourceUuid) so reconnect
  // replays are idempotent against the existing `appendChat` dedup.
  // Fall back to a synthetic id only when sourceUuid is missing
  // (defensive — the mapper always sets it for EVENT class).
  const id = env.sourceUuid ?? `evt-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  // Timestamp: the mapper stamps `plaintextMetadata.timestamp` with
  // the cc record's ISO-8601 timestamp. Fall back to "now" if missing.
  const t = formatEnvelopeTime(env);
  useTetherStore.getState().appendChat({ id, from, t, text });
}

/**
 * Append an `output.hook-event` envelope as a `from:"system"` row.
 *
 * v0.1 surfaces only the hook name + event so the user sees that a
 * hook fired without dumping the (potentially large) attachment
 * payload. Future phases may inline stdout / stderr previews.
 *
 * Payload shape — `plaintextMetadata = { uuid, hookEvent, hookName?,
 * toolUseID?, timestamp? }`. See internal/cc/jsonl/mapper.go::mapHook
 * (line ~165) for the source of truth.
 */
function dispatchHookEvent(env: LocalEnvelope): void {
  const meta = env.plaintextMetadata ?? {};
  const hookEvent = typeof meta.hookEvent === "string" ? meta.hookEvent : "";
  const hookName = typeof meta.hookName === "string" ? meta.hookName : "";
  // hookEvent is mandatory per the daemon-side classifier (an
  // attachment without hookEvent gets routed as STATE, not HOOK), so
  // its absence here would mean a malformed envelope. Skip rather
  // than render an empty system row.
  if (hookEvent === "") return;
  const display = hookName ? `${hookEvent} · ${hookName}` : hookEvent;
  const id = env.sourceUuid ?? `hook-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const t = formatEnvelopeTime(env);
  useTetherStore.getState().appendChat({
    id,
    from: "system",
    t,
    text: `hook: ${display}`,
  });
}

/** Format the envelope's `plaintextMetadata.timestamp` (cc ISO-8601)
 *  as the `HH:MM` string the chat renderer expects. Falls back to
 *  current wall-clock when the daemon didn't stamp the envelope. */
function formatEnvelopeTime(env: LocalEnvelope): string {
  const meta = env.plaintextMetadata;
  if (meta && typeof meta === "object") {
    const ts = (meta as { timestamp?: unknown }).timestamp;
    if (typeof ts === "string" && ts.length > 0) {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) return d.toTimeString().slice(0, 5);
    }
  }
  return new Date().toTimeString().slice(0, 5);
}

/** True when the envelope kind/payload pair indicates a session reload
 *  is in progress. Today: `session.state` + `recordType === "system"`.
 *  Encapsulated so a future explicit `session.reloading` envelope kind
 *  is a one-line change here. */
function isReloadSignal(kind: string, env: LocalEnvelope): boolean {
  if (kind !== EnvelopeKind.SessionState) return false;
  const meta = env.plaintextMetadata;
  if (!meta || typeof meta !== "object") return false;
  const recordType = (meta as { recordType?: unknown }).recordType;
  return recordType === "system";
}
