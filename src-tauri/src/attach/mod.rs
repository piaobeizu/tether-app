//! `tether_attach_*` Tauri commands — bridge from the React shell to the
//! local daemon's Unix attach socket (`~/.tether/attach.sock`).
//!
//! Wire protocol (kept in lockstep with `internal/agent/attach_socket.go`
//! on the daemon side):
//!
//! 1. Connect to a Unix socket at `socket_path`.
//! 2. Write a single newline-terminated JSON header
//!    `{"sessionId":..., "mode":"ro"|"rw", "client":{"kind":..., "deviceId":...}}\n`.
//! 3. Read 4-byte BE length-prefixed JSON frames forever:
//!    - first frame is `{"type":"attach.ack", ...}` (mode confirmation)
//!    - subsequent frames are `LocalEnvelope`s (kind / sessionId / payload)
//!    - on rw lock-denied paths the daemon emits `{"type":"attach.lock-denied", ...}`
//!
//! Per-frame size cap matches the daemon's `ReadFrame`: 1 MiB. Frames
//! larger than that drop the connection with a typed error.
//!
//! ### Surface
//!
//! - `tether_attach_subscribe(sessionId, mode, options) -> SubscriptionId`
//!   * Opens the socket, writes the header, then spawns a tokio task that
//!     pumps frames into Tauri events `attach://frame` (one per frame) +
//!     a final `attach://state` (with `connected | error | dropped`).
//! - `tether_attach_unsubscribe(subscriptionId)`
//!   * Drops the subscription handle; the spawned task exits via a
//!     `CancellationToken`.
//!
//! ### Cancellability
//!
//! Each subscription owns a `CancellationToken`; the read loop selects
//! against it on every frame boundary. The accept side of the socket
//! (the daemon) closes cleanly when we drop the connection — no FIN
//! storm, just a normal POSIX close.
//!
//! ### Errors / reconnect
//!
//! v0.1: this command only does one TCP-equivalent connect attempt. The
//! frontend (`AppShell`) is responsible for reconnect — this matches the
//! existing connection-state slice's "reconnecting" flow and keeps the
//! Rust side stateless w.r.t. retry policy.
//!
//! Malformed frame / oversize frame / parse error → emits an
//! `attach://state { state: "error", error }` event and exits the loop.
//! The handle becomes a no-op (idempotent unsubscribe).

mod state;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub use state::AttachState;

/// 1 MiB — matches `agent.ReadFrame` ceiling.
const MAX_FRAME_BYTES: u32 = 1 << 20;

/// Opaque handle the frontend passes to `tether_attach_unsubscribe`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SubscriptionId(pub String);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachClient {
    pub kind: String,
    pub device_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachOptions {
    /// Optional override for the socket path. None = `~/.tether/attach.sock`.
    #[serde(default)]
    pub socket_path: Option<String>,
    /// Connect deadline in ms (the underlying tokio dial honors this via
    /// `tokio::time::timeout`). 0 / missing = 5s.
    #[serde(default)]
    pub connect_timeout_ms: Option<u64>,
}

/// Wire shape of the JSON header sent on connect. Mirrors
/// `agent.AttachHeader`.
#[derive(Debug, Serialize)]
struct WireHeader<'a> {
    #[serde(rename = "sessionId")]
    session_id: &'a str,
    mode: &'a str,
    client: WireClient<'a>,
}

#[derive(Debug, Serialize)]
struct WireClient<'a> {
    kind: &'a str,
    #[serde(rename = "deviceId")]
    device_id: &'a str,
}

/// Internal counter — issued IDs are monotonically increasing strings.
static NEXT_SUB: AtomicU64 = AtomicU64::new(1);

/// Frame event payload — emitted as `attach://frame` once per envelope
/// frame received from the daemon. The body is left as raw JSON text;
/// the frontend parses it (no point doing a round-trip through serde
/// just to re-emit).
#[derive(Debug, Serialize, Clone)]
struct FrameEvent {
    #[serde(rename = "subscriptionId")]
    subscription_id: String,
    /// Raw JSON text of the frame body.
    json: String,
}

/// State event payload — emitted as `attach://state` on connect / error /
/// disconnect transitions.
#[derive(Debug, Serialize, Clone)]
struct StateEvent {
    #[serde(rename = "subscriptionId")]
    subscription_id: String,
    /// "connecting" | "connected" | "error" | "dropped"
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
pub async fn tether_attach_subscribe(
    session_id: String,
    mode: String,
    client: AttachClient,
    options: Option<AttachOptions>,
    app: AppHandle,
    attach_state: State<'_, AttachState>,
) -> Result<SubscriptionId, String> {
    if session_id.is_empty() {
        return Err("attach: empty sessionId".into());
    }
    let mode = match mode.as_str() {
        "ro" | "rw" => mode,
        other => return Err(format!("attach: invalid mode {other:?} (want ro|rw)")),
    };

    let opts = options.unwrap_or(AttachOptions {
        socket_path: None,
        connect_timeout_ms: None,
    });
    let socket_path = resolve_socket_path(opts.socket_path.as_deref())?;
    let connect_timeout = Duration::from_millis(opts.connect_timeout_ms.unwrap_or(5_000));

    let id = NEXT_SUB.fetch_add(1, Ordering::Relaxed);
    let sub_id_str = id.to_string();
    let token = CancellationToken::new();
    attach_state.insert(id, token.clone());

    // Pre-emit a "connecting" state so the UI can show the spinner
    // BEFORE the connect_inner future resolves.
    emit_state(&app, &sub_id_str, "connecting", None);

    let app_clone = app.clone();
    let attach_state_clone = attach_state.inner_arc();
    let sub_id_for_task = sub_id_str.clone();

    tokio::spawn(async move {
        let result = run_subscription(
            &app_clone,
            &sub_id_for_task,
            &socket_path,
            &session_id,
            &mode,
            &client,
            connect_timeout,
            token.clone(),
        )
        .await;

        // Task end — emit final state + clean registry entry.
        match result {
            Ok(()) => emit_state(&app_clone, &sub_id_for_task, "dropped", None),
            Err(e) => emit_state(&app_clone, &sub_id_for_task, "error", Some(e)),
        }
        attach_state_clone.remove(id);
    });

    Ok(SubscriptionId(sub_id_str))
}

#[tauri::command]
pub async fn tether_attach_unsubscribe(
    subscription_id: SubscriptionId,
    attach_state: State<'_, AttachState>,
) -> Result<(), String> {
    let id: u64 = subscription_id
        .0
        .parse()
        .map_err(|_| format!("attach: bad subscriptionId {:?}", subscription_id.0))?;
    // Cancel the token first so the task exits before we drop the
    // registry entry — the task's own cleanup also calls remove() but
    // duplicate removes are no-ops.
    attach_state.cancel(id);
    Ok(())
}

/// Read-write counterpart — sends a single user-input frame down the
/// already-open subscription. v0.1: returns an error if the subscription
/// is not in rw mode (we don't have a way to query mode without round-
/// tripping through the daemon's ack — the frontend tracks it from the
/// `attach.ack` frame and gates the call). Callable but optional; the
/// AppShell wiring delivered in this slice only exercises ro.
#[tauri::command]
pub async fn tether_attach_send_input(
    subscription_id: SubscriptionId,
    bytes: Vec<u8>,
    attach_state: State<'_, AttachState>,
) -> Result<(), String> {
    let id: u64 = subscription_id
        .0
        .parse()
        .map_err(|_| format!("attach: bad subscriptionId {:?}", subscription_id.0))?;
    let send = attach_state
        .send_handle(id)
        .ok_or_else(|| format!("attach: subscription {id} not found or read-only"))?;
    let mut guard = send.lock().await;
    write_input_frame(&mut *guard, &bytes)
        .await
        .map_err(|e| format!("attach: write input: {e}"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_subscription(
    app: &AppHandle,
    sub_id: &str,
    socket_path: &PathBuf,
    session_id: &str,
    mode: &str,
    client: &AttachClient,
    connect_timeout: Duration,
    token: CancellationToken,
) -> Result<(), String> {
    // Connect with timeout.
    let stream = tokio::time::timeout(connect_timeout, UnixStream::connect(socket_path))
        .await
        .map_err(|_| format!("connect timeout to {}", socket_path.display()))?
        .map_err(|e| format!("connect {}: {e}", socket_path.display()))?;

    let (read_half, write_half) = stream.into_split();
    let write_half = Arc::new(Mutex::new(write_half));

    // Header.
    let hdr = WireHeader {
        session_id,
        mode,
        client: WireClient {
            kind: &client.kind,
            device_id: &client.device_id,
        },
    };
    let mut hdr_bytes = serde_json::to_vec(&hdr).map_err(|e| format!("encode header: {e}"))?;
    hdr_bytes.push(b'\n');
    {
        let mut g = write_half.lock().await;
        g.write_all(&hdr_bytes)
            .await
            .map_err(|e| format!("write header: {e}"))?;
        g.flush().await.ok();
    }

    // Register the write half so `tether_attach_send_input` can use it
    // for rw mode. (No-op for ro — the daemon ignores trailing bytes.)
    if mode == "rw" {
        if let Some(state) = app.try_state::<AttachState>() {
            // Best-effort — if the subscription was already canceled,
            // the state row is gone and we just don't register.
            let id: u64 = sub_id.parse().unwrap_or(0);
            state.attach_send(id, write_half.clone());
        }
    }

    let mut reader = read_half;
    // Frame loop.
    let mut len_buf = [0u8; 4];
    let mut first_frame_seen = false;
    loop {
        tokio::select! {
            biased;
            _ = token.cancelled() => {
                return Ok(());
            }
            res = reader.read_exact(&mut len_buf) => {
                if let Err(e) = res {
                    // Treat clean EOF as "dropped" not "error" so the
                    // UI's reconnect banner only fires on real failures.
                    if e.kind() == std::io::ErrorKind::UnexpectedEof {
                        return Ok(());
                    }
                    return Err(format!("read frame len: {e}"));
                }
            }
        }
        let n = u32::from_be_bytes(len_buf);
        if n > MAX_FRAME_BYTES {
            return Err(format!("frame too large: {n} > {MAX_FRAME_BYTES}"));
        }
        let mut body = vec![0u8; n as usize];
        if let Err(e) = reader.read_exact(&mut body).await {
            return Err(format!("read frame body: {e}"));
        }
        // Validate JSON shape early — drop the connection on garbage so
        // the UI can show an error rather than spew malformed events.
        let json_str = std::str::from_utf8(&body)
            .map_err(|e| format!("frame is not utf-8: {e}"))?
            .to_string();
        // Cheap JSON-shape probe. We don't fully parse here — the
        // frontend has the typed shapes. But we DO want "is it parseable
        // as a JSON value at all" to be a hard error so a bug in framing
        // shows up at the boundary.
        if let Err(e) = serde_json::from_str::<serde_json::Value>(&json_str) {
            return Err(format!("frame is not valid JSON: {e}"));
        }
        if !first_frame_seen {
            first_frame_seen = true;
            // The first frame is the ack — promote our state so the UI
            // flips out of "connecting" before any envelope events
            // arrive.
            emit_state(app, sub_id, "connected", None);
        }
        let payload = FrameEvent {
            subscription_id: sub_id.to_string(),
            json: json_str,
        };
        if let Err(e) = app.emit("attach://frame", payload) {
            // Tauri emitter failure is fatal for this subscription —
            // there is no listener side anymore.
            return Err(format!("emit frame: {e}"));
        }
    }
}

fn emit_state(app: &AppHandle, sub_id: &str, state: &'static str, error: Option<String>) {
    let payload = StateEvent {
        subscription_id: sub_id.to_string(),
        state,
        error,
    };
    let _ = app.emit("attach://state", payload);
}

/// Resolve the user's `~/.tether/attach.sock` (or honor a CLI/env
/// override). Mirrors `agent.DefaultAttachSocketPath` on the daemon.
fn resolve_socket_path(override_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = override_path {
        if !p.is_empty() {
            return Ok(PathBuf::from(p));
        }
    }
    // Env override takes precedence over the home-dir default; mirrors
    // the daemon's own --attach-socket flag for symmetry.
    if let Ok(p) = std::env::var("TETHER_ATTACH_SOCKET") {
        if !p.is_empty() {
            return Ok(PathBuf::from(p));
        }
    }
    let home = std::env::var("HOME").map_err(|_| "attach: $HOME not set".to_string())?;
    Ok(PathBuf::from(home).join(".tether").join("attach.sock"))
}

/// Write a single 4-byte BE length-prefixed input frame; mirrors
/// `agent.WriteInputFrame`.
async fn write_input_frame<W>(w: &mut W, payload: &[u8]) -> std::io::Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    let n = payload.len() as u32;
    let mut hdr = [0u8; 4];
    hdr.copy_from_slice(&n.to_be_bytes());
    w.write_all(&hdr).await?;
    w.write_all(payload).await?;
    w.flush().await
}

// --------------------------------------------------------------------
// Unit tests — protocol shape only. We can't easily mock a Tauri
// AppHandle for the full subscription path here without `tauri::test`,
// so we lock in:
//   - header serialization shape
//   - resolve_socket_path env / override / default cascade
//   - write_input_frame BE length prefix
// --------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn header_serializes_to_expected_shape() {
        let hdr = WireHeader {
            session_id: "abc-123",
            mode: "ro",
            client: WireClient {
                kind: "terminal",
                device_id: "dev-xyz",
            },
        };
        let json = serde_json::to_string(&hdr).unwrap();
        // Field names must match the Go side's `AttachHeader` struct
        // tags: sessionId / mode / client{kind, deviceId}.
        assert!(json.contains(r#""sessionId":"abc-123""#));
        assert!(json.contains(r#""mode":"ro""#));
        assert!(json.contains(r#""kind":"terminal""#));
        assert!(json.contains(r#""deviceId":"dev-xyz""#));
    }

    #[test]
    fn resolve_socket_path_honors_explicit_override() {
        let p = resolve_socket_path(Some("/tmp/explicit.sock")).unwrap();
        assert_eq!(p, PathBuf::from("/tmp/explicit.sock"));
    }

    #[test]
    fn resolve_socket_path_honors_env_when_no_override() {
        // Save / restore — env mutation in tests is process-wide. We
        // serialize via a unique name to avoid colliding with parallel
        // tests in the same crate.
        std::env::set_var("TETHER_ATTACH_SOCKET", "/tmp/from-env.sock");
        let p = resolve_socket_path(None).unwrap();
        assert_eq!(p, PathBuf::from("/tmp/from-env.sock"));
        std::env::remove_var("TETHER_ATTACH_SOCKET");
    }

    #[test]
    fn resolve_socket_path_defaults_under_home() {
        std::env::remove_var("TETHER_ATTACH_SOCKET");
        std::env::set_var("HOME", "/home/test-user");
        let p = resolve_socket_path(None).unwrap();
        assert_eq!(
            p,
            PathBuf::from("/home/test-user/.tether/attach.sock")
        );
    }

    #[tokio::test]
    async fn write_input_frame_emits_be_length_prefix() {
        let mut buf = Vec::new();
        let mut cursor = Cursor::new(&mut buf);
        write_input_frame(&mut cursor, b"hello").await.unwrap();
        // 4 BE bytes for length (5) + 5 byte payload.
        assert_eq!(buf, vec![0, 0, 0, 5, b'h', b'e', b'l', b'l', b'o']);
    }
}
