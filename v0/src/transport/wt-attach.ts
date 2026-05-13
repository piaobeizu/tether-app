// WT-backed attach client. Cross-network sibling of `attach.ts`.
//
// Per spec D-13 / D-21 / §11.Y.5: the desktop app is the daemon's
// REMOTE client and ALWAYS reaches the daemon over WebTransport-over-
// HTTP/3. The same-machine UDS path (`attach.ts`) is preserved for the
// `tether attach` TUI scenario (SSH-into-VM) but is no longer used by
// the React shell.
//
// Wire stages, in order:
//   1. `wt_connect(daemonUrl, { pinnedCertSha256 })` → SessionId
//   2. `wt_open_bidi(sessionId, channelId=0x01)` → control stream
//   3. Write a single SessionIDHeader JSON line on control:
//        `{"sessionId":"<cc-sid>","deviceId":"<paired-device-id>"}\n`
//      Cross-cutover contract with the parallel `daemon-pair-glue` PR
//      on the tether repo — daemon falls back to DevSharedKey when
//      `deviceId` is missing/empty for back-compat with legacy peers.
//   4. `wt_open_bidi(sessionId, channelId=0x02)` → events stream
//   5. Loop: `wt_recv_envelope(sessionId, eventsStreamId)` →
//      DecryptedEnvelope → onEnvelope.
//
// `dispose()` closes the WT session (`wt_close`) and cancels the recv
// loop. Idempotent.
//
// This module is INTENTIONALLY transport-only — reconnect / generation
// / mount-once policy lives in the call site (`AttachBridge.tsx`). The
// surface mirrors `attach.ts::subscribe()` so the bridge component
// only swaps the import and parameter names, not its retry shape.

import { wt } from "./client";
import type { DecryptedEnvelope, WtSession, WtStream } from "./types";
import { TetherWtError } from "./errors";
import type { AttachStateEvent, AttachStateValue } from "./attach";

/** Channel-id constants per spec §3.3.3 (1-byte stream prefix). */
export const CHANNEL_ID_CONTROL = 0x01;
export const CHANNEL_ID_EVENTS = 0x02;

/**
 * Header line written on the control stream. Cross-repo contract — the
 * daemon's `internal/agent/wt_listener.go::SessionIDHeader` parses this
 * exact JSON shape (camelCase keys, ASCII strings, terminated by '\n').
 *
 * `deviceId` is OPTIONAL on the wire. When absent or empty the daemon
 * falls back to the v0.1 dev shared key for back-compat with pre-pair
 * peers; the parallel `daemon-pair-glue` subagent is teaching the
 * daemon to look up the per-device long-term key when present.
 */
export interface SessionIDHeader {
  sessionId: string;
  deviceId: string;
}

export interface ConnectWtAttachArgs {
  /** Daemon WT URL — e.g. "https://localhost:4444". */
  daemonUrl: string;
  /** cc session id this attach is bound to. Used by the daemon to
   *  route inbound envelopes and by `wt_recv_envelope` for the AEAD
   *  AD construction. */
  sessionId: string;
  /** Local device id from the pair registry. v0.1 single-user picks
   *  the first paired device; pre-pair fall-back uses "default" (which
   *  the daemon resolves to its DevSharedKey). */
  deviceId: string;
  /** Hex-encoded sha256 of the daemon's leaf cert. Empty / undefined
   *  means "use OS trust store" (production). Operator-set in dev for
   *  self-signed certs. */
  pinnedCertSha256?: string;
  /** Per-envelope callback. Always invoked from the recv loop in the
   *  Tauri Rust task that owns the events stream. */
  onEnvelope: (env: DecryptedEnvelope) => void;
  /** Lifecycle transitions — mirrors `attach.ts::AttachStateEvent` so
   *  the bridge component's state-machine code is transport-agnostic. */
  onState: (e: AttachStateEvent) => void;
}

export interface WtAttachClient {
  /** Tear down the WT session + stop the recv loop. Idempotent. */
  dispose(): Promise<void>;
  /**
   * Send an input frame back to the daemon over the control stream
   * (channel-id 0x01). Rough analog of `attach.ts::sendInput()` for
   * the WT path — used by the auth-prompt slice to ship
   * `auth.tool-decision` frames. Frames are length-delimited only by
   * a trailing newline (matches the SessionIDHeader convention); the
   * daemon's WT listener routes by the frame's `type` field.
   *
   * Throws after `dispose()` (control stream closed).
   */
  sendInput(bytes: Uint8Array): Promise<void>;
}

/**
 * Open a WT-backed attach session. Returns once the events recv loop
 * has been spawned. The caller is responsible for the reconnect /
 * generation-counter / unmount-race policy — this layer only owns the
 * session + streams + recv loop.
 *
 * Failure handling: any of the 4 setup stages throwing will surface
 * via `onState({ state: "error", ... })` AND reject the returned
 * promise. Callers MUST tolerate both reporting paths (one for
 * setup-time, one for runtime-during-recv).
 */
export async function connectWtAttach(
  args: ConnectWtAttachArgs,
): Promise<WtAttachClient> {
  args.onState({ state: "connecting" });

  let session: WtSession | null = null;
  let control: WtStream | null = null;
  let events: WtStream | null = null;

  // Normalize the pin: store layer keeps the user's verbatim hex; the
  // wt client accepts string[]. Empty / blank → undefined (= OS trust).
  const pinned = (args.pinnedCertSha256 ?? "").trim();
  const pinnedList = pinned.length > 0 ? [pinned] : undefined;

  // Fetch a short-lived WT ticket via HTTP (which carries the session cookie).
  // Chrome's WebTransport CONNECT does not send cookies, so the ticket is
  // passed as ?ticket= in the WT URL instead.
  let wtUrl: string;
  try {
    const ticketBase = new URL(args.daemonUrl);
    ticketBase.pathname = "/api/v1/auth/wt-ticket";
    ticketBase.search = "";
    const ticketRes = await fetch(ticketBase.toString(), { method: "POST" });
    if (!ticketRes.ok) {
      throw new TetherWtError(
        "wt-ticket",
        `ticket fetch failed: ${ticketRes.status}`,
      );
    }
    const { ticket } = (await ticketRes.json()) as { ticket: string };
    const wtUrlObj = new URL(args.daemonUrl);
    wtUrlObj.searchParams.set("ticket", ticket);
    wtUrl = wtUrlObj.toString();
  } catch (e) {
    if (e instanceof TetherWtError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new TetherWtError("wt-ticket", `ticket fetch error: ${msg}`);
  }

  try {
    session = await wt.connect({
      url: wtUrl,
      pinnedCertSha256: pinnedList,
    });

    // Open control channel-id 0x01 first — daemon expects the
    // SessionIDHeader on this stream BEFORE any events traffic.
    control = await session.openBidi({ channelId: CHANNEL_ID_CONTROL });
    const header: SessionIDHeader = {
      sessionId: args.sessionId,
      deviceId: args.deviceId,
    };
    const headerLine = `${JSON.stringify(header)}\n`;
    await control.send(new TextEncoder().encode(headerLine));

    // Events stream — channel-id 0x02 per §3.3.3.
    events = await session.openBidi({ channelId: CHANNEL_ID_EVENTS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    args.onState({ state: "error", error: `wt-attach setup: ${msg}` });
    // Best-effort cleanup of anything that did open.
    if (events) {
      try { await events.close(); } catch { /* ignore */ }
    }
    if (control) {
      try { await control.close(); } catch { /* ignore */ }
    }
    if (session) {
      try { await session.close(); } catch { /* ignore */ }
    }
    if (e instanceof TetherWtError) throw e;
    throw new TetherWtError("wt-attach", msg);
  }

  // Connected — recv loop drives the rest.
  args.onState({ state: "connected" });

  let disposed = false;
  let recvLoopDone = false;

  const recvLoop = async (): Promise<void> => {
    // Capture references before disposal so the loop can finish its
    // last in-flight recv after dispose() flips `disposed`.
    const ev = events!;
    while (!disposed) {
      let envelope: DecryptedEnvelope | null;
      try {
        envelope = await ev.recvEnvelope(args.sessionId);
      } catch (e) {
        if (disposed) break;
        const msg = e instanceof Error ? e.message : String(e);
        const transition: AttachStateValue = "error";
        args.onState({ state: transition, error: `wt-attach recv: ${msg}` });
        break;
      }
      if (envelope === null) {
        // Peer half-closed cleanly at a frame boundary → daemon dropped.
        if (!disposed) args.onState({ state: "dropped" });
        break;
      }
      if (disposed) break;
      try {
        args.onEnvelope(envelope);
      } catch {
        // Consumer-side error MUST NOT kill the recv loop — log via
        // state callback and keep pumping. Tests assert this.
      }
    }
    recvLoopDone = true;
  };

  // Fire-and-forget: the loop owns its own error reporting via onState.
  void recvLoop();

  return {
    dispose: async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      // Closing the session cancels in-flight quinn recvs Rust-side
      // and lets the recv loop exit at the next await boundary.
      if (session) {
        try { await session.close(); } catch { /* best-effort */ }
      }
      // Don't await recvLoopDone — the recv loop may already be in a
      // post-disposed state and we don't want dispose() to block on
      // a stuck Rust task. The loop's `disposed` check breaks it on
      // the next iteration.
      void recvLoopDone;
    },
    sendInput: async (bytes: Uint8Array): Promise<void> => {
      if (disposed || !control) {
        throw new TetherWtError("wt-attach", "sendInput on disposed client");
      }
      // Newline-terminate to match the daemon's frame splitter on the
      // control stream. The daemon JSON-parses the line and routes
      // by `type` ("auth.tool-decision" today; future input frames
      // share this seam).
      const out = new Uint8Array(bytes.length + 1);
      out.set(bytes, 0);
      out[bytes.length] = 0x0a; // '\n'
      await control.send(out);
    },
  };
}
