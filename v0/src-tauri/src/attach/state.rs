//! Per-process registry of live attach subscriptions.
//!
//! Keyed by monotonic u64 IDs (issued by `mod.rs::NEXT_SUB`). Each row
//! owns a `CancellationToken` that the spawned read-loop selects against
//! and (optionally) an `Arc<Mutex<OwnedWriteHalf>>` for rw-mode input
//! frame submission.

use std::sync::Arc;

use dashmap::DashMap;
use tokio::net::unix::OwnedWriteHalf;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct AttachState {
    inner: Arc<AttachStateInner>,
}

#[derive(Default)]
pub struct AttachStateInner {
    rows: DashMap<u64, Row>,
}

struct Row {
    cancel: CancellationToken,
    /// Populated on rw subscriptions only; ro rows leave this `None`
    /// so a stray `tether_attach_send_input` errors out cleanly.
    send: Option<Arc<Mutex<OwnedWriteHalf>>>,
}

impl AttachState {
    pub fn insert(&self, id: u64, cancel: CancellationToken) {
        self.inner.rows.insert(id, Row { cancel, send: None });
    }

    pub fn attach_send(&self, id: u64, send: Arc<Mutex<OwnedWriteHalf>>) {
        if let Some(mut r) = self.inner.rows.get_mut(&id) {
            r.send = Some(send);
        }
    }

    pub fn send_handle(&self, id: u64) -> Option<Arc<Mutex<OwnedWriteHalf>>> {
        self.inner.rows.get(&id).and_then(|r| r.send.clone())
    }

    pub fn cancel(&self, id: u64) {
        if let Some(r) = self.inner.rows.get(&id) {
            r.cancel.cancel();
        }
    }

    /// Drop a subscription row by id. Called from the spawned task's
    /// cleanup leg (see `inner_arc()` for the cross-scope handle).
    /// Idempotent — duplicate removes are no-ops.
    #[allow(dead_code)]
    pub fn remove(&self, id: u64) {
        self.inner.rows.remove(&id);
    }

    /// Return a clone of the inner Arc — used when the AppHandle-side
    /// cleanup task needs to drop a row from a different scope.
    pub fn inner_arc(&self) -> Arc<AttachStateInner> {
        self.inner.clone()
    }
}

impl AttachStateInner {
    pub fn remove(&self, id: u64) {
        self.rows.remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_then_cancel_signals_token() {
        let state = AttachState::default();
        let token = CancellationToken::new();
        state.insert(7, token.clone());
        assert!(!token.is_cancelled());
        state.cancel(7);
        assert!(token.is_cancelled());
    }

    #[test]
    fn cancel_missing_id_is_noop() {
        let state = AttachState::default();
        // No panic, no error — just nothing happens.
        state.cancel(999);
    }

    #[test]
    fn send_handle_returns_none_for_ro_subscription() {
        let state = AttachState::default();
        state.insert(1, CancellationToken::new());
        assert!(state.send_handle(1).is_none());
    }

    #[test]
    fn remove_clears_row() {
        let state = AttachState::default();
        state.insert(2, CancellationToken::new());
        assert!(state.send_handle(2).is_none()); // exists but no send
        state.remove(2);
        // After remove, even cancel does nothing (no row to find).
        state.cancel(2);
    }
}
