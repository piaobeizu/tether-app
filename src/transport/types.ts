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
   * Explicitly evict the stream from the Rust-side registry. Idempotent.
   * Use after the JS side abandons a stream that hasn't yet seen a clean
   * peer-close (otherwise the registry row leaks until session close).
   */
  close(): Promise<void>;
}
