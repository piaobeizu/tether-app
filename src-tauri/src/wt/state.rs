//! Per-process registry of WT sessions + streams.
//!
//! IDs are issued from a monotonic AtomicU64 and stringified at the IPC
//! boundary. Concurrent map = `dashmap` (lock-free reads, sharded writes).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::Mutex;

use super::error::WtError;

/// What we hold per active session — currently just the session handle.
/// Future: add per-session metadata (peer URL, opened-at, stats).
pub struct SessionEntry {
    pub session: web_transport_quinn::Session,
}

impl SessionEntry {
    pub fn new(session: web_transport_quinn::Session) -> Self {
        Self { session }
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

    pub fn insert_stream(&self, entry: StreamEntry) -> u64 {
        let id = self.next_stream.fetch_add(1, Ordering::Relaxed) + 1;
        self.streams.insert(id, Arc::new(entry));
        id
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
        self.sessions
            .remove(&id)
            .map(|(_, v)| v)
            .ok_or_else(|| WtError::UnknownSession(id_str.to_string()))
    }
}
