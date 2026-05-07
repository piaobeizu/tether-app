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
   * Dev escape hatch — accept self-signed / dev TLS certs. Production
   * builds should leave this false.
   *
   * Mutually exclusive with `pinnedCertSha256`: setting both is rejected
   * Rust-side with `WtError::Tls("...mutually exclusive")`. For dev
   * daemons prefer `pinnedCertSha256` (which still validates the
   * server's identity against a known fingerprint).
   */
  insecure?: boolean;
  /**
   * Hex-encoded sha256 of the server's DER-encoded x509 cert (W3C
   * `serverCertificateHashes` shape — what
   * `web-transport-quinn::with_server_certificate_hashes` consumes).
   *
   * The Go daemon prints this on startup as the "DER" hash; pass it
   * verbatim ("deadbeef..." or colon-separated "de:ad:be:ef:..." both
   * accepted). When set, the client validates the server's leaf cert
   * by exact hash match — system trust store and `insecure` are both
   * bypassed.
   *
   * Multiple hashes can be passed for cert rotation windows.
   */
  pinnedCertSha256?: string[];
  /** Connect-attempt timeout in milliseconds. Default 10_000. */
  timeoutMs?: number;
}

/**
 * Per-stream open options. `channelId` is the spec §3.3.3 1-byte
 * stream-prefix the daemon uses to demultiplex into the 4 logical
 * channels (control / events / agent-bytes / catch-up). When set, the
 * Rust side writes the byte BEFORE returning the handle, so the JS
 * shim never has to remember to push it first. Leaving it `undefined`
 * yields a raw stream with no prefix — used by the echo smoke test
 * and any future raw-stream consumer.
 */
export interface WtOpenStreamOptions {
  /** 0-255. The byte is written atomically as the stream's first frame. */
  channelId?: number;
}

export interface WtSession {
  readonly id: SessionId;
  openBidi(opts?: WtOpenStreamOptions): Promise<WtStream>;
  openUni(opts?: WtOpenStreamOptions): Promise<WtStream>;
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
   * Read the next §3.3.1 wire-envelope frame off the stream and return
   * the decrypted inner payload. Slice #3 — only valid on the events
   * channel (channel-id 0x02). Returns `null` cleanly when the peer
   * half-closes at a frame boundary.
   *
   * The Rust side does the AEAD open + AD verification + length-prefix
   * framing (see `src-tauri/src/wt/envelope.rs`); the JS layer never
   * sees raw ciphertext bytes. This is the v0.1 defense-in-depth posture
   * — a webview-XSS bug cannot exfiltrate plaintext envelopes.
   *
   * The hardcoded v0.1 dev shared key is used; slice #4 (pairing) will
   * route a per-session ECDH-negotiated key by the `sessionId` argument.
   *
   * @param sessionId — the cc session id, used in the AEAD AD
   *   construction (must match what the daemon used when sealing).
   */
  recvEnvelope(sessionId: string): Promise<DecryptedEnvelope | null>;
  /**
   * Explicitly evict the stream from the Rust-side registry. Idempotent.
   * Use after the JS side abandons a stream that hasn't yet seen a clean
   * peer-close (otherwise the registry row leaks until session close).
   */
  close(): Promise<void>;
}

/**
 * Result of `WtStream.recvEnvelope`. Mirrors the Rust
 * `wt::envelope::DecryptedEnvelope` (camelCase via serde).
 *
 * `body` is the inner-plaintext bytes interpreted as a UTF-8 JSON
 * string — typically the JSON serialization of the daemon's
 * `LocalEnvelope` (see `src/transport/envelope.ts`). Callers parse it
 * with `JSON.parse(env.body)`.
 */
export interface DecryptedEnvelope {
  /** UUID v4 — useful for client-side dedup + replay-window LRU. */
  id: string;
  fromDeviceId: string;
  toDeviceId: string;
  /** Sender wall-clock unix-millis. Used for the §3.3.1 ±5min replay
   *  window check (caller-side; this layer doesn't enforce). */
  ts: number;
  /** §3.3.2 op kind, AD-bound (cannot be tampered without breaking
   *  the AEAD tag). */
  kind: string;
  /** Inner plaintext as UTF-8. Usually JSON; parse it with JSON.parse. */
  body: string;
}
