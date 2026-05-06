//! Per-process registry of WT sessions + streams.
//!
//! IDs are issued from a monotonic AtomicU64 and stringified at the IPC
//! boundary. Concurrent map = `dashmap` (lock-free reads, sharded writes).
//!
//! ## Cleanup contract (BLOCKER 1 fix)
//!
//! Each `SessionEntry` carries a back-pointer set `stream_ids` listing
//! every stream id opened against it. `WtState::remove_session` drains
//! that set from the streams registry, so closing a session evicts all
//! its streams in one shot. `WtState::remove_stream` is the per-stream
//! evict path, used by `wt_close_stream` and by `wt_recv` when the
//! peer cleanly half-closes.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use dashmap::{DashMap, DashSet};
use tokio::sync::Mutex;

use super::error::WtError;

/// What we hold per active session.
pub struct SessionEntry {
    pub session: web_transport_quinn::Session,
    pub stream_ids: DashSet<u64>,
}

impl SessionEntry {
    pub fn new(session: web_transport_quinn::Session) -> Self {
        Self {
            session,
            stream_ids: DashSet::new(),
        }
    }
}

/// One entry per opened stream.
///
/// We keep send + recv halves separately wrapped in Mutexes so the JS shim's
/// `send` and `recv` calls don't contend.
pub enum StreamEntry {
    Bidi {
        send: Arc<Mutex<web_transport_quinn::SendStream>>,
        recv: Arc<Mutex<web_transport_quinn::RecvStream>>,
    },
    Uni {
        send: Arc<Mutex<web_transport_quinn::SendStream>>,
    },
}

impl StreamEntry {
    pub fn send_handle(&self) -> Option<&Arc<Mutex<web_transport_quinn::SendStream>>> {
        match self {
            StreamEntry::Bidi { send, .. } => Some(send),
            StreamEntry::Uni { send } => Some(send),
        }
    }

    pub fn recv_handle(&self) -> Option<&Arc<Mutex<web_transport_quinn::RecvStream>>> {
        match self {
            StreamEntry::Bidi { recv, .. } => Some(recv),
            StreamEntry::Uni { .. } => None,
        }
    }
}

#[derive(Default)]
pub struct WtState {
    sessions: DashMap<u64, Arc<SessionEntry>>,
    streams: DashMap<u64, Arc<StreamEntry>>,
    next_session: AtomicU64,
    next_stream: AtomicU64,
}

impl WtState {
    pub fn insert_session(&self, entry: SessionEntry) -> u64 {
        let id = self.next_session.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.insert(id, Arc::new(entry));
        id
    }

    /// Register a stream and back-link it to its parent session so
    /// `remove_session` can drain it. Returns the new stream id.
    ///
    /// `session_id` must reference a currently-live session (caller
    /// already holds `Arc<SessionEntry>` from `get_session`); we don't
    /// re-validate it. If the session has just been removed by a racing
    /// close the back-link silently no-ops, but the stream itself is
    /// still inserted (`wt_close_stream` can evict it).
    pub fn insert_stream(&self, session_id: u64, entry: StreamEntry) -> u64 {
        let id = self.next_stream.fetch_add(1, Ordering::Relaxed) + 1;
        self.streams.insert(id, Arc::new(entry));
        if let Some(sess) = self.sessions.get(&session_id) {
            sess.stream_ids.insert(id);
        }
        id
    }

    /// Remove a single stream from the registry. Idempotent — calling on
    /// an already-evicted id is a no-op (no error). Used by:
    ///   - `wt_close_stream` (explicit JS-side close)
    ///   - `wt_recv` when the inner read returns `Ok(None)` (peer cleanly
    ///     closed the send side, so the stream is no longer usable).
    pub fn remove_stream(&self, id: u64) {
        self.streams.remove(&id);
    }

    /// Parse a stringified stream id; thin wrapper used by command code.
    pub fn parse_stream_id(id_str: &str) -> Result<u64, WtError> {
        id_str
            .parse()
            .map_err(|_| WtError::BadId(id_str.to_string()))
    }

    pub fn get_session(&self, id_str: &str) -> Result<Arc<SessionEntry>, WtError> {
        let id: u64 = id_str
            .parse()
            .map_err(|_| WtError::BadId(id_str.to_string()))?;
        self.sessions
            .get(&id)
            .map(|e| e.clone())
            .ok_or_else(|| WtError::UnknownSession(id_str.to_string()))
    }

    /// Parse a session id and return the numeric value (used by command
    /// code that needs to call `insert_stream(parent_session_id, ...)`).
    pub fn parse_session_id(id_str: &str) -> Result<u64, WtError> {
        id_str
            .parse()
            .map_err(|_| WtError::BadId(id_str.to_string()))
    }

    pub fn get_stream(&self, id_str: &str) -> Result<Arc<StreamEntry>, WtError> {
        let id: u64 = id_str
            .parse()
            .map_err(|_| WtError::BadId(id_str.to_string()))?;
        self.streams
            .get(&id)
            .map(|e| e.clone())
            .ok_or_else(|| WtError::UnknownStream(id_str.to_string()))
    }

    pub fn remove_session(&self, id_str: &str) -> Result<Arc<SessionEntry>, WtError> {
        let id: u64 = id_str
            .parse()
            .map_err(|_| WtError::BadId(id_str.to_string()))?;
        let entry = self
            .sessions
            .remove(&id)
            .map(|(_, v)| v)
            .ok_or_else(|| WtError::UnknownSession(id_str.to_string()))?;

        // Drain every stream that was opened against this session.
        // Snapshot the back-pointer set first; collect into Vec so we
        // don't hold a dashmap iterator borrow while mutating.
        let stream_ids: Vec<u64> = entry.stream_ids.iter().map(|r| *r).collect();
        for sid in stream_ids {
            self.streams.remove(&sid);
        }
        entry.stream_ids.clear();

        Ok(entry)
    }
}

// ---------------------------------------------------------------------------
// Tests — registry-level cleanup (BLOCKER 1 fix)
//
// We can't construct a real `web_transport_quinn::Session` /
// `SendStream` / `RecvStream` without a live QUIC handshake, so the
// tests below verify the registry bookkeeping by exercising a
// type-erased shadow of `WtState`'s data layout: a parallel
// `RegistryShape` that uses `()` payloads. The cleanup logic
// (`remove_session` drains `stream_ids` from the streams map) is
// algorithmically identical and lives in plain dashmap calls.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use dashmap::{DashMap, DashSet};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    /// Type-erased mirror of `WtState` — same bookkeeping, no
    /// `web_transport_quinn` types. The production cleanup path lives
    /// almost entirely in `remove_session` / `remove_stream` / the
    /// back-pointer maintenance in `insert_stream`; we lift those into
    /// inherent methods here and assert their behavior.
    #[derive(Default)]
    struct RegistryShape {
        sessions: DashMap<u64, Arc<SessionShadow>>,
        streams: DashMap<u64, Arc<()>>,
        next_session: AtomicU64,
        next_stream: AtomicU64,
    }

    struct SessionShadow {
        stream_ids: DashSet<u64>,
    }

    impl RegistryShape {
        fn insert_session(&self) -> u64 {
            let id = self.next_session.fetch_add(1, Ordering::Relaxed) + 1;
            self.sessions.insert(
                id,
                Arc::new(SessionShadow {
                    stream_ids: DashSet::new(),
                }),
            );
            id
        }

        fn insert_stream(&self, session_id: u64) -> u64 {
            let id = self.next_stream.fetch_add(1, Ordering::Relaxed) + 1;
            self.streams.insert(id, Arc::new(()));
            if let Some(sess) = self.sessions.get(&session_id) {
                sess.stream_ids.insert(id);
            }
            id
        }

        fn remove_stream(&self, id: u64) {
            self.streams.remove(&id);
        }

        fn remove_session(&self, id: u64) -> Option<Arc<SessionShadow>> {
            let (_, entry) = self.sessions.remove(&id)?;
            let stream_ids: Vec<u64> = entry.stream_ids.iter().map(|r| *r).collect();
            for sid in stream_ids {
                self.streams.remove(&sid);
            }
            entry.stream_ids.clear();
            Some(entry)
        }
    }

    /// Three streams opened on a session; closing the session must drain
    /// the stream registry. Asserts the BLOCKER 1 contract directly on
    /// the same dashmap-bookkeeping shape used by `WtState`.
    #[test]
    fn remove_session_drains_streams() {
        let reg = RegistryShape::default();
        let sid = reg.insert_session();
        for _ in 0..3 {
            reg.insert_stream(sid);
        }
        assert_eq!(reg.streams.len(), 3, "three streams should be live");
        assert_eq!(reg.sessions.len(), 1, "one session should be live");

        let _ = reg.remove_session(sid).expect("session should be removed");
        assert_eq!(
            reg.streams.len(),
            0,
            "all streams must be evicted on session close"
        );
        assert_eq!(
            reg.sessions.len(),
            0,
            "session must be removed from registry"
        );
    }

    /// `remove_stream` is the per-stream evict path (used by
    /// `wt_close_stream` and `wt_recv` on Ok(None)). Must be idempotent
    /// and must actually remove the row.
    #[test]
    fn remove_stream_evicts_and_is_idempotent() {
        let reg = RegistryShape::default();
        let sid = reg.insert_session();
        let stream_id = reg.insert_stream(sid);
        assert_eq!(reg.streams.len(), 1);

        reg.remove_stream(stream_id);
        assert_eq!(reg.streams.len(), 0);

        // Calling again on a missing id is a no-op (no panic).
        reg.remove_stream(stream_id);
        assert_eq!(reg.streams.len(), 0);
    }

    /// Back-pointer is populated on `insert_stream` and persists until
    /// either `remove_session` (drains it) or process exit. Verifies the
    /// "session knows its streams" half of the contract.
    #[test]
    fn insert_stream_back_links_to_session() {
        let reg = RegistryShape::default();
        let sid = reg.insert_session();
        let s1 = reg.insert_stream(sid);
        let s2 = reg.insert_stream(sid);

        let sess = reg.sessions.get(&sid).expect("session present");
        assert!(sess.stream_ids.contains(&s1));
        assert!(sess.stream_ids.contains(&s2));
        assert_eq!(sess.stream_ids.len(), 2);
    }
}
