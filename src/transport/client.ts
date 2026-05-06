import { invoke } from "@tauri-apps/api/core";
import { TetherWtError } from "./errors";
import type {
  SessionId,
  StreamId,
  WtConnectOptions,
  WtSession,
  WtStream,
} from "./types";

// Rust command names — must match `#[tauri::command]` attrs in
// src-tauri/src/wt/mod.rs.
const CMD = {
  connect: "wt_connect",
  open_bidi: "wt_open_bidi",
  open_uni: "wt_open_uni",
  send: "wt_send",
  recv: "wt_recv",
  close_stream: "wt_close_stream",
  close: "wt_close",
} as const;

async function call<T>(op: string, cmd: string, args: Record<string, unknown>): Promise<T> {
  try {
    return (await invoke(cmd, args)) as T;
  } catch (e) {
    const msg = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
    throw new TetherWtError(op, msg);
  }
}

class WtStreamImpl implements WtStream {
  constructor(public readonly id: StreamId) {}

  async send(data: Uint8Array): Promise<void> {
    // Tauri 2 IPC supports Uint8Array directly via the new ArrayBuffer
    // encoding (since 2.0) — no base64 required.
    await call<void>("send", CMD.send, { streamId: this.id, bytes: data });
  }

  async recv(): Promise<Uint8Array | null> {
    const out = await call<number[] | null>("recv", CMD.recv, {
      streamId: this.id,
    });
    if (out === null) return null;
    return Uint8Array.from(out);
  }

  /**
   * Explicitly evict the stream from the Rust-side registry. Idempotent —
   * calling on an already-closed stream is a no-op. Strongly recommended
   * after the JS side is done with a stream so the registry doesn't leak
   * (PR-3 review BLOCKER 1).
   *
   * Note: `recv()` returning `null` (peer cleanly half-closed) ALSO
   * auto-evicts on the Rust side, so explicit `.close()` is only needed
   * when the JS side abandons a stream that hasn't seen a clean
   * peer-close yet.
   */
  async close(): Promise<void> {
    await call<void>("close_stream", CMD.close_stream, { streamId: this.id });
  }
}

class WtSessionImpl implements WtSession {
  constructor(public readonly id: SessionId) {}

  async openBidi(): Promise<WtStream> {
    const sid = await call<StreamId>("open_bidi", CMD.open_bidi, {
      sessionId: this.id,
    });
    return new WtStreamImpl(sid);
  }

  async openUni(): Promise<WtStream> {
    const sid = await call<StreamId>("open_uni", CMD.open_uni, {
      sessionId: this.id,
    });
    return new WtStreamImpl(sid);
  }

  async close(): Promise<void> {
    await call<void>("close", CMD.close, { sessionId: this.id });
  }
}

/**
 * The single client instance — used everywhere in the app as `wt.connect(...)`.
 *
 * Per spec §11.Y.5 D-21: there is only ONE transport implementation across
 * desktop + mobile. No UDS-direct fallback, no WS fallback.
 */
export const wt = {
  async connect(opts: WtConnectOptions): Promise<WtSession> {
    const sid = await call<SessionId>("connect", CMD.connect, {
      url: opts.url,
      options: {
        alpn: opts.alpn ?? null,
        insecure: opts.insecure ?? false,
        timeoutMs: opts.timeoutMs ?? 10_000,
      },
    });
    return new WtSessionImpl(sid);
  },
};
