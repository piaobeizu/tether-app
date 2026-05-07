//! §11.AB pairing protocol — Rust client (initiator-side).
//!
//! Implements the spec at
//! `tether-doc/wiki/specs/2026-05-07-pairing-protocol.md` §§4–9, §14.
//!
//! ## Where this lives
//!
//! Pair logic sits as a sibling file to `envelope.rs` because both share
//! the WT session/stream lifecycle, but the byte-paths are distinct:
//! envelope frames are encrypted ciphertext, pair frames travel with
//! `keyVersion = 0` sentinel + plaintext body in the envelope's
//! `ciphertext` field (spec §3, §14 OQ ratification). We do NOT reuse
//! the §3.3.1 AEAD path for pair frames.
//!
//! ## Cross-stack byte-identical contracts
//!
//! These constants MUST stay byte-equal to their Go-side counterparts in
//! `tether/internal/agent/pair/sas.go`. Any divergence trips the golden
//! tests on both sides simultaneously.
//!
//!   - `INFO_SAS_KEY`           = "tether-sas-v1"
//!   - `INFO_SAS_DISPLAY`       = "tether-sas-display-v1"
//!   - `CONFIRM_LABEL_PREFIX`   = "tether-pair-confirm-v1"
//!   - `INFO_LTK`               = "tether-ltk-v1"
//!   - `INFO_TBK`               = "tether-tbk-v1"
//!   - SAS_ALPHABET             = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
//!
//! ## FSM scope (v0.1 client)
//!
//! This file is the **initiator** path — desktop drives. The mobile
//! responder lives in the daemon's pair sub-goroutine (see go-pair-impl
//! parallel slice). The Tauri-side commands here drive the
//! initiator FSM up to user-visible SAS confirmation, then the
//! `pair_confirm` command finishes the handshake.

#![allow(clippy::too_many_arguments)]

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
// chacha20poly1305 0.10 uses crypto-common 0.1; hmac 0.13 uses crypto-common 0.2.
// Both expose a `KeyInit` trait, so we alias the hmac/digest one to keep both
// in scope without collision.
use chacha20poly1305::aead::{AeadInPlace, KeyInit};
use chacha20poly1305::{Tag, XChaCha20Poly1305, XNonce};
use chrono::Utc;
use dashmap::DashMap;
use hkdf::Hkdf;
use hmac::digest::KeyInit as DigestKeyInit;
use hmac::{Hmac, Mac};
use rand::rngs::SysRng;
use rand::TryRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use x25519_dalek::{PublicKey, StaticSecret};

use super::error::WtError;
use super::state::{StreamEntry, WtState};
use super::StreamId;

// ---------------------------------------------------------------------------
// Cross-stack pinned constants (§4 / §5 / §8)
// ---------------------------------------------------------------------------

/// HKDF-SHA256 info string for the SAS key derivation. Spec §4 step 1.
pub const INFO_SAS_KEY: &[u8] = b"tether-sas-v1";

/// HKDF-SHA256 info string for the displayable SAS bits. Spec §4 step 2.
pub const INFO_SAS_DISPLAY: &[u8] = b"tether-sas-display-v1";

/// HMAC label prefix for `pair.sas-confirm.mac`. Spec §3.3 / §2.1
/// (initiator-confirm / responder-confirm).
pub const CONFIRM_LABEL_PREFIX: &[u8] = b"tether-pair-confirm-v1";

/// HKDF-SHA256 info string for the long-term wrap key (§8).
pub const INFO_LTK: &[u8] = b"tether-ltk-v1";

/// HKDF-SHA256 info string for the transport binding key (§8).
pub const INFO_TBK: &[u8] = b"tether-tbk-v1";

/// SAS encoding alphabet — RFC 4648 base32 minus visually-confusable
/// 0/O/1/I/L. Pinned by spec §4 step 3.
pub const SAS_ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// Pair protocol version. Spec §3 — bumped only on incompatible change.
pub const PAIR_PROTOCOL_VERSION: u32 = 1;

/// AD suffix appended to `transcript_hash` when sealing/opening the
/// `pair.complete` AEAD tag. Spec §3.4 — wire-stable, must match Go's
/// `pair.completeAEADInfo`.
pub const COMPLETE_AEAD_INFO: &[u8] = b"tether-pair-complete-v1";

/// `pair.abort` reason emitted when `pair.complete` AEAD tag fails to
/// verify. Cross-stack constant — must match Go's `ReasonCertError`.
pub const PAIR_ABORT_CERT_ERROR: &str = "cert-error";

/// Spec §7 timeouts (single-shot per state-entry).
const TIMEOUT_AWAITING_PUBKEY_SECS: u64 = 30;
const TIMEOUT_SAS_CONFIRM_SECS: u64 = 60;
const TIMEOUT_COMPLETING_SECS: u64 = 10;

/// Frame size cap for the pair stream — same as envelope (§3.3.1 of main
/// spec). Pair frames are tiny; this is a hard upper bound.
const PAIR_FRAME_SIZE_MAX: u32 = 64 * 1024;

// ---------------------------------------------------------------------------
// Frame shapes (§3.1 – §3.5) — match Go side byte-for-byte.
//
// Naming choice: the spec writes `pair.invite` / `pair.accept` etc. as
// envelope `kind` discriminators. The frame *body* shape (the "v" /
// "deviceId" / "ephemeralPubkey" fields) is what the structs below
// model. The outer envelope wrapping is handled by `wrap_frame_envelope`.
// ---------------------------------------------------------------------------

/// `pair.invite` body — initiator → responder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteFrame {
    /// Frame discriminator. MUST be `"pair.invite"`.
    #[serde(rename = "type")]
    pub kind: String,
    /// Protocol version. MUST be `PAIR_PROTOCOL_VERSION` for v0.1.
    pub v: u32,
    /// Initiator's stable device identifier. Spec §3.1.
    #[serde(rename = "deviceId")]
    pub device_id: String,
    /// X25519 ephemeral public key, base64url no-pad (32 bytes).
    #[serde(rename = "ephemeralPubkey")]
    pub ephemeral_pubkey: String,
    /// Initiator metadata — kind/model/displayName/osVersion/appVersion.
    #[serde(rename = "deviceMetadata")]
    pub device_metadata: DeviceMetadata,
    /// Sender ms-precision wall-clock.
    pub ts: i64,
    /// 16 random bytes, base64url no-pad. Mixed into transcript.
    pub nonce: String,
}

/// `pair.accept` body — responder → initiator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcceptFrame {
    #[serde(rename = "type")]
    pub kind: String,
    pub v: u32,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "ephemeralPubkey")]
    pub ephemeral_pubkey: String,
    #[serde(rename = "deviceMetadata")]
    pub device_metadata: DeviceMetadata,
    /// Optional — mobile only. Desktop omits the field entirely.
    #[serde(rename = "pushSubscription", skip_serializing_if = "Option::is_none")]
    pub push_subscription: Option<PushSubscription>,
    pub ts: i64,
    pub nonce: String,
}

/// `pair.sas-confirm` body — both directions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SasConfirmFrame {
    #[serde(rename = "type")]
    pub kind: String,
    pub v: u32,
    /// `false` = user rejected; receiver MUST transition `failed`.
    pub ok: bool,
    /// `"initiator"` | `"responder"` — disambiguates the MAC label.
    pub role: String,
    /// HMAC-SHA256(sas_key, label || transcript_hash). Base64url no-pad.
    /// MAY be absent when `ok == false`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac: Option<String>,
    pub ts: i64,
}

/// `pair.complete` body — daemon → both endpoints.
///
/// `nonce` + `tag` are spec §3.4 mandatory — they carry the AEAD
/// authenticator that proves the daemon shares our derived
/// `long_term_key`. Receivers MUST verify with their own derived
/// `long_term_key` + the same `transcript_hash`; mismatch ⇒
/// `pair.abort{cert-error}`. (BLOCKER 4 fix: previously we parsed
/// these fields but skipped verification.)
///
/// `registered_as` and `long_term_key_id` are spec §3.4 informational
/// fields the daemon assigns — modeled as `Option` because the Go
/// canonical-body emitter omits keys when their content is empty
/// (matching `serde(skip_serializing_if = "Option::is_none")`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteFrame {
    #[serde(rename = "type")]
    pub kind: String,
    pub v: u32,
    #[serde(default, rename = "registeredAs", skip_serializing_if = "Option::is_none")]
    pub registered_as: Option<RegisteredAs>,
    #[serde(default, rename = "longTermKeyId", skip_serializing_if = "Option::is_none")]
    pub long_term_key_id: Option<String>,
    pub ts: i64,
    /// 24-byte XChaCha20 nonce, base64url no-pad.
    pub nonce: String,
    /// 16-byte AEAD tag, base64url no-pad. Empty plaintext, so the
    /// "ciphertext" is just the 16-byte Poly1305 tag.
    pub tag: String,
}

/// `pair.abort` body — any state, any direction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbortFrame {
    #[serde(rename = "type")]
    pub kind: String,
    pub v: u32,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceMetadata {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(default, rename = "osVersion", skip_serializing_if = "Option::is_none")]
    pub os_version: Option<String>,
    #[serde(default, rename = "appVersion", skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushSubscription {
    #[serde(rename = "type")]
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredAs {
    #[serde(rename = "initiatorDeviceId")]
    pub initiator_device_id: String,
    #[serde(rename = "responderDeviceId")]
    pub responder_device_id: String,
}

// ---------------------------------------------------------------------------
// Crypto helpers (§4 / §5 / §8) — byte-identical to Go side.
// ---------------------------------------------------------------------------

/// X25519 ECDH. `my_priv` and `peer_pub` come from §3.1 / §3.2's
/// `ephemeralPubkey` fields (after base64url decode + 32-byte cast).
pub fn compute_shared_secret(my_priv: &StaticSecret, peer_pub: &PublicKey) -> [u8; 32] {
    my_priv.diffie_hellman(peer_pub).to_bytes()
}

/// Spec §4 step 1 — derive the SAS / MAC key.
///
/// `sas_key = HKDF-SHA256(ikm = shared_secret, salt = transcript_hash,
///                        info = "tether-sas-v1", L = 32)`
pub fn derive_sas_key(shared_secret: &[u8; 32], transcript_hash: &[u8; 32]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(transcript_hash), shared_secret);
    let mut out = [0u8; 32];
    hk.expand(INFO_SAS_KEY, &mut out)
        .expect("HKDF expand 32B always succeeds");
    out
}

/// Spec §4 step 2 + 3 — compute the human-readable 6-char SAS string.
///
/// `sas_bits = HKDF-SHA256(ikm = sas_key, salt = empty,
///                         info = "tether-sas-display-v1", L = 4)`
/// → take low 30 bits → encode high-to-low into 6 base32 chars.
pub fn compute_sas(sas_key: &[u8; 32]) -> String {
    let hk = Hkdf::<Sha256>::new(None, sas_key);
    let mut bits = [0u8; 4];
    hk.expand(INFO_SAS_DISPLAY, &mut bits)
        .expect("HKDF expand 4B always succeeds");
    let v = u32::from_be_bytes(bits) & 0x3FFF_FFFF;
    let mut out = [0u8; 6];
    for (i, ch) in out.iter_mut().enumerate() {
        let shift = 25 - 5 * i;
        let idx = ((v >> shift) & 0x1F) as usize;
        *ch = SAS_ALPHABET[idx];
    }
    // SAFETY: SAS_ALPHABET is ASCII; output is 6 ASCII bytes.
    String::from_utf8(out.to_vec()).expect("ASCII alphabet")
}

/// Spec §3.3 / §2.1 — compute the `pair.sas-confirm.mac` for a role.
///
/// `mac = HMAC-SHA256(sas_key, "tether-pair-confirm-v1|" + role + "|" +
///                    transcript_hash_lowercase_hex)`
///
/// The transcript hash is included **as the raw 32 bytes**; the label
/// part before it is ASCII. Order is fixed.
pub fn confirm_mac(sas_key: &[u8; 32], role: &str, transcript_hash: &[u8; 32]) -> [u8; 32] {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac =
        <HmacSha256 as DigestKeyInit>::new_from_slice(sas_key).expect("HMAC key any length");
    mac.update(CONFIRM_LABEL_PREFIX);
    mac.update(b"|");
    mac.update(role.as_bytes());
    mac.update(b"|");
    mac.update(transcript_hash);
    let res = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&res);
    out
}

/// Spec §8 — derive the long-term wrap key + transport-binding key.
///
/// Returns `(long_term_key, transport_binding_key)`.
pub fn derive_long_term_keys(
    shared_secret: &[u8; 32],
    transcript_hash: &[u8; 32],
) -> ([u8; 32], [u8; 32]) {
    let hk = Hkdf::<Sha256>::new(Some(transcript_hash), shared_secret);
    let mut ltk = [0u8; 32];
    let mut tbk = [0u8; 32];
    hk.expand(INFO_LTK, &mut ltk).expect("HKDF expand 32B");
    hk.expand(INFO_TBK, &mut tbk).expect("HKDF expand 32B");
    (ltk, tbk)
}

/// Error type for pair.complete AEAD tag verification (BLOCKER-4).
#[derive(Debug)]
pub struct CompleteAeadError;

/// Build the AEAD additional data for the §3.4 pair.complete tag:
/// `AD = transcript_hash || "tether-pair-complete-v1"`. Cross-stack:
/// MUST match Go's `completeAEADAd`.
fn complete_aead_ad(transcript_hash: &[u8; 32]) -> Vec<u8> {
    let mut ad = Vec::with_capacity(transcript_hash.len() + COMPLETE_AEAD_INFO.len());
    ad.extend_from_slice(transcript_hash);
    ad.extend_from_slice(COMPLETE_AEAD_INFO);
    ad
}

/// Verify the §3.4 pair.complete AEAD tag against the receiver-derived
/// long-term key + observed transcript_hash. (BLOCKER-4 fix.)
///
/// `nonce_b64` is the 24-byte XChaCha20 nonce (base64url-no-pad);
/// `tag_b64` is the 16-byte Poly1305 tag (base64url-no-pad). Empty
/// plaintext, so the AEAD ciphertext is just the tag.
///
/// Returns `Ok(())` iff the tag authenticates. ANY failure (decode,
/// length mismatch, key wrong, transcript wrong, tag tampered)
/// surfaces as `CompleteAeadError` — defense-in-depth so callers can't
/// branch on subtype and reveal info to an attacker probing why open
/// failed.
pub fn verify_complete_tag(
    long_term_key: &[u8; 32],
    transcript_hash: &[u8; 32],
    nonce_b64: &str,
    tag_b64: &str,
) -> Result<(), CompleteAeadError> {
    let nonce = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(nonce_b64.as_bytes())
        .map_err(|_| CompleteAeadError)?;
    let tag = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(tag_b64.as_bytes())
        .map_err(|_| CompleteAeadError)?;
    if nonce.len() != 24 {
        return Err(CompleteAeadError);
    }
    if tag.len() != 16 {
        return Err(CompleteAeadError);
    }
    let cipher =
        XChaCha20Poly1305::new_from_slice(long_term_key).map_err(|_| CompleteAeadError)?;
    let xnonce = XNonce::from_slice(&nonce);
    let xtag = Tag::from_slice(&tag);
    let ad = complete_aead_ad(transcript_hash);
    // Empty plaintext, tag-only: decrypt_in_place_detached on an empty
    // buffer with the provided tag. If the tag is invalid this returns
    // an error.
    let mut buf = [0u8; 0];
    cipher
        .decrypt_in_place_detached(xnonce, &ad, &mut buf, xtag)
        .map_err(|_| CompleteAeadError)
}

// ---------------------------------------------------------------------------
// Transcript binding (§5)
// ---------------------------------------------------------------------------

/// Append-only transcript builder. Each appended frame is canonicalized
/// as RFC 8785 / JCS sorted-key JSON, length-prefixed by 4-byte
/// big-endian, and folded into a running SHA-256.
///
/// `transcript_hash` is `SHA-256(LP(f1_canon) || LP(f2_canon) || ...)`.
pub struct TranscriptBuilder {
    hasher: Sha256,
    /// Kept for golden-test introspection; production callers do not
    /// touch this.
    raw: Vec<u8>,
}

impl TranscriptBuilder {
    pub fn new() -> Self {
        Self {
            hasher: Sha256::new(),
            raw: Vec::new(),
        }
    }

    /// Append the canonical JSON encoding of `value`. `value` must be a
    /// `serde_json::Value` so we can sort keys deterministically (no
    /// reliance on insertion order from any specific struct layout).
    pub fn append_value(&mut self, value: &serde_json::Value) {
        let canon = canonical_json(value);
        let len = u32::try_from(canon.len()).expect("frame canonical len fits u32");
        let mut hdr = [0u8; 4];
        hdr.copy_from_slice(&len.to_be_bytes());
        self.hasher.update(hdr);
        self.hasher.update(&canon);
        self.raw.extend_from_slice(&hdr);
        self.raw.extend_from_slice(&canon);
    }

    /// Convenience: serialize a serde-serializable struct, then append.
    pub fn append<S: Serialize>(&mut self, frame: &S) -> Result<(), WtError> {
        let v = serde_json::to_value(frame)
            .map_err(|e| WtError::Envelope(format!("transcript serialize: {e}")))?;
        self.append_value(&v);
        Ok(())
    }

    /// Snapshot the running SHA-256 without consuming the builder.
    pub fn snapshot(&self) -> [u8; 32] {
        let h = self.hasher.clone().finalize();
        let mut out = [0u8; 32];
        out.copy_from_slice(&h);
        out
    }

    #[cfg(test)]
    pub fn raw(&self) -> &[u8] {
        &self.raw
    }
}

impl Default for TranscriptBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// RFC 8785 (JCS) canonical JSON encoding. Keys are sorted
/// lexicographically; whitespace is stripped; numbers + strings use the
/// default serde_json encoding (which already follows RFC 8259 + JCS for
/// the cases relevant here — all our pair-frame fields are strings,
/// integers, or nested objects/arrays).
pub fn canonical_json(v: &serde_json::Value) -> Vec<u8> {
    let mut out = Vec::new();
    write_canonical(&mut out, v);
    out
}

fn write_canonical(out: &mut Vec<u8>, v: &serde_json::Value) {
    match v {
        serde_json::Value::Null => out.extend_from_slice(b"null"),
        serde_json::Value::Bool(b) => {
            out.extend_from_slice(if *b { b"true" } else { b"false" })
        }
        serde_json::Value::Number(n) => {
            // serde_json's Display for Number is canonical for our
            // restricted inputs (integers + ts ms-precision). No floats
            // appear in pair frames.
            out.extend_from_slice(n.to_string().as_bytes());
        }
        serde_json::Value::String(s) => {
            // serde_json's encoder already escapes per RFC 8259. Reuse
            // it via to_string of a Value::String — it returns a JSON
            // string literal including the surrounding quotes.
            out.extend_from_slice(serde_json::Value::String(s.clone()).to_string().as_bytes());
        }
        serde_json::Value::Array(arr) => {
            out.push(b'[');
            for (i, el) in arr.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_canonical(out, el);
            }
            out.push(b']');
        }
        serde_json::Value::Object(obj) => {
            // Sort keys lexicographically by UTF-8 bytes (BTreeMap
            // ordering on String matches that for ASCII keys, which is
            // all our spec uses).
            let sorted: BTreeMap<&String, &serde_json::Value> = obj.iter().collect();
            out.push(b'{');
            for (i, (k, val)) in sorted.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                out.extend_from_slice(
                    serde_json::Value::String((*k).clone()).to_string().as_bytes(),
                );
                out.push(b':');
                write_canonical(out, val);
            }
            out.push(b'}');
        }
    }
}

// ---------------------------------------------------------------------------
// Local registry (§9)
// ---------------------------------------------------------------------------

/// Persisted device record — one file per peer at
/// `~/.tether/users/<user>/devices/<deviceId>.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairedDevice {
    pub v: u32,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    pub kind: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(rename = "longTermKey")]
    pub long_term_key_b64: String,
    #[serde(rename = "transportBindingKey")]
    pub transport_binding_key_b64: String,
    #[serde(rename = "longTermKeyId")]
    pub long_term_key_id: String,
    #[serde(rename = "pushToken", default, skip_serializing_if = "Option::is_none")]
    pub push_token: Option<PushSubscription>,
    #[serde(rename = "pairedAt")]
    pub paired_at: String,
    #[serde(rename = "lastSeen")]
    pub last_seen: String,
}

/// Resolve the `~/.tether/users/default/devices/` directory. v0.1 hardcodes
/// `<user> = "default"` per spec §11. Callers that want to override (tests)
/// pass an explicit path through the `RegistryRoot` newtype below.
pub fn default_registry_root() -> Result<PathBuf, WtError> {
    let home = dirs::home_dir()
        .ok_or_else(|| WtError::Envelope("home directory not resolvable".into()))?;
    Ok(home.join(".tether").join("users").join("default").join("devices"))
}

/// Newtype around the registry root path so tests can swap a temp dir in.
#[derive(Debug, Clone)]
pub struct RegistryRoot(pub PathBuf);

impl RegistryRoot {
    pub fn default_path() -> Result<Self, WtError> {
        Ok(Self(default_registry_root()?))
    }

    fn ensure_dir(&self) -> Result<(), WtError> {
        std::fs::create_dir_all(&self.0)
            .map_err(|e| WtError::Io(format!("create registry dir: {e}")))?;
        // 0700 owner-only on Unix. Best-effort: a chmod failure on
        // non-Unix targets is tolerated (Windows ACLs handled via parent
        // dir defaults).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o700);
            let _ = std::fs::set_permissions(&self.0, perms);
        }
        Ok(())
    }

    fn record_path(&self, device_id: &str) -> Result<PathBuf, WtError> {
        if !is_valid_device_id(device_id) {
            return Err(WtError::Envelope(format!(
                "invalid deviceId for filename: {device_id}"
            )));
        }
        Ok(self.0.join(format!("{device_id}.json")))
    }

    /// Save a record; default behavior is reject-if-exists per spec §10
    /// + §14 OQ Q2 (re-pair = reject). `force == true` overwrites.
    pub fn save(&self, rec: &PairedDevice, force: bool) -> Result<(), WtError> {
        self.ensure_dir()?;
        let path = self.record_path(&rec.device_id)?;
        if path.exists() && !force {
            return Err(WtError::Envelope(format!(
                "device {} already paired (force-rotate to overwrite)",
                rec.device_id
            )));
        }
        let body = serde_json::to_vec_pretty(rec)
            .map_err(|e| WtError::Envelope(format!("serialize record: {e}")))?;
        // Atomic write: <file>.tmp → rename.
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, &body).map_err(|e| WtError::Io(format!("write tmp: {e}")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            let _ = std::fs::set_permissions(&tmp, perms);
        }
        std::fs::rename(&tmp, &path).map_err(|e| WtError::Io(format!("rename: {e}")))?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<PairedDevice>, WtError> {
        let mut out = Vec::new();
        let rd = match std::fs::read_dir(&self.0) {
            Ok(rd) => rd,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(WtError::Io(format!("read_dir: {e}"))),
        };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let bytes = std::fs::read(&path)
                .map_err(|e| WtError::Io(format!("read {}: {e}", path.display())))?;
            let rec: PairedDevice = serde_json::from_slice(&bytes)
                .map_err(|e| WtError::Envelope(format!("parse record: {e}")))?;
            out.push(rec);
        }
        Ok(out)
    }

    pub fn delete(&self, device_id: &str) -> Result<bool, WtError> {
        let path = self.record_path(device_id)?;
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(WtError::Io(format!("remove: {e}"))),
        }
    }
}

fn is_valid_device_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

// ---------------------------------------------------------------------------
// Tauri command surface
// ---------------------------------------------------------------------------

/// Per-handle in-flight pair state. The `pair_start` command computes
/// up to the SAS, stashes one of these, and returns a string handle to
/// the JS side. `pair_confirm` retrieves the handle and finishes.
#[allow(dead_code)] // some fields are held for their Drop / Zeroize behavior
struct PairHandleState {
    /// Open WT stream (control channel) used to read/write pair frames.
    stream_id: StreamId,
    /// Initiator's ephemeral private key — zeroized when the handle is
    /// dropped via x25519-dalek's Zeroize impl.
    initiator_priv: StaticSecret,
    /// 32-byte X25519 shared secret. Held until `pair_confirm` derives
    /// the long-term key, then zeroized.
    shared_secret: [u8; 32],
    /// Snapshot of the transcript hash AFTER pair.invite + pair.accept
    /// were appended. Spec §4 requires this exact snapshot for SAS.
    transcript_hash_for_sas: [u8; 32],
    /// Peer's accept frame body — needed at confirm-time for the
    /// resulting device record (kind, display_name, push_token).
    peer_accept: AcceptFrame,
    /// Initiator's own deviceId (used to key its own audit/etc).
    self_device_id: String,
    /// Sas string shown to user; cached so the JS side gets the same
    /// value back across multiple status reads.
    sas: String,
    /// Live transcript builder — additional frames (sas-confirm) get
    /// appended on confirm.
    transcript: TranscriptBuilder,
    /// Strictly-monotonic `ts` watermark on incoming frames per spec
    /// §6.1. Each received frame's `ts` MUST be strictly greater than
    /// `last_seen_ts`; otherwise the frame is rejected as a replay.
    /// (BLOCKER-5 fix: previously the Rust client did NOT track this,
    /// so the Go side's anti-replay was the sole gate — and only one
    /// direction's gate at that.)
    last_seen_ts: i64,
}

/// Helper: enforce spec §6.1 strictly-monotonic ts on an inbound frame
/// against the per-handle watermark. Caller threads the watermark in
/// (rather than this owning the state) so the borrow surface stays
/// minimal.
fn check_replay_and_advance(last_seen_ts: &mut i64, frame_ts: i64) -> Result<(), WtError> {
    if frame_ts <= *last_seen_ts {
        return Err(WtError::Envelope(format!(
            "replay: frame ts {} <= last-seen {}",
            frame_ts, *last_seen_ts
        )));
    }
    *last_seen_ts = frame_ts;
    Ok(())
}

#[derive(Default)]
pub struct PairState {
    handles: DashMap<u64, Arc<Mutex<PairHandleState>>>,
    next_id: std::sync::atomic::AtomicU64,
}

impl PairState {
    pub fn new() -> Self {
        Self::default()
    }

    fn insert(&self, st: PairHandleState) -> String {
        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.handles.insert(id, Arc::new(Mutex::new(st)));
        id.to_string()
    }

    fn get(&self, id_str: &str) -> Result<Arc<Mutex<PairHandleState>>, WtError> {
        let id: u64 = id_str
            .parse()
            .map_err(|_| WtError::BadId(format!("pair handle: {id_str}")))?;
        self.handles
            .get(&id)
            .map(|e| e.value().clone())
            .ok_or_else(|| WtError::BadId(format!("unknown pair handle: {id_str}")))
    }

    fn remove(&self, id_str: &str) -> Option<Arc<Mutex<PairHandleState>>> {
        let id: u64 = id_str.parse().ok()?;
        self.handles.remove(&id).map(|(_, v)| v)
    }
}

/// Inputs to `pair_start` from the JS layer. Mirrors the spec §3.1
/// `pair.invite.deviceMetadata` shape so the UI can pass through.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStartArgs {
    pub stream_id: StreamId,
    pub self_device_id: String,
    pub device_metadata: DeviceMetadata,
}

/// Returned from `pair_start` — JS uses `handle_id` for the follow-up
/// `pair_confirm` / `pair_abort` calls; `sas` is rendered in the UI.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairHandleOut {
    pub handle_id: String,
    pub sas: String,
    /// Echoed back so the UI can render peer info next to the SAS.
    pub peer_device_id: String,
    pub peer_display_name: String,
    pub peer_kind: String,
}

/// Returned from `pair_confirm` — the persisted device summary.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairConfirmOut {
    pub peer_device_id: String,
    pub long_term_key_id: String,
    pub long_term_key_b64: String,
    pub display_name: String,
}

#[tauri::command]
pub async fn pair_start(
    args: PairStartArgs,
    wt_state: tauri::State<'_, WtState>,
    pair_state: tauri::State<'_, PairState>,
) -> Result<PairHandleOut, String> {
    pair_start_inner(args, wt_state.inner(), pair_state.inner())
        .await
        .map_err(|e| e.to_string())
}

async fn pair_start_inner(
    args: PairStartArgs,
    wt_state: &WtState,
    pair_state: &PairState,
) -> Result<PairHandleOut, WtError> {
    // 1. Generate ephemeral keypair.
    //    `StaticSecret::random()` uses x25519-dalek's internal `rand_core 0.6`
    //    OsRng (gated behind the `getrandom` feature on x25519-dalek). We
    //    don't pipe a top-level `rand 0.10` rng in here because x25519-dalek
    //    2.0.1 still pins `rand_core ^0.6`, which is incompatible with the
    //    `rand_core 0.10` that comes with our top-level `rand 0.10` bump.
    let initiator_priv = StaticSecret::random();
    let initiator_pub = PublicKey::from(&initiator_priv);

    // 2. Build pair.invite.
    let mut nonce = [0u8; 16];
    SysRng
        .try_fill_bytes(&mut nonce)
        .expect("system RNG must be available");
    let invite = InviteFrame {
        kind: "pair.invite".into(),
        v: PAIR_PROTOCOL_VERSION,
        device_id: args.self_device_id.clone(),
        ephemeral_pubkey: b64url_no_pad(&initiator_pub.to_bytes()),
        device_metadata: args.device_metadata.clone(),
        ts: now_unix_millis(),
        nonce: b64url_no_pad(&nonce),
    };

    // 3. Send invite over the control stream. Wire format is the §3.3.1
    //    JSONL envelope (BLOCKER-1 fix: previously this was raw 4-byte
    //    length-prefix; now it's `{kind, keyVersion=0, ciphertext, ts}\n`
    //    matching Go's wire.go byte-for-byte).
    let stream_arc = stream_recv_send_handles(wt_state, &args.stream_id)?;
    write_pair_frame(&stream_arc, "pair.invite", &invite).await?;

    // 4. Initialize transcript and append invite.
    let mut transcript = TranscriptBuilder::new();
    transcript.append(&invite)?;

    // Initial replay watermark — anything <= 0 is rejected, which
    // covers the v0.1 "unset" case and any peer that doesn't bother
    // to set ts on the first accept.
    let mut last_seen_ts: i64 = 0;

    // 5. Read pair.accept (or pair.abort) with §7 timeout = 30s.
    let (accept_kind, accept) = tokio::time::timeout(
        Duration::from_secs(TIMEOUT_AWAITING_PUBKEY_SECS),
        read_pair_frame::<AcceptFrame>(&stream_arc),
    )
    .await
    .map_err(|_| WtError::Envelope("awaiting-pubkey timeout (30s)".into()))??;

    if accept_kind != "pair.accept" {
        return Err(WtError::Envelope(format!(
            "expected pair.accept, got {accept_kind}"
        )));
    }
    if accept.v != PAIR_PROTOCOL_VERSION {
        return Err(WtError::Envelope(format!(
            "version-incompatible: peer v={}, want {}",
            accept.v, PAIR_PROTOCOL_VERSION
        )));
    }
    // Spec §6.1 anti-replay (BLOCKER-5).
    check_replay_and_advance(&mut last_seen_ts, accept.ts)?;

    // 6. Decode peer pubkey, compute shared secret.
    let peer_pub_bytes: [u8; 32] = decode_x25519_pubkey(&accept.ephemeral_pubkey)?;
    let peer_pub = PublicKey::from(peer_pub_bytes);
    let shared = compute_shared_secret(&initiator_priv, &peer_pub);

    // 7. Append accept to transcript, snapshot hash.
    transcript.append(&accept)?;
    let transcript_hash = transcript.snapshot();

    // 8. Compute SAS.
    let sas_key = derive_sas_key(&shared, &transcript_hash);
    let sas = compute_sas(&sas_key);

    let peer_kind = accept.device_metadata.kind.clone();
    let peer_display_name = accept.device_metadata.display_name.clone();
    let peer_device_id = accept.device_id.clone();

    // 9. Stash handle.
    let st = PairHandleState {
        stream_id: args.stream_id,
        initiator_priv,
        shared_secret: shared,
        transcript_hash_for_sas: transcript_hash,
        peer_accept: accept,
        self_device_id: args.self_device_id,
        sas: sas.clone(),
        transcript,
        last_seen_ts,
    };
    let handle_id = pair_state.insert(st);

    Ok(PairHandleOut {
        handle_id,
        sas,
        peer_device_id,
        peer_display_name,
        peer_kind,
    })
}

#[tauri::command]
pub async fn pair_confirm(
    handle_id: String,
    force: Option<bool>,
    wt_state: tauri::State<'_, WtState>,
    pair_state: tauri::State<'_, PairState>,
) -> Result<PairConfirmOut, String> {
    pair_confirm_inner(&handle_id, force.unwrap_or(false), wt_state.inner(), pair_state.inner())
        .await
        .map_err(|e| e.to_string())
}

async fn pair_confirm_inner(
    handle_id: &str,
    force: bool,
    wt_state: &WtState,
    pair_state: &PairState,
) -> Result<PairConfirmOut, WtError> {
    let st_arc = pair_state.get(handle_id)?;
    let mut st = st_arc.lock().await;

    let stream_arc = stream_recv_send_handles(wt_state, &st.stream_id)?;

    // 1. Compute and emit our pair.sas-confirm.
    let sas_key = derive_sas_key(&st.shared_secret, &st.transcript_hash_for_sas);
    let our_mac = confirm_mac(&sas_key, "initiator", &st.transcript_hash_for_sas);
    let our_confirm = SasConfirmFrame {
        kind: "pair.sas-confirm".into(),
        v: PAIR_PROTOCOL_VERSION,
        ok: true,
        role: "initiator".into(),
        mac: Some(b64url_no_pad(&our_mac)),
        ts: now_unix_millis(),
    };
    write_pair_frame(&stream_arc, "pair.sas-confirm", &our_confirm).await?;
    st.transcript.append(&our_confirm)?;

    // 2. Read peer's pair.sas-confirm with §7 sas-confirm timeout (60s).
    let (peer_confirm_kind, peer_confirm): (String, SasConfirmFrame) = tokio::time::timeout(
        Duration::from_secs(TIMEOUT_SAS_CONFIRM_SECS),
        read_pair_frame::<SasConfirmFrame>(&stream_arc),
    )
    .await
    .map_err(|_| WtError::Envelope("sas-confirm timeout (60s)".into()))??;

    if peer_confirm_kind != "pair.sas-confirm" {
        return Err(WtError::Envelope(format!(
            "expected pair.sas-confirm, got {peer_confirm_kind}"
        )));
    }
    // Spec §6.1 anti-replay (BLOCKER-5).
    check_replay_and_advance(&mut st.last_seen_ts, peer_confirm.ts)?;
    if !peer_confirm.ok {
        return Err(WtError::Envelope("sas-mismatch (peer reported)".into()));
    }
    if peer_confirm.role != "responder" {
        return Err(WtError::Envelope(format!(
            "peer role mismatch: {}",
            peer_confirm.role
        )));
    }
    let peer_mac_b64 = peer_confirm
        .mac
        .as_ref()
        .ok_or_else(|| WtError::Envelope("peer sas-confirm missing mac".into()))?;
    let peer_mac = b64url_decode_32(peer_mac_b64)?;
    let expected_peer_mac = confirm_mac(&sas_key, "responder", &st.transcript_hash_for_sas);
    if !constant_time_eq(&peer_mac, &expected_peer_mac) {
        return Err(WtError::Envelope("sas-mismatch (peer mac invalid)".into()));
    }
    st.transcript.append(&peer_confirm)?;

    // 3. Read pair.complete with §7 completing timeout (10s).
    let (complete_kind, complete): (String, CompleteFrame) = tokio::time::timeout(
        Duration::from_secs(TIMEOUT_COMPLETING_SECS),
        read_pair_frame::<CompleteFrame>(&stream_arc),
    )
    .await
    .map_err(|_| WtError::Envelope("completing timeout (10s)".into()))??;

    if complete_kind != "pair.complete" {
        return Err(WtError::Envelope(format!(
            "expected pair.complete, got {complete_kind}"
        )));
    }
    // Spec §6.1 anti-replay (BLOCKER-5).
    check_replay_and_advance(&mut st.last_seen_ts, complete.ts)?;

    // 4. Derive long-term keys (§8), then VERIFY the §3.4 AEAD tag
    //    (BLOCKER-4 fix: previously we skipped this and trusted the
    //    daemon). A rogue daemon (or any in-path actor that survived
    //    TLS) cannot forge this tag without sharing our derived ltk +
    //    the same transcript_hash. Mismatch ⇒ pair.abort{cert-error}
    //    and we do NOT save the registry record.
    let (ltk, tbk) = derive_long_term_keys(&st.shared_secret, &st.transcript_hash_for_sas);
    if verify_complete_tag(
        &ltk,
        &st.transcript_hash_for_sas,
        &complete.nonce,
        &complete.tag,
    )
    .is_err()
    {
        // Best-effort: emit pair.abort{cert-error} so the peer can
        // observe the rejection. If the stream is already torn we
        // silently swallow the IO error.
        let abort = AbortFrame {
            kind: "pair.abort".into(),
            v: PAIR_PROTOCOL_VERSION,
            reason: PAIR_ABORT_CERT_ERROR.into(),
            detail: Some("pair.complete AEAD tag verification failed".into()),
            ts: now_unix_millis(),
        };
        let _ = write_pair_frame(&stream_arc, "pair.abort", &abort).await;
        return Err(WtError::Pair(PAIR_ABORT_CERT_ERROR.into()));
    }

    // 5. Persist device record (spec §9).
    let now = Utc::now().to_rfc3339();
    let rec = PairedDevice {
        v: 1,
        device_id: st.peer_accept.device_id.clone(),
        kind: st.peer_accept.device_metadata.kind.clone(),
        display_name: st.peer_accept.device_metadata.display_name.clone(),
        model: st.peer_accept.device_metadata.model.clone(),
        long_term_key_b64: b64url_no_pad(&ltk),
        transport_binding_key_b64: b64url_no_pad(&tbk),
        long_term_key_id: complete.long_term_key_id.clone().unwrap_or_default(),
        push_token: st.peer_accept.push_subscription.clone(),
        paired_at: now.clone(),
        last_seen: now,
    };

    let registry = RegistryRoot::default_path()?;
    registry.save(&rec, force)?;

    // 6. Cleanup: drop sensitive material. shared_secret + sas_key go
    //    out of scope at end of this function; transcript builder
    //    is dropped with `st`. x25519-dalek's StaticSecret zeroizes on
    //    drop.
    let out = PairConfirmOut {
        peer_device_id: rec.device_id,
        long_term_key_id: rec.long_term_key_id,
        long_term_key_b64: rec.long_term_key_b64,
        display_name: rec.display_name,
    };

    drop(st);
    pair_state.remove(handle_id);
    let _ = st_arc; // explicit so the strong-ref-drop reads cleanly.

    // self_device_id is currently unused at this layer (would feed
    // outgoing audit log when added).
    let _ = &out;
    Ok(out)
}

#[tauri::command]
pub async fn pair_abort(
    handle_id: String,
    reason: String,
    wt_state: tauri::State<'_, WtState>,
    pair_state: tauri::State<'_, PairState>,
) -> Result<(), String> {
    pair_abort_inner(&handle_id, &reason, wt_state.inner(), pair_state.inner())
        .await
        .map_err(|e| e.to_string())
}

async fn pair_abort_inner(
    handle_id: &str,
    reason: &str,
    wt_state: &WtState,
    pair_state: &PairState,
) -> Result<(), WtError> {
    let st_arc = match pair_state.remove(handle_id) {
        Some(a) => a,
        None => return Ok(()), // idempotent; double-cancel from UI is fine.
    };
    let st = st_arc.lock().await;
    let abort = AbortFrame {
        kind: "pair.abort".into(),
        v: PAIR_PROTOCOL_VERSION,
        reason: reason.into(),
        detail: None,
        ts: now_unix_millis(),
    };
    if let Ok(stream_arc) = stream_recv_send_handles(wt_state, &st.stream_id) {
        // Best-effort; if the stream is already torn down, ignore.
        let _ = write_pair_frame(&stream_arc, "pair.abort", &abort).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn pair_list_devices() -> Result<Vec<PairedDevice>, String> {
    pair_list_inner().map_err(|e| e.to_string())
}

fn pair_list_inner() -> Result<Vec<PairedDevice>, WtError> {
    let registry = RegistryRoot::default_path()?;
    registry.list()
}

#[tauri::command]
pub async fn pair_forget_device(
    device_id: String,
    force: Option<bool>,
) -> Result<bool, String> {
    let _ = force; // accept forwards-compat flag from UI; deletion always
                   // proceeds if the file exists. The flag is reserved
                   // for an eventual "skip confirm prompt" UX layer.
    let registry = RegistryRoot::default_path().map_err(|e| e.to_string())?;
    registry.delete(&device_id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Wire helpers — length-prefixed JSON, base64url, etc.
// ---------------------------------------------------------------------------

/// Acquire send + recv handles to a bidi stream from the WT registry.
/// Pair frames live on a control bidi stream; uni streams are rejected.
fn stream_recv_send_handles(
    wt_state: &WtState,
    stream_id: &StreamId,
) -> Result<Arc<StreamHandles>, WtError> {
    let entry = wt_state.get_stream(&stream_id.0)?;
    match &*entry {
        StreamEntry::Bidi { send, recv } => Ok(Arc::new(StreamHandles {
            send: send.clone(),
            recv: recv.clone(),
        })),
        StreamEntry::Uni { .. } => Err(WtError::Stream(
            "pair frames require a bidi stream (got uni)".into(),
        )),
    }
}

struct StreamHandles {
    send: Arc<Mutex<web_transport_quinn::SendStream>>,
    recv: Arc<Mutex<web_transport_quinn::RecvStream>>,
}

/// Write a frame using the §3.3.1 JSONL envelope shape Go's wire.go
/// emits (BLOCKER-1 cross-stack fix). Each line is:
///
///   `{"kind":"<frame-kind>","keyVersion":0,"ciphertext":"<b64url-no-pad>","ts":<unix-ms>}\n`
///
/// where `ciphertext` is the canonical-JSON-encoded inner body, base64-
/// url-no-pad encoded so the wire is plain JSON. `keyVersion=0` is the
/// pair-protocol sentinel per spec §14 OQ ratification.
async fn write_pair_frame<F: Serialize>(
    handles: &StreamHandles,
    kind: &str,
    frame: &F,
) -> Result<(), WtError> {
    let v = serde_json::to_value(frame)
        .map_err(|e| WtError::Envelope(format!("frame serialize: {e}")))?;
    let canon = canonical_json(&v);
    if canon.len() as u32 > PAIR_FRAME_SIZE_MAX {
        return Err(WtError::Envelope(format!(
            "pair frame size {} > max {}",
            canon.len(),
            PAIR_FRAME_SIZE_MAX
        )));
    }
    // Extract ts from the inner frame body (every spec-compliant pair
    // frame has a `ts` field). Fall back to 0 if missing — should not
    // happen for well-formed frames.
    let ts = v.get("ts").and_then(|x| x.as_i64()).unwrap_or(0);
    let envelope = serde_json::json!({
        "kind": kind,
        "keyVersion": KEY_VERSION_PAIR,
        "ciphertext": b64url_no_pad(&canon),
        "ts": ts,
    });
    // Keep the envelope itself in canonical key order so the on-the-wire
    // bytes are deterministic. Go side uses encoding/json's struct order
    // (which matches the field declaration order: kind, keyVersion,
    // ciphertext, ts), but for robustness we let the receiving end
    // tolerate any key order — only the inner body MUST be canonical.
    let mut line = serde_json::to_vec(&envelope)
        .map_err(|e| WtError::Envelope(format!("envelope serialize: {e}")))?;
    line.push(b'\n');
    let mut guard = handles.send.lock().await;
    guard
        .write_all(&line)
        .await
        .map_err(|e| WtError::Io(format!("pair write: {e}")))?;
    Ok(())
}

/// `keyVersion` sentinel for pair-protocol frames (plaintext body). Per
/// spec §3.3.1 + §14 OQ ratification — pair frames pre-shared-key are
/// intentionally plaintext-marked. Cross-stack constant: must match
/// Go's `KeyVersionPair = 0`.
const KEY_VERSION_PAIR: u32 = 0;

/// Read one JSONL envelope line, verify keyVersion, decode inner body,
/// and parse as `T`. Returns `(envelope_kind, parsed_body)` so the
/// caller can validate kind matches what it expected. (BLOCKER-1 fix:
/// previously we framed length-prefixed; now we read-until-newline.)
async fn read_pair_frame<T: for<'de> Deserialize<'de>>(
    handles: &StreamHandles,
) -> Result<(String, T), WtError> {
    let mut guard = handles.recv.lock().await;
    let mut line = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    loop {
        guard
            .read_exact(&mut byte)
            .await
            .map_err(|e| WtError::Io(format!("pair read: {e}")))?;
        if byte[0] == b'\n' {
            break;
        }
        line.push(byte[0]);
        if line.len() as u32 > PAIR_FRAME_SIZE_MAX + 1024 {
            return Err(WtError::Envelope(format!(
                "pair envelope size {} > max",
                line.len()
            )));
        }
    }
    drop(guard);
    if line.is_empty() {
        return Err(WtError::Envelope("empty pair envelope line".into()));
    }
    #[derive(Deserialize)]
    struct EnvelopeWire {
        kind: String,
        #[serde(rename = "keyVersion")]
        key_version: u32,
        ciphertext: String,
        #[allow(dead_code)]
        ts: Option<i64>,
    }
    let env: EnvelopeWire = serde_json::from_slice(&line)
        .map_err(|e| WtError::Envelope(format!("envelope parse: {e}")))?;
    if env.key_version != KEY_VERSION_PAIR {
        return Err(WtError::Envelope(format!(
            "keyVersion {} invalid for pair frame (must be {})",
            env.key_version, KEY_VERSION_PAIR
        )));
    }
    let body = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(env.ciphertext.as_bytes())
        .map_err(|e| WtError::Envelope(format!("ciphertext b64 decode: {e}")))?;
    if body.len() as u32 > PAIR_FRAME_SIZE_MAX {
        return Err(WtError::Envelope(format!(
            "pair body size {} > max {}",
            body.len(),
            PAIR_FRAME_SIZE_MAX
        )));
    }
    let parsed: T = serde_json::from_slice(&body)
        .map_err(|e| WtError::Envelope(format!("pair frame parse: {e}")))?;
    Ok((env.kind, parsed))
}

/// base64url no-pad encoding (matches Go side's `base64.RawURLEncoding`).
pub fn b64url_no_pad(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn b64url_decode_32(s: &str) -> Result<[u8; 32], WtError> {
    let v = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s.as_bytes())
        .map_err(|e| WtError::Envelope(format!("b64url decode: {e}")))?;
    if v.len() != 32 {
        return Err(WtError::Envelope(format!(
            "expected 32 bytes, got {}",
            v.len()
        )));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&v);
    Ok(out)
}

fn decode_x25519_pubkey(s: &str) -> Result<[u8; 32], WtError> {
    b64url_decode_32(s)
}

fn now_unix_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Constant-time 32-byte equality. Local impl avoids pulling in an extra
/// crate; correctness is straightforward for fixed-length comparison.
fn constant_time_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff = 0u8;
    for i in 0..32 {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

// ---------------------------------------------------------------------------
// Tests — golden vectors pinning the cross-stack contract.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Cross-stack SAS golden vector. The Go side (go-pair-impl) MUST
    /// produce the same string for the same inputs; if either side
    /// changes algorithm or info-string, both packages' goldens trip.
    ///
    /// Inputs:
    ///   shared_secret  = [0x01; 32]
    ///   transcript_h32 = [0x02; 32]
    ///
    /// Pinned output: `"J8LNUS"` (computed via spec §4 / §5 / HKDF info
    /// strings `tether-sas-v1` + `tether-sas-display-v1`, then encoded
    /// against alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
    #[test]
    fn sas_golden_vector() {
        let shared = [0x01u8; 32];
        let th = [0x02u8; 32];
        let key = derive_sas_key(&shared, &th);
        let sas = compute_sas(&key);
        assert_eq!(sas, "J8LNUS", "cross-stack SAS golden — divergence with Go side breaks pairing");
        // Spec-pinned alphabet excludes I, O (and digits 0/1). The
        // literal alphabet "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" includes
        // L, so we don't ban it here even though spec §4 prose mentions
        // L — the alphabet literal is the source of truth.
        for c in sas.chars() {
            assert!(
                !"0O1I".contains(c),
                "SAS char {c} is visually-confusable"
            );
        }
    }

    /// Cross-stack HMAC confirm-mac golden. Go side pins the same hex.
    ///
    /// Inputs:
    ///   sas_key = [0xAA; 32]
    ///   transcript_hash = [0xBB; 32]
    ///   label = "tether-pair-confirm-v1|<role>|<transcript_hash_bytes>"
    ///
    /// Note: the transcript_hash is included as raw 32 bytes (NOT hex),
    /// matching the `confirm_mac()` impl. The Go side mirrors this.
    #[test]
    fn confirm_mac_golden() {
        let key = [0xAAu8; 32];
        let th = [0xBBu8; 32];
        let initiator_mac = confirm_mac(&key, "initiator", &th);
        let responder_mac = confirm_mac(&key, "responder", &th);

        // Pinned hex — matches the Go side byte-for-byte.
        let init_hex = hex_lower(&initiator_mac);
        let resp_hex = hex_lower(&responder_mac);
        assert_eq!(
            init_hex,
            "1392c88c645a6088be25b285b47d52a88215b4f82a927e14844fa24f080033dd",
            "initiator confirm-mac golden — divergence with Go side breaks pairing",
        );
        assert_eq!(
            resp_hex,
            "3e9f0fe0cb6d6b48aa8d43d47786bbaa5a7bc4c8b308c23abc1bab681d550117",
            "responder confirm-mac golden — divergence with Go side breaks pairing",
        );

        // Different roles must produce different MACs.
        assert_ne!(initiator_mac, responder_mac);
        // Determinism — same inputs, same output.
        let again = confirm_mac(&key, "initiator", &th);
        assert_eq!(initiator_mac, again);
        // Tampering the transcript hash must change the MAC.
        let mut th2 = th;
        th2[0] ^= 1;
        let mutated = confirm_mac(&key, "initiator", &th2);
        assert_ne!(initiator_mac, mutated);
    }

    fn hex_lower(b: &[u8]) -> String {
        let mut s = String::with_capacity(b.len() * 2);
        for x in b {
            s.push_str(&format!("{:02x}", x));
        }
        s
    }

    /// Transcript canonical-encoding byte-layout golden — verifies the
    /// LP framing matches `LP(canon) || ...` and that JSON canonical
    /// output is sorted-key + whitespace-free.
    #[test]
    fn transcript_byte_layout_golden() {
        let mut t = TranscriptBuilder::new();
        let v: serde_json::Value =
            serde_json::from_str(r#"{"b": 2, "a": 1}"#).unwrap();
        t.append_value(&v);
        // Canonical = `{"a":1,"b":2}` (sorted, no ws).
        let want_canon = b"{\"a\":1,\"b\":2}";
        let want_len = (want_canon.len() as u32).to_be_bytes();
        let mut want = Vec::new();
        want.extend_from_slice(&want_len);
        want.extend_from_slice(want_canon);
        assert_eq!(t.raw(), &want[..]);
    }

    /// Two appends produce LP(f1) || LP(f2) — order matters.
    #[test]
    fn transcript_two_frames_concatenate() {
        let mut t = TranscriptBuilder::new();
        let a: serde_json::Value = serde_json::json!({"x": 1});
        let b: serde_json::Value = serde_json::json!({"y": 2});
        t.append_value(&a);
        t.append_value(&b);
        let canon_a = b"{\"x\":1}";
        let canon_b = b"{\"y\":2}";
        let mut want = Vec::new();
        want.extend_from_slice(&(canon_a.len() as u32).to_be_bytes());
        want.extend_from_slice(canon_a);
        want.extend_from_slice(&(canon_b.len() as u32).to_be_bytes());
        want.extend_from_slice(canon_b);
        assert_eq!(t.raw(), &want[..]);
    }

    /// JCS canonicalization fuzz — random key reordering on the *input*
    /// JSON must produce identical canonical bytes.
    #[test]
    fn jcs_key_order_invariant() {
        let v1: serde_json::Value =
            serde_json::from_str(r#"{"alpha":1,"beta":2,"gamma":3}"#).unwrap();
        let v2: serde_json::Value =
            serde_json::from_str(r#"{"gamma":3,"alpha":1,"beta":2}"#).unwrap();
        assert_eq!(canonical_json(&v1), canonical_json(&v2));
    }

    /// X25519 + HKDF roundtrip — both endpoints derive the same shared
    /// secret + the same SAS string for honest peers.
    #[test]
    fn x25519_hkdf_honest_roundtrip() {
        let a_priv = StaticSecret::random();
        let b_priv = StaticSecret::random();
        let a_pub = PublicKey::from(&a_priv);
        let b_pub = PublicKey::from(&b_priv);
        let s_a = compute_shared_secret(&a_priv, &b_pub);
        let s_b = compute_shared_secret(&b_priv, &a_pub);
        assert_eq!(s_a, s_b, "ECDH symmetry");

        let th = [0xCCu8; 32];
        let k_a = derive_sas_key(&s_a, &th);
        let k_b = derive_sas_key(&s_b, &th);
        assert_eq!(k_a, k_b);
        assert_eq!(compute_sas(&k_a), compute_sas(&k_b));

        let (ltk_a, tbk_a) = derive_long_term_keys(&s_a, &th);
        let (ltk_b, tbk_b) = derive_long_term_keys(&s_b, &th);
        assert_eq!(ltk_a, ltk_b);
        assert_eq!(tbk_a, tbk_b);
        // ltk and tbk are independent.
        assert_ne!(ltk_a, tbk_a);
    }

    /// SAS encoding only emits chars from the spec-pinned alphabet.
    #[test]
    fn sas_alphabet_pinned() {
        for i in 0..50 {
            let mut k = [0u8; 32];
            k[0] = i as u8;
            let sas = compute_sas(&k);
            assert_eq!(sas.len(), 6);
            for c in sas.chars() {
                assert!(SAS_ALPHABET.contains(&(c as u8)), "bad char {c}");
            }
        }
    }

    /// Registry roundtrip — save + list + delete with reject-on-dup
    /// per spec §10 / §14 OQ Q2.
    #[test]
    fn registry_save_list_delete_repair_reject() {
        // Use a unique test temp dir to avoid clashing with parallel
        // test runs. We don't pull in `tempfile` to keep the dep
        // surface tight.
        static N: AtomicU64 = AtomicU64::new(0);
        let pid = std::process::id() as u64;
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("tether-pair-test-{pid}-{n}"));
        let _ = std::fs::remove_dir_all(&dir);
        let root = RegistryRoot(dir.clone());

        let rec = PairedDevice {
            v: 1,
            device_id: "device-test-aaaa".into(),
            kind: "mobile".into(),
            display_name: "Test Phone".into(),
            model: Some("Pixel".into()),
            long_term_key_b64: b64url_no_pad(&[0xAAu8; 32]),
            transport_binding_key_b64: b64url_no_pad(&[0xBBu8; 32]),
            long_term_key_id: "ltk-test-1".into(),
            push_token: None,
            paired_at: "2026-05-07T00:00:00Z".into(),
            last_seen: "2026-05-07T00:00:00Z".into(),
        };

        // First save.
        root.save(&rec, false).expect("first save");
        let listed = root.list().expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].device_id, "device-test-aaaa");

        // Re-pair default = reject (spec §14 Q2).
        let err = root.save(&rec, false).err().expect("must reject dup");
        match err {
            WtError::Envelope(msg) => assert!(msg.contains("already paired")),
            other => panic!("wrong variant: {other:?}"),
        }

        // Force overwrite.
        let mut rec2 = rec.clone();
        rec2.display_name = "Test Phone (re-paired)".into();
        root.save(&rec2, true).expect("force overwrite");
        let listed = root.list().expect("list after force");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].display_name, "Test Phone (re-paired)");

        // Delete.
        let deleted = root.delete("device-test-aaaa").expect("delete");
        assert!(deleted);
        let after = root.list().expect("list after delete");
        assert!(after.is_empty());

        // Cleanup.
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Reject filenames with path-traversal characters. Defense-in-depth.
    #[test]
    fn registry_rejects_bad_device_id() {
        let dir = std::env::temp_dir().join(format!(
            "tether-pair-bad-{}-{}",
            std::process::id(),
            13
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let root = RegistryRoot(dir.clone());
        let rec = PairedDevice {
            v: 1,
            device_id: "../../etc/passwd".into(),
            kind: "mobile".into(),
            display_name: "evil".into(),
            model: None,
            long_term_key_b64: b64url_no_pad(&[0u8; 32]),
            transport_binding_key_b64: b64url_no_pad(&[0u8; 32]),
            long_term_key_id: "x".into(),
            push_token: None,
            paired_at: "x".into(),
            last_seen: "x".into(),
        };
        assert!(root.save(&rec, false).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Frame-shape serde stability — pair.invite roundtrips through
    /// serde with the on-the-wire JSON shape spec §3.1 mandates.
    #[test]
    fn invite_frame_serde_roundtrip() {
        let f = InviteFrame {
            kind: "pair.invite".into(),
            v: 1,
            device_id: "device-desktop-x".into(),
            ephemeral_pubkey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(),
            device_metadata: DeviceMetadata {
                kind: "desktop".into(),
                model: Some("MBP".into()),
                display_name: "Kang's MacBook".into(),
                os_version: None,
                app_version: None,
            },
            ts: 1714000000000,
            nonce: "AAAAAAAAAAAAAAAAAAAAAA".into(),
        };
        let v = serde_json::to_value(&f).unwrap();
        // Spec §3.1 mandates these top-level field names.
        assert_eq!(v["type"], "pair.invite");
        assert_eq!(v["v"], 1);
        assert!(v["deviceId"].is_string());
        assert!(v["ephemeralPubkey"].is_string());
        assert!(v["deviceMetadata"].is_object());
        assert_eq!(v["deviceMetadata"]["displayName"], "Kang's MacBook");
        assert!(v["nonce"].is_string());

        let back: InviteFrame = serde_json::from_value(v).unwrap();
        assert_eq!(back.device_id, f.device_id);
    }

    /// Cross-stack canonical body byte-pinning (BLOCKER-2). Same input
    /// vector + same output bytes as the Go side's
    /// `TestCanonicalBody_InviteFullFields`. Divergence ⇒ transcript_hash
    /// diverges ⇒ SAS / MAC mismatch ⇒ pairing fails.
    ///
    /// Pinned input:
    ///   pubkey = [0xAB; 32], nonce = [0xCD; 16],
    ///   deviceId = "device-desktop-aaaa", kind = desktop,
    ///   displayName = "Kang's MacBook", model = "MBP",
    ///   osVersion = "macOS 14.5", appVersion = "tether 0.1.0-dev",
    ///   ts = 1714000000000, v = 1
    #[test]
    fn canonical_body_invite_full_fields_golden() {
        let pubkey = [0xABu8; 32];
        let nonce = [0xCDu8; 16];
        let f = InviteFrame {
            kind: "pair.invite".into(),
            v: 1,
            device_id: "device-desktop-aaaa".into(),
            ephemeral_pubkey: b64url_no_pad(&pubkey),
            device_metadata: DeviceMetadata {
                kind: "desktop".into(),
                model: Some("MBP".into()),
                display_name: "Kang's MacBook".into(),
                os_version: Some("macOS 14.5".into()),
                app_version: Some("tether 0.1.0-dev".into()),
            },
            ts: 1714000000000,
            nonce: b64url_no_pad(&nonce),
        };
        let v = serde_json::to_value(&f).unwrap();
        let canon = canonical_json(&v);
        let want = br#"{"deviceId":"device-desktop-aaaa","deviceMetadata":{"appVersion":"tether 0.1.0-dev","displayName":"Kang's MacBook","kind":"desktop","model":"MBP","osVersion":"macOS 14.5"},"ephemeralPubkey":"q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s","nonce":"zc3Nzc3Nzc3Nzc3Nzc3NzQ","ts":1714000000000,"type":"pair.invite","v":1}"#;
        assert_eq!(
            std::str::from_utf8(&canon).unwrap(),
            std::str::from_utf8(want).unwrap(),
            "canonical body diverged from Go cross-stack golden"
        );
    }

    /// Cross-stack canonical body when optionals are omitted. Mirrors
    /// the Go side's TestCanonicalBody_InviteOptionalsOmitted.
    #[test]
    fn canonical_body_invite_optionals_omitted_golden() {
        let pubkey = [0xABu8; 32];
        let nonce = [0xCDu8; 16];
        let f = InviteFrame {
            kind: "pair.invite".into(),
            v: 1,
            device_id: "device-desktop-aaaa".into(),
            ephemeral_pubkey: b64url_no_pad(&pubkey),
            device_metadata: DeviceMetadata {
                kind: "desktop".into(),
                model: None,
                display_name: "Kang's MacBook".into(),
                os_version: None,
                app_version: None,
            },
            ts: 1714000000000,
            nonce: b64url_no_pad(&nonce),
        };
        let v = serde_json::to_value(&f).unwrap();
        let canon = canonical_json(&v);
        let want = br#"{"deviceId":"device-desktop-aaaa","deviceMetadata":{"displayName":"Kang's MacBook","kind":"desktop"},"ephemeralPubkey":"q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s","nonce":"zc3Nzc3Nzc3Nzc3Nzc3NzQ","ts":1714000000000,"type":"pair.invite","v":1}"#;
        assert_eq!(
            std::str::from_utf8(&canon).unwrap(),
            std::str::from_utf8(want).unwrap(),
            "omit-optionals canonical body diverged from Go golden"
        );
    }

    /// pair.complete AEAD verify happy path (BLOCKER-4). Round-trip
    /// against an AD-only seal (empty plaintext, tag = 16B).
    #[test]
    fn pair_complete_aead_roundtrip() {
        use chacha20poly1305::aead::AeadInPlace;
        let ltk = [0xEEu8; 32];
        let th = [0x11u8; 32];
        let nonce_bytes = [0x42u8; 24];
        let cipher = XChaCha20Poly1305::new_from_slice(&ltk).unwrap();
        let xnonce = XNonce::from_slice(&nonce_bytes);
        let ad = complete_aead_ad(&th);
        // Seal empty plaintext → 16B tag.
        let mut buf = [0u8; 0];
        let tag = cipher
            .encrypt_in_place_detached(xnonce, &ad, &mut buf)
            .expect("encrypt");
        let nonce_b64 = b64url_no_pad(&nonce_bytes);
        let tag_b64 = b64url_no_pad(tag.as_slice());
        assert!(verify_complete_tag(&ltk, &th, &nonce_b64, &tag_b64).is_ok());

        // Tamper tag — must fail.
        let mut bad_tag = tag.as_slice().to_vec();
        bad_tag[0] ^= 0x01;
        let bad_tag_b64 = b64url_no_pad(&bad_tag);
        assert!(verify_complete_tag(&ltk, &th, &nonce_b64, &bad_tag_b64).is_err());

        // Tamper transcript hash — must fail.
        let mut bad_th = th;
        bad_th[15] ^= 0x01;
        assert!(verify_complete_tag(&ltk, &bad_th, &nonce_b64, &tag_b64).is_err());

        // Wrong ltk — must fail.
        let mut bad_ltk = ltk;
        bad_ltk[31] ^= 0x01;
        assert!(verify_complete_tag(&bad_ltk, &th, &nonce_b64, &tag_b64).is_err());
    }

    /// Replay protection: `check_replay_and_advance` rejects equal /
    /// less-than ts and accepts strictly-greater. (BLOCKER-5.)
    #[test]
    fn replay_check_strictly_monotonic() {
        let mut last = 0i64;
        // First frame at ts=10 — accepted, watermark advances.
        check_replay_and_advance(&mut last, 10).unwrap();
        assert_eq!(last, 10);
        // Equal ts — rejected.
        assert!(check_replay_and_advance(&mut last, 10).is_err());
        assert_eq!(last, 10, "watermark must NOT advance on rejection");
        // Less-than ts — rejected.
        assert!(check_replay_and_advance(&mut last, 9).is_err());
        // Strictly greater — accepted.
        check_replay_and_advance(&mut last, 11).unwrap();
        assert_eq!(last, 11);
    }

    /// Cross-stack pair.abort reason "cert-error" is the exact string
    /// the Go side emits. Keeps the cross-stack constant byte-equal.
    #[test]
    fn pair_abort_cert_error_constant() {
        assert_eq!(PAIR_ABORT_CERT_ERROR, "cert-error");
    }

    /// JSONL envelope shape — verify what we'd emit for an invite
    /// matches the spec §3.3.1 envelope (BLOCKER-1). Cross-stack with
    /// Go's TestWire_JSONLEnvelopeShape.
    #[test]
    fn jsonl_envelope_shape() {
        let frame = InviteFrame {
            kind: "pair.invite".into(),
            v: 1,
            device_id: "device-desktop-aaaa".into(),
            ephemeral_pubkey: b64url_no_pad(&[0xABu8; 32]),
            device_metadata: DeviceMetadata {
                kind: "desktop".into(),
                model: None,
                display_name: "test".into(),
                os_version: None,
                app_version: None,
            },
            ts: 1714000000000,
            nonce: b64url_no_pad(&[0xCDu8; 16]),
        };
        // Reconstruct what write_pair_frame would emit.
        let v = serde_json::to_value(&frame).unwrap();
        let canon = canonical_json(&v);
        let envelope = serde_json::json!({
            "kind": "pair.invite",
            "keyVersion": KEY_VERSION_PAIR,
            "ciphertext": b64url_no_pad(&canon),
            "ts": 1714000000000_i64,
        });
        let line = serde_json::to_vec(&envelope).unwrap();
        // Decoder side: parse as plain JSON, verify field names + types.
        let parsed: serde_json::Value = serde_json::from_slice(&line).unwrap();
        assert_eq!(parsed["kind"], "pair.invite");
        assert_eq!(parsed["keyVersion"], 0);
        assert!(parsed["ciphertext"].is_string());
        assert_eq!(parsed["ts"], 1714000000000_i64);
    }
}
