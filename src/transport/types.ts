// Branded ID types — the Rust side issues these as opaque u64 strings.
// We carry them as `string` over the IPC bridge to avoid 53-bit JS number
// truncation at the boundary.

export type SessionId = string & { readonly __brand: "SessionId" };
export type StreamId = string & { readonly __brand: "StreamId" };

export interface WtConnectOptions {
  /** Server URL, e.g. "https://server.example:4433/wt". */
  url: string;
  /**
   * Optional ALPN to negotiate. Default: "h3" (per WebTransport draft-02 / RFC 9220).
   * The Rust side already pins quinn ALPN; this is here as an escape hatch
   * for spec changes.
   */
  alpn?: string;
  /**
   * If true, accept self-signed / dev TLS certs. Production builds should
   * leave this false. Plumbed through to `quinn::ClientConfig`.
   */
  insecure?: boolean;
  /** Connect-attempt timeout in milliseconds. Default 10_000. */
  timeoutMs?: number;
}

export interface WtSession {
  readonly id: SessionId;
  openBidi(): Promise<WtStream>;
  openUni(): Promise<WtStream>;
  close(): Promise<void>;
}

export interface WtStream {
  readonly id: StreamId;
  /** Send bytes on the stream. Bidi or uni; for uni-recv this rejects. */
  send(data: Uint8Array): Promise<void>;
  /**
   * Read the next chunk from the stream.
   * Returns `null` when the peer has cleanly closed its send side. When
   * `null` is returned the Rust side has already evicted the stream
   * registry entry — calling `send()` / `recv()` on this stream after
   * that will reject with `unknown stream`.
   */
  recv(): Promise<Uint8Array | null>;
  /**
   * Explicitly evict the stream from the Rust-side registry. Idempotent.
   * Use after the JS side abandons a stream that hasn't yet seen a clean
   * peer-close (otherwise the registry row leaks until session close).
   */
  close(): Promise<void>;
}
