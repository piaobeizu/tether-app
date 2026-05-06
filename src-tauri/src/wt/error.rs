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
}
