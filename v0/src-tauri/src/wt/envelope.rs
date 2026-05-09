//! §3.3.1 wire-envelope decrypt path (slice #3 of the WT block).
//!
//! Mirrors `tether/internal/transport/wt/envelope.go` — same JSON shape,
//! same length-prefixed framing, same AD construction. The Rust side is
//! receive-only in v0.1: the daemon pushes envelopes down the events
//! channel and we Open them here. Sealing + sending lives behind the
//! `control` channel (slice #5+).
//!
//! ## Why the crypto belongs here (Rust), not in TypeScript
//!
//! Defense-in-depth. The Tauri webview is the highest-attack-surface
//! layer of the desktop / mobile binary (CSP holes, supply-chain risk
//! on npm deps). Keeping AEAD open in Rust means a webview-XSS bug
//! does NOT yield plaintext envelopes — only the post-decrypt JSON
//! that the JS layer would have rendered anyway.
//!
//! The TS API surface (see `src/transport/envelope.ts`) only sees the
//! decrypted `LocalEnvelope` JSON; raw ciphertext bytes never cross
//! the Tauri IPC boundary in this direction.
//!
//! ## Hardcoded v0.1 dev shared key
//!
//! The `DEV_SHARED_KEY` constant below MUST stay byte-equal to the Go
//! side's `transport/wt.DevSharedKey`. Slice #4 (pairing) replaces
//! this with a real ECDH-negotiated per-session key.

use std::sync::Arc;

use base64::Engine;
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use serde::Deserialize;
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;

use super::error::WtError;
use super::state::{StreamEntry, WtState};

/// 32-byte AEAD key length (XChaCha20-Poly1305).
pub const SHARED_KEY_SIZE: usize = 32;

/// 24-byte XChaCha20 nonce length (the §3.3.1 nonce field is base64 of
/// exactly this many bytes).
pub const NONCE_SIZE: usize = 24;

/// `keyVersion` value emitted by all v0.1 senders. Receivers MUST
/// reject any other value (no negotiation in v0.1; bump = protocol
/// upgrade).
pub const CURRENT_KEY_VERSION: u32 = 1;

/// Frame size cap — must match the Go side's `wt.FrameSizeMax`. A
/// length-prefix > this value triggers a wire-protocol error.
pub const FRAME_SIZE_MAX: u32 = 1 << 20;

/// **HARDCODED v0.1 development key** — byte-identical to
/// `tether/internal/transport/wt.DevSharedKey`.
///
/// SLICE #4 PAIRING REPLACES THIS WITH A REAL ECDH-NEGOTIATED KEY.
/// SLICE #4 PAIRING REPLACES THIS WITH A REAL ECDH-NEGOTIATED KEY.
/// SLICE #4 PAIRING REPLACES THIS WITH A REAL ECDH-NEGOTIATED KEY.
///
/// Offers ZERO confidentiality in v0.1 — the daemon's WT listener is
/// bound to localhost / LAN only until pairing exists. Do NOT log it.
/// Do NOT make it operator-visible. Do NOT use this for anything other
/// than the WT envelope dispatch round-trip.
pub const DEV_SHARED_KEY: [u8; SHARED_KEY_SIZE] = [
    0x74, 0x65, 0x74, 0x68, 0x65, 0x72, 0x2d, 0x77, 0x74, 0x2d, 0x64, 0x65, 0x76, 0x2d, 0x73, 0x68,
    0x61, 0x72, 0x65, 0x64, 0x2d, 0x6b, 0x65, 0x79, 0x2d, 0x73, 0x6c, 0x69, 0x63, 0x65, 0x2d, 0x33,
];

/// JSON shape of `WireEnvelope` — mirror of the Go struct (same field
/// names, same JSON tags). `nonce` and `ciphertext` are JSON strings
/// holding standard base64 (Go encodes `[]byte` as base64-std by
/// default). `keyVersion` is a JSON number; serde_json maps it to u32.
#[derive(Debug, Deserialize)]
#[allow(dead_code)] // some fields are inspected by callers, not all by this module
pub struct WireEnvelopeJson {
    pub id: String,
    #[serde(rename = "fromDeviceId")]
    pub from_device_id: String,
    #[serde(rename = "toDeviceId")]
    pub to_device_id: String,
    pub ts: i64,
    #[serde(rename = "keyVersion")]
    pub key_version: u32,
    /// base64-std encoded 24-byte nonce.
    pub nonce: String,
    /// AD-bound; replicated plaintext for routing on the Go side.
    pub kind: String,
    /// base64-std encoded ciphertext (includes the trailing 16-byte
    /// Poly1305 tag).
    pub ciphertext: String,
}

/// Decrypted envelope handed back across the Tauri IPC boundary. The
/// `body` field is the raw inner JSON (the daemon's `LocalEnvelope`);
/// the TS layer parses + dispatches it.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecryptedEnvelope {
    pub id: String,
    pub from_device_id: String,
    pub to_device_id: String,
    pub ts: i64,
    pub kind: String,
    /// Inner-plaintext bytes interpreted as a UTF-8 JSON string. Empty
    /// string is legal (a daemon emitting a sentinel `{}` payload).
    pub body: String,
}

/// Build the §3.3.1 AD bytes deterministically. MUST match the Go-side
/// `buildAD` byte-for-byte.
///
///   AD = LP(sessionId) || LP(fromDeviceId) || LP(toDeviceId) ||
///        u32_BE(keyVersion) || LP(kind)
///
/// where LP(s) = u16_BE(len(s)) || utf8(s).
fn build_ad(
    session_id: &str,
    from_device_id: &str,
    to_device_id: &str,
    key_version: u32,
    kind: &str,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(
        2 + session_id.len()
            + 2
            + from_device_id.len()
            + 2
            + to_device_id.len()
            + 4
            + 2
            + kind.len(),
    );
    push_lp(&mut out, session_id);
    push_lp(&mut out, from_device_id);
    push_lp(&mut out, to_device_id);
    out.extend_from_slice(&key_version.to_be_bytes());
    push_lp(&mut out, kind);
    out
}

fn push_lp(out: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let len = u16::try_from(bytes.len()).expect("AD field length fits u16");
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(bytes);
}

/// Decrypt a single `WireEnvelopeJson` against a 32-byte shared key.
/// `session_id` is mixed into the AD (matches the Go-side Open AD).
/// Returns the inner plaintext bytes.
pub fn open(
    env: &WireEnvelopeJson,
    shared_key: &[u8; SHARED_KEY_SIZE],
    session_id: &str,
) -> Result<Vec<u8>, WtError> {
    if env.key_version != CURRENT_KEY_VERSION {
        return Err(WtError::Envelope(format!(
            "unsupported keyVersion {} (want {})",
            env.key_version, CURRENT_KEY_VERSION
        )));
    }
    if env.kind.is_empty() {
        return Err(WtError::Envelope("empty kind".into()));
    }

    let nonce_bytes = base64::engine::general_purpose::STANDARD
        .decode(env.nonce.as_bytes())
        .map_err(|e| WtError::Envelope(format!("nonce base64: {}", e)))?;
    if nonce_bytes.len() != NONCE_SIZE {
        return Err(WtError::Envelope(format!(
            "nonce length {} != {}",
            nonce_bytes.len(),
            NONCE_SIZE
        )));
    }
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ct = base64::engine::general_purpose::STANDARD
        .decode(env.ciphertext.as_bytes())
        .map_err(|e| WtError::Envelope(format!("ciphertext base64: {}", e)))?;

    let cipher = XChaCha20Poly1305::new_from_slice(shared_key)
        .map_err(|e| WtError::Envelope(format!("XChaCha20Poly1305::new: {}", e)))?;

    let ad = build_ad(
        session_id,
        &env.from_device_id,
        &env.to_device_id,
        env.key_version,
        &env.kind,
    );

    cipher
        .decrypt(
            nonce,
            Payload {
                msg: &ct,
                aad: &ad,
            },
        )
        .map_err(|e| WtError::Envelope(format!("AEAD open: {}", e)))
}

/// Read one length-prefixed JSON frame off `recv`, parse the
/// `WireEnvelopeJson`, decrypt with `shared_key` + `session_id`, and
/// return a `DecryptedEnvelope` ready to ship back to the JS layer.
///
/// Returns `Ok(None)` cleanly when the peer has half-closed the stream
/// at a frame boundary (no pending bytes). Returns `Err(...)` for
/// malformed frames, oversize length, or AEAD failure.
async fn next_frame_decrypted<R: AsyncReadExt + Unpin>(
    recv: &mut R,
    shared_key: &[u8; SHARED_KEY_SIZE],
    session_id: &str,
) -> Result<Option<DecryptedEnvelope>, WtError> {
    let mut hdr = [0u8; 4];
    match recv.read_exact(&mut hdr).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            // 0 bytes consumed before EOF == clean half-close at boundary.
            return Ok(None);
        }
        Err(e) => return Err(WtError::Io(format!("read frame length: {}", e))),
    }
    let n = u32::from_be_bytes(hdr);
    if n == 0 {
        return Err(WtError::Envelope("zero-length frame".into()));
    }
    if n > FRAME_SIZE_MAX {
        return Err(WtError::Envelope(format!(
            "frame size {} exceeds max {}",
            n, FRAME_SIZE_MAX
        )));
    }
    let mut body = vec![0u8; n as usize];
    recv.read_exact(&mut body)
        .await
        .map_err(|e| WtError::Io(format!("read frame body: {}", e)))?;
    let env: WireEnvelopeJson = serde_json::from_slice(&body)
        .map_err(|e| WtError::Envelope(format!("json parse: {}", e)))?;
    let pt = open(&env, shared_key, session_id)?;
    let body_str = String::from_utf8(pt)
        .map_err(|e| WtError::Envelope(format!("inner plaintext utf8: {}", e)))?;
    Ok(Some(DecryptedEnvelope {
        id: env.id,
        from_device_id: env.from_device_id,
        to_device_id: env.to_device_id,
        ts: env.ts,
        kind: env.kind,
        body: body_str,
    }))
}

/// Tauri command — pull the next decrypted envelope off the events
/// stream. Returns `null` cleanly when the peer half-closes (the JS
/// layer can wind down the subscription).
///
/// `stream_id` must point at a recv-capable stream (bidi or accepted
/// uni). `session_id` is the cc session id used to construct AD;
/// callers obtain it via the daemon control channel before opening
/// events.
///
/// **Crypto path**: the v0.1 dev shared key (DEV_SHARED_KEY) is used
/// hardcoded; the JS layer does NOT pass a key. Slice #4 (pairing)
/// replaces this with a per-session key looked up via session_id.
#[tauri::command]
pub async fn wt_recv_envelope(
    stream_id: super::StreamId,
    session_id: String,
    state: tauri::State<'_, WtState>,
) -> Result<Option<DecryptedEnvelope>, String> {
    recv_envelope_inner(&stream_id.0, &session_id, state.inner())
        .await
        .map_err(|e| e.to_string())
}

async fn recv_envelope_inner(
    stream_id: &str,
    session_id: &str,
    state: &WtState,
) -> Result<Option<DecryptedEnvelope>, WtError> {
    let stream_num_id = WtState::parse_stream_id(stream_id)?;
    let entry = state.get_stream(stream_id)?;
    let recv = recv_handle(&entry).ok_or_else(|| WtError::Stream("stream is send-only".into()))?;
    let mut guard = recv.lock().await;

    let res = next_frame_decrypted(&mut *guard, &DEV_SHARED_KEY, session_id).await;
    match res {
        Ok(None) => {
            // Clean half-close at boundary: drop the registry entry so
            // we don't leak the stream like wt_recv does on EOF.
            drop(guard);
            state.remove_stream(stream_num_id);
            Ok(None)
        }
        Ok(Some(env)) => Ok(Some(env)),
        Err(e) => Err(e),
    }
}

/// Type-erased recv-handle accessor. Mirrors `StreamEntry::recv_handle`
/// but returns an owned `Arc<Mutex<...>>` clone so the caller can drop
/// the entry borrow before locking. Only Bidi streams are recv-capable
/// in v0.1 (the events channel is a server-initiated bidi).
fn recv_handle(
    entry: &StreamEntry,
) -> Option<Arc<Mutex<web_transport_quinn::RecvStream>>> {
    match entry {
        StreamEntry::Bidi { recv, .. } => Some(recv.clone()),
        StreamEntry::Uni { .. } => None,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirrors the Go side's TestSealOpenRoundtrip — given a
    /// hand-constructed WireEnvelope JSON whose ciphertext was produced
    /// by the Go `Seal` function, `open` recovers the plaintext.
    /// Implemented as a self-test by sealing in Rust too (we have the
    /// same primitives), then opening — proves the Rust AD construction
    /// matches the documented format.
    #[test]
    fn seal_open_roundtrip_self() {
        // Build AD-bound payload via direct cipher use (mirrors Seal).
        let session_id = "sess-X";
        let from = "device-cli-1";
        let to = "device-app-2";
        let kind = "output.agent-event";
        let plaintext = b"{\"hello\":\"world\"}";
        let nonce_bytes: [u8; NONCE_SIZE] = [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
            0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
        ];
        let nonce = XNonce::from_slice(&nonce_bytes);
        let ad = build_ad(session_id, from, to, CURRENT_KEY_VERSION, kind);
        let cipher = XChaCha20Poly1305::new_from_slice(&DEV_SHARED_KEY).unwrap();
        let ct = cipher
            .encrypt(
                nonce,
                Payload {
                    msg: plaintext,
                    aad: &ad,
                },
            )
            .expect("seal");

        let env = WireEnvelopeJson {
            id: "00000000-0000-4000-8000-000000000001".into(),
            from_device_id: from.into(),
            to_device_id: to.into(),
            ts: 1714000000000,
            key_version: CURRENT_KEY_VERSION,
            nonce: base64::engine::general_purpose::STANDARD.encode(nonce_bytes),
            kind: kind.into(),
            ciphertext: base64::engine::general_purpose::STANDARD.encode(&ct),
        };

        let pt = open(&env, &DEV_SHARED_KEY, session_id).expect("open");
        assert_eq!(pt, plaintext);
    }

    /// Tampering with `kind` after seal MUST cause AEAD auth failure
    /// — the §3.3.1 "kind is AD-bound" invariant.
    #[test]
    fn ad_binds_kind() {
        let session_id = "sess";
        let from = "a";
        let to = "b";
        let kind = "output.agent-event";
        let plaintext = b"payload";
        let nonce_bytes = [9u8; NONCE_SIZE];
        let nonce = XNonce::from_slice(&nonce_bytes);
        let ad = build_ad(session_id, from, to, CURRENT_KEY_VERSION, kind);
        let cipher = XChaCha20Poly1305::new_from_slice(&DEV_SHARED_KEY).unwrap();
        let ct = cipher
            .encrypt(
                nonce,
                Payload {
                    msg: plaintext.as_slice(),
                    aad: &ad,
                },
            )
            .unwrap();

        let mut env = WireEnvelopeJson {
            id: "00000000-0000-4000-8000-000000000002".into(),
            from_device_id: from.into(),
            to_device_id: to.into(),
            ts: 1,
            key_version: CURRENT_KEY_VERSION,
            nonce: base64::engine::general_purpose::STANDARD.encode(nonce_bytes),
            kind: kind.into(),
            ciphertext: base64::engine::general_purpose::STANDARD.encode(&ct),
        };
        env.kind = "control.lock-takeover".into();
        assert!(open(&env, &DEV_SHARED_KEY, session_id).is_err());
    }

    /// keyVersion mismatch must be rejected.
    #[test]
    fn rejects_key_version_mismatch() {
        let env = WireEnvelopeJson {
            id: "00000000-0000-4000-8000-000000000003".into(),
            from_device_id: "a".into(),
            to_device_id: "b".into(),
            ts: 1,
            key_version: 2,
            nonce: base64::engine::general_purpose::STANDARD.encode([0u8; NONCE_SIZE]),
            kind: "x".into(),
            ciphertext: base64::engine::general_purpose::STANDARD.encode([0u8; 16]),
        };
        let err = open(&env, &DEV_SHARED_KEY, "").unwrap_err();
        match err {
            WtError::Envelope(msg) => {
                assert!(msg.contains("keyVersion"), "msg = {msg}");
            }
            other => panic!("wrong variant: {:?}", other),
        }
    }

    /// AD construction is byte-stable — the canonical encoding the Go
    /// side computes for a fixed input.
    #[test]
    fn ad_byte_layout_stable() {
        // Inputs chosen to exercise mixed lengths.
        let got = build_ad("sess", "from", "to", 1, "output.agent-event");
        // Hand-computed expected:
        //  u16(4) "sess"
        //  u16(4) "from"
        //  u16(2) "to"
        //  u32(1)
        //  u16(18) "output.agent-event"
        let mut want = Vec::new();
        want.extend_from_slice(&4u16.to_be_bytes());
        want.extend_from_slice(b"sess");
        want.extend_from_slice(&4u16.to_be_bytes());
        want.extend_from_slice(b"from");
        want.extend_from_slice(&2u16.to_be_bytes());
        want.extend_from_slice(b"to");
        want.extend_from_slice(&1u32.to_be_bytes());
        want.extend_from_slice(&18u16.to_be_bytes());
        want.extend_from_slice(b"output.agent-event");
        assert_eq!(got, want);
    }
}
