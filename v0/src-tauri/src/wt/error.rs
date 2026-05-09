use thiserror::Error;

#[derive(Debug, Error)]
pub enum WtError {
    #[error("bad url: {0}")]
    BadUrl(String),

    #[error("bad id: {0}")]
    BadId(String),

    #[error("unknown session: {0}")]
    UnknownSession(String),

    #[error("unknown stream: {0}")]
    UnknownStream(String),

    #[error("connect failed: {0}")]
    Connect(String),

    #[error("connect timed out")]
    Timeout,

    #[error("tls config error: {0}")]
    Tls(String),

    #[error("stream error: {0}")]
    Stream(String),

    #[error("io error: {0}")]
    Io(String),

    /// Wire-envelope (slice #3) layer error: malformed JSON, bad
    /// length-prefix, AEAD auth failure, unsupported keyVersion.
    #[error("envelope error: {0}")]
    Envelope(String),

    /// Pair-protocol abort surface — the string carries the spec §3.5
    /// `reason` enum value (e.g. `"cert-error"`, `"sas-mismatch"`,
    /// `"replay"`). Distinct from `Envelope` so callers can map cleanly
    /// to user-facing pair-flow UX.
    #[error("pair: {0}")]
    Pair(String),
}
