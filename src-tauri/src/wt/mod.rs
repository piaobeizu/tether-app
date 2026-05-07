//! tether self-written WebTransport Tauri command module.
//!
//! Per spec §11.V (P1 #5 = ii-rebuilt) and §11.Y.5 (D-13 / D-21):
//! ALL targets — Android + macOS + Linux + Windows — go through this exact
//! Rust module. There is no WebView-native WebTransport, no `tauri-plugin-web-transport`
//! (abandoned), no WebSocket fallback.
//!
//! The Rust crate doing the real WT work is `web-transport-quinn` 0.11.9
//! (kixelated, actively maintained, used by iroh + MoQ-rs).
//!
//! Surface (intentionally minimal — see spec §11.V "JS shim 不抄 W3C IDL"):
//!   - wt_connect       → SessionId
//!   - wt_open_bidi     → StreamId
//!   - wt_open_uni      → StreamId
//!   - wt_send          → ()
//!   - wt_recv          → Vec<u8> | null   (null = peer cleanly closed,
//!                                          stream auto-evicted)
//!   - wt_close_stream  → ()               (per-stream explicit close)
//!   - wt_close         → ()               (session close — also drains
//!                                          every stream opened against it)
//!
//! Threading model: each command runs on Tauri's async executor; the
//! per-session/stream state lives in a `dashmap` indexed by opaque u64 IDs
//! that we serialize as strings to avoid 53-bit JS number truncation.

pub mod envelope;
mod error;
mod state;

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

pub use error::WtError;
pub use state::WtState;

use state::{SessionEntry, StreamEntry};

type WtResult<T> = Result<T, String>;

/// Connect options received from the JS shim.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectOptions {
    /// Optional ALPN override; ignored for now (web-transport-quinn pins it
    /// internally to "h3"). Kept on the wire for forward compat.
    #[allow(dead_code)]
    pub alpn: Option<String>,
    /// Accept self-signed / dev TLS certs. **Last-resort dev escape hatch
    /// only**: never combine with `pinned_cert_sha256` (mutually
    /// exclusive — see `build_client`). For dev daemons prefer pinning.
    #[serde(default)]
    pub insecure: bool,
    /// Operator-provided cert pin(s) — hex-encoded sha256 of the server's
    /// **DER-encoded x509 certificate** (matches the W3C
    /// `serverCertificateHashes` shape, which is what
    /// `web-transport-quinn::ClientBuilder::with_server_certificate_hashes`
    /// consumes). The Go daemon prints this on startup as the "DER" hash;
    /// see `internal/transport/wt::Server::DevCertDERSHA256`. (Renamed
    /// from `DevCertSPKISHA256` in slice #3 — the SPKI form did not
    /// interop with the W3C / quinn pin algorithm.)
    ///
    /// When set:
    ///   - rustls verification = pin-only (no system roots, no insecure)
    ///   - `insecure: true` is rejected (`WtError::Tls`)
    ///
    /// When None: system trust store (production default).
    #[serde(default)]
    pub pinned_cert_sha256: Option<Vec<String>>,
    /// Connect-attempt deadline in ms.
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

/// Per-stream open options.
///
/// `channel_id` is the spec §3.3.3 1-byte stream-prefix the daemon side
/// uses to demultiplex streams onto the 4 logical channels (control /
/// events / agent-bytes / catch-up). When set, the byte is written to
/// the stream by `wt_open_bidi` / `wt_open_uni` BEFORE the handle is
/// returned — so the JS shim never sees a "raw" stream, only one with
/// the prefix already on the wire. This is the cleaner half of the
/// architectural choice noted in the slice spec ("auto-write is cleaner;
/// document"): the alternative (caller pushes the byte first) leaks
/// protocol detail into the TS layer for zero benefit.
///
/// When None, the stream is opened without a prefix — used by the
/// minimal echo smoke test and by any future raw-stream consumer.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenStreamOptions {
    #[serde(default)]
    pub channel_id: Option<u8>,
}

fn default_timeout_ms() -> u64 {
    10_000
}

/// Parse a hex-encoded sha256 (64 hex chars, optionally separated by colons)
/// into a 32-byte vector. Used for `pinned_cert_sha256` — operator hands a
/// fingerprint string off from the daemon's startup log; we accept either
/// "deadbeef..." or "de:ad:be:ef:..." form.
fn parse_hex_sha256(s: &str) -> Result<Vec<u8>, WtError> {
    let cleaned: String = s
        .chars()
        .filter(|c| !c.is_whitespace() && *c != ':')
        .collect();
    if cleaned.len() != 64 {
        return Err(WtError::Tls(format!(
            "pinned_cert_sha256 must be 64 hex chars (got {} after stripping ':' and ws)",
            cleaned.len()
        )));
    }
    let mut out = Vec::with_capacity(32);
    let bytes = cleaned.as_bytes();
    for i in (0..bytes.len()).step_by(2) {
        let hi = (bytes[i] as char)
            .to_digit(16)
            .ok_or_else(|| WtError::Tls("non-hex char in pinned_cert_sha256".into()))?;
        let lo = (bytes[i + 1] as char)
            .to_digit(16)
            .ok_or_else(|| WtError::Tls("non-hex char in pinned_cert_sha256".into()))?;
        out.push(((hi << 4) | lo) as u8);
    }
    Ok(out)
}

/// Strong-typed "id" envelope for IPC. We serialize as plain strings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StreamId(pub String);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn wt_connect(
    url: String,
    options: ConnectOptions,
    state: State<'_, WtState>,
) -> WtResult<SessionId> {
    connect_inner(&url, &options, state.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wt_open_bidi(
    session_id: SessionId,
    options: Option<OpenStreamOptions>,
    state: State<'_, WtState>,
) -> WtResult<StreamId> {
    let opts = options.unwrap_or_default();
    open_bidi_inner(&session_id, &opts, state.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wt_open_uni(
    session_id: SessionId,
    options: Option<OpenStreamOptions>,
    state: State<'_, WtState>,
) -> WtResult<StreamId> {
    let opts = options.unwrap_or_default();
    open_uni_inner(&session_id, &opts, state.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wt_send(
    stream_id: StreamId,
    bytes: Vec<u8>,
    state: State<'_, WtState>,
) -> WtResult<()> {
    send_inner(&stream_id, bytes, state.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wt_recv(
    stream_id: StreamId,
    state: State<'_, WtState>,
) -> WtResult<Option<Vec<u8>>> {
    recv_inner(&stream_id, state.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wt_close_stream(
    stream_id: StreamId,
    state: State<'_, WtState>,
) -> WtResult<()> {
    close_stream_inner(&stream_id, state.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wt_close(
    session_id: SessionId,
    state: State<'_, WtState>,
) -> WtResult<()> {
    close_inner(&session_id, state.inner())
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Inner impls (separated so command surface stays small + testable)
// ---------------------------------------------------------------------------

async fn connect_inner(
    url_str: &str,
    options: &ConnectOptions,
    state: &WtState,
) -> Result<SessionId, WtError> {
    let url = url::Url::parse(url_str).map_err(|e| WtError::BadUrl(e.to_string()))?;

    let client = build_client(options)?;

    let session_fut = client.connect(url);
    let timeout = Duration::from_millis(options.timeout_ms);
    let session = tokio::time::timeout(timeout, session_fut)
        .await
        .map_err(|_| WtError::Timeout)?
        .map_err(|e| WtError::Connect(e.to_string()))?;

    let id = state.insert_session(SessionEntry::new(session));
    tracing::info!(id, %url_str, "wt session established");
    Ok(SessionId(id.to_string()))
}

async fn open_bidi_inner(
    sid: &SessionId,
    opts: &OpenStreamOptions,
    state: &WtState,
) -> Result<StreamId, WtError> {
    let session_num_id = WtState::parse_session_id(&sid.0)?;
    let entry = state.get_session(&sid.0)?;
    let session = entry.session.clone();

    let (mut send, recv) = session
        .open_bi()
        .await
        .map_err(|e| WtError::Stream(e.to_string()))?;

    // Spec §3.3.3 stream-prefix byte: write atomically before handing the
    // stream to the JS shim. If this fails the daemon will see a malformed
    // first frame, so we tear the stream down rather than register it.
    if let Some(byte) = opts.channel_id {
        if let Err(e) = send.write_all(&[byte]).await {
            // Best-effort reset; web-transport-quinn's SendStream::reset
            // is fire-and-forget.
            let _ = send.reset(0);
            return Err(WtError::Io(format!(
                "channel-id prefix write failed: {}",
                e
            )));
        }
    }

    let id = state.insert_stream(
        session_num_id,
        StreamEntry::Bidi {
            send: tokio::sync::Mutex::new(send).into(),
            recv: tokio::sync::Mutex::new(recv).into(),
        },
    );
    Ok(StreamId(id.to_string()))
}

async fn open_uni_inner(
    sid: &SessionId,
    opts: &OpenStreamOptions,
    state: &WtState,
) -> Result<StreamId, WtError> {
    let session_num_id = WtState::parse_session_id(&sid.0)?;
    let entry = state.get_session(&sid.0)?;
    let session = entry.session.clone();

    let mut send = session
        .open_uni()
        .await
        .map_err(|e| WtError::Stream(e.to_string()))?;

    if let Some(byte) = opts.channel_id {
        if let Err(e) = send.write_all(&[byte]).await {
            let _ = send.reset(0);
            return Err(WtError::Io(format!(
                "channel-id prefix write failed: {}",
                e
            )));
        }
    }

    let id = state.insert_stream(
        session_num_id,
        StreamEntry::Uni {
            send: tokio::sync::Mutex::new(send).into(),
        },
    );
    Ok(StreamId(id.to_string()))
}

async fn send_inner(sid: &StreamId, bytes: Vec<u8>, state: &WtState) -> Result<(), WtError> {
    let entry = state.get_stream(&sid.0)?;
    let send = entry
        .send_handle()
        .ok_or_else(|| WtError::Stream("stream is recv-only".into()))?;
    let mut guard = send.lock().await;
    guard
        .write_all(&bytes)
        .await
        .map_err(|e| WtError::Io(e.to_string()))?;
    Ok(())
}

async fn recv_inner(sid: &StreamId, state: &WtState) -> Result<Option<Vec<u8>>, WtError> {
    let stream_num_id = WtState::parse_stream_id(&sid.0)?;
    let entry = state.get_stream(&sid.0)?;
    let recv = entry
        .recv_handle()
        .ok_or_else(|| WtError::Stream("stream is send-only (uni)".into()))?;
    let mut guard = recv.lock().await;

    // 64 KiB read budget per IPC call — the JS shim loops as needed.
    let mut buf = vec![0u8; 64 * 1024];
    match guard
        .read(&mut buf)
        .await
        .map_err(|e| WtError::Io(e.to_string()))?
    {
        None => {
            // Peer cleanly half-closed. The stream is no longer usable —
            // drop the registry entry so we don't leak (BLOCKER 1 fix).
            // Drop the lock guard before removing the entry, otherwise the
            // remove will succeed but we'd be holding a stale `recv` Arc.
            drop(guard);
            state.remove_stream(stream_num_id);
            Ok(None)
        }
        Some(n) => {
            buf.truncate(n);
            Ok(Some(buf))
        }
    }
}

async fn close_stream_inner(sid: &StreamId, state: &WtState) -> Result<(), WtError> {
    let id = WtState::parse_stream_id(&sid.0)?;
    state.remove_stream(id);
    Ok(())
}

async fn close_inner(sid: &SessionId, state: &WtState) -> Result<(), WtError> {
    // `remove_session` drains every stream registered against this session
    // before returning the entry (BLOCKER 1 fix).
    let entry = state.remove_session(&sid.0)?;
    entry.session.close(0u32, b"client closed");
    Ok(())
}

// ---------------------------------------------------------------------------
// Client builder
// ---------------------------------------------------------------------------

fn build_client(options: &ConnectOptions) -> Result<web_transport_quinn::Client, WtError> {
    // Install the ring crypto provider for rustls 0.23. Idempotent — calling
    // twice in a process is fine because rustls de-dups via OnceLock.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let builder = web_transport_quinn::ClientBuilder::new();

    let has_pins = options
        .pinned_cert_sha256
        .as_ref()
        .map(|v| !v.is_empty())
        .unwrap_or(false);

    // Mutually exclusive with `insecure`. Pinning + insecure-skip-verify
    // is nonsense; one strips the verifier the other relies on. Reject
    // explicitly so misconfigured operators get a clear error rather
    // than silent insecure mode.
    if has_pins && options.insecure {
        return Err(WtError::Tls(
            "pinned_cert_sha256 and insecure are mutually exclusive".into(),
        ));
    }

    if has_pins {
        // Pin-only verification path. web-transport-quinn's
        // `with_server_certificate_hashes` matches the W3C
        // `serverCertificateHashes` algorithm — sha256 of the DER-encoded
        // x509 leaf cert. The Go daemon prints exactly that hash on
        // startup; operator hands it off via `pinnedCertSha256`.
        let raw_pins = options
            .pinned_cert_sha256
            .as_ref()
            .expect("checked has_pins above");
        let mut hashes: Vec<Vec<u8>> = Vec::with_capacity(raw_pins.len());
        for s in raw_pins {
            hashes.push(parse_hex_sha256(s)?);
        }
        return builder
            .with_server_certificate_hashes(hashes)
            .map_err(|e| WtError::Tls(e.to_string()));
    }

    if options.insecure {
        // Dev-only: accept any cert. `with_no_certificate_verification`
        // lives on the `DangerousClientBuilder` returned by `.dangerous()`.
        // SECURITY: this MUST be feature-gated or operator-opt-in for
        // production builds. v0.1 accepts the flag from the JS shim,
        // which is acceptable because the desktop binary is the
        // operator's own machine; mobile capabilities will gate this
        // behind a real consent dialog (Epic #7 follow-up).
        return builder
            .dangerous()
            .with_no_certificate_verification()
            .map_err(|e| WtError::Tls(e.to_string()));
    }

    // Production default: system trust store.
    builder
        .with_system_roots()
        .map_err(|e| WtError::Tls(e.to_string()))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hex_sha256_accepts_64_lower_hex() {
        let bytes = parse_hex_sha256(
            "d2fcb20d13ee095d50e8b77b272215e3b985e595294572256c1187838ff48930",
        )
        .expect("64 lower hex chars should parse");
        assert_eq!(bytes.len(), 32);
        assert_eq!(bytes[0], 0xd2);
        assert_eq!(bytes[31], 0x30);
    }

    #[test]
    fn parse_hex_sha256_accepts_colon_separated() {
        // openssl-style fingerprint with colons
        let bytes = parse_hex_sha256(
            "d2:fc:b2:0d:13:ee:09:5d:50:e8:b7:7b:27:22:15:e3:\
             b9:85:e5:95:29:45:72:25:6c:11:87:83:8f:f4:89:30",
        )
        .expect("colon-separated should parse");
        assert_eq!(bytes.len(), 32);
        assert_eq!(bytes[0], 0xd2);
    }

    #[test]
    fn parse_hex_sha256_rejects_wrong_length() {
        assert!(parse_hex_sha256("deadbeef").is_err());
        assert!(parse_hex_sha256("").is_err());
    }

    #[test]
    fn parse_hex_sha256_rejects_non_hex() {
        assert!(parse_hex_sha256(
            "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
        )
        .is_err());
    }

    #[test]
    fn build_client_rejects_pin_plus_insecure() {
        let opts = ConnectOptions {
            alpn: None,
            insecure: true,
            pinned_cert_sha256: Some(vec![
                "d2fcb20d13ee095d50e8b77b272215e3b985e595294572256c1187838ff48930"
                    .to_string(),
            ]),
            timeout_ms: 1000,
        };
        let err = build_client(&opts).err().expect("must reject");
        match err {
            WtError::Tls(msg) => assert!(
                msg.contains("mutually exclusive"),
                "unexpected error msg: {msg}"
            ),
            other => panic!("expected Tls error, got {other:?}"),
        }
    }

    #[test]
    fn build_client_rejects_bad_pin_hex() {
        let opts = ConnectOptions {
            alpn: None,
            insecure: false,
            pinned_cert_sha256: Some(vec!["not-hex".to_string()]),
            timeout_ms: 1000,
        };
        assert!(build_client(&opts).is_err());
    }

    #[tokio::test]
    async fn build_client_pin_path_constructs_client() {
        // 32 zero bytes = a valid sha256 length-wise; the verifier won't
        // ever match it, but we just need to confirm the builder accepts
        // the pin and produces a Client without panicking.
        //
        // This test must run under a tokio runtime: web-transport-quinn's
        // builder opens a UDP endpoint (`quinn::Endpoint::client(...)`)
        // which requires a running tokio reactor.
        let opts = ConnectOptions {
            alpn: None,
            insecure: false,
            pinned_cert_sha256: Some(vec![
                "0000000000000000000000000000000000000000000000000000000000000000"
                    .to_string(),
            ]),
            timeout_ms: 1000,
        };
        let _ = build_client(&opts).expect("pin path should build a client");
    }
}
