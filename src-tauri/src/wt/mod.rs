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
    /// Accept self-signed / dev TLS certs.
    #[serde(default)]
    pub insecure: bool,
    /// Connect-attempt deadline in ms.
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_timeout_ms() -> u64 {
    10_000
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
    state: State<'_, WtState>,
) -> WtResult<StreamId> {
    open_bidi_inner(&session_id, state.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wt_open_uni(
    session_id: SessionId,
    state: State<'_, WtState>,
) -> WtResult<StreamId> {
    open_uni_inner(&session_id, state.inner())
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

async fn open_bidi_inner(sid: &SessionId, state: &WtState) -> Result<StreamId, WtError> {
    let session_num_id = WtState::parse_session_id(&sid.0)?;
    let entry = state.get_session(&sid.0)?;
    let session = entry.session.clone();

    let (send, recv) = session
        .open_bi()
        .await
        .map_err(|e| WtError::Stream(e.to_string()))?;

    let id = state.insert_stream(
        session_num_id,
        StreamEntry::Bidi {
            send: tokio::sync::Mutex::new(send).into(),
            recv: tokio::sync::Mutex::new(recv).into(),
        },
    );
    Ok(StreamId(id.to_string()))
}

async fn open_uni_inner(sid: &SessionId, state: &WtState) -> Result<StreamId, WtError> {
    let session_num_id = WtState::parse_session_id(&sid.0)?;
    let entry = state.get_session(&sid.0)?;
    let session = entry.session.clone();

    let send = session
        .open_uni()
        .await
        .map_err(|e| WtError::Stream(e.to_string()))?;

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

    if options.insecure {
        // Dev-only: accept any cert. `with_no_certificate_verification`
        // lives on the `DangerousClientBuilder` returned by `.dangerous()`.
        builder
            .dangerous()
            .with_no_certificate_verification()
            .map_err(|e| WtError::Tls(e.to_string()))
    } else {
        builder
            .with_system_roots()
            .map_err(|e| WtError::Tls(e.to_string()))
    }
}
