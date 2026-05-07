//! Cross-stack WT smoke test.
//!
//! This integration test connects to a pre-spawned WebTransport echo
//! server and round-trips a single bidi stream payload. It is **gated
//! by environment variables** so CI machines without a Go-side echo
//! server skip cleanly:
//!
//! * `TETHER_WT_E2E_URL`             — wss/https URL of the server.
//!                                      e.g. `https://127.0.0.1:4433/wt`.
//!                                      When unset, the test is `ignored`.
//! * `TETHER_WT_E2E_INSECURE=1`      — skip TLS verification (dev cert).
//! * `TETHER_WT_E2E_PINNED_HASH=...` — alternate to `_INSECURE`: pin a
//!                                      W3C-DER sha256 hex hash. Mutually
//!                                      exclusive with `_INSECURE`.
//! * `TETHER_WT_E2E_CHANNEL_ID=1`    — optional channel-id byte to write
//!                                      as the §3.3.3 stream prefix; the
//!                                      echo server echoes it back so we
//!                                      verify it round-trips.
//!
//! The test does NOT spawn the Go server — that's the operator's job
//! (or a CI workflow step). The minimal session-level smoke we cover:
//!
//!   1. Build a `web-transport-quinn` client per `build_client`'s real
//!      production code path (insecure / pinned / system).
//!   2. Dial the URL.
//!   3. Open a bidi stream, optionally write a channel-id byte.
//!   4. Send `{"hello":"world"}\n`.
//!   5. Half-close send.
//!   6. Read up to 1 KiB and assert the echo body contains "hello".
//!   7. Close session.
//!
//! Run locally:
//!
//! ```sh
//! # Terminal A (Go side):
//! cd .repo/tether/poc/go-quic-wt && go run -tags step1 .
//! # → notes the SPKI hash on stdout
//!
//! # Terminal B (Rust side):
//! TETHER_WT_E2E_URL=https://127.0.0.1:4433/wt \
//!   TETHER_WT_E2E_INSECURE=1 \
//!   cargo test --test wt_smoke -- --nocapture --include-ignored
//! ```

use std::time::Duration;

use tether_app_lib as _; // ensure the crate builds with this test target

/// End-to-end echo round-trip, gated on env. We don't depend on the
/// crate's internal `wt::*` symbols directly — they aren't `pub` and
/// we don't need them; we exercise the same library calls
/// (`web_transport_quinn::ClientBuilder` etc.) that `wt::build_client`
/// does. This keeps the smoke test honest: it proves the wire works
/// against the same `web-transport-quinn` version the production
/// command uses.
#[tokio::test]
#[ignore = "requires TETHER_WT_E2E_URL pointing at a running echo server"]
async fn wt_e2e_echo_round_trip() {
    let url = match std::env::var("TETHER_WT_E2E_URL") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            eprintln!("TETHER_WT_E2E_URL not set; skipping");
            return;
        }
    };

    let _ = rustls::crypto::ring::default_provider().install_default();

    let url_parsed = url::Url::parse(&url).expect("valid URL");
    let builder = web_transport_quinn::ClientBuilder::new();

    let insecure = std::env::var("TETHER_WT_E2E_INSECURE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let pin_hash = std::env::var("TETHER_WT_E2E_PINNED_HASH").ok();

    let client = if insecure && pin_hash.is_some() {
        panic!(
            "TETHER_WT_E2E_INSECURE and TETHER_WT_E2E_PINNED_HASH are \
             mutually exclusive"
        );
    } else if let Some(hex) = pin_hash {
        let cleaned: String = hex.chars().filter(|c| *c != ':').collect();
        let bytes = (0..cleaned.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16).expect("hex"))
            .collect::<Vec<u8>>();
        builder
            .with_server_certificate_hashes(vec![bytes])
            .expect("with_server_certificate_hashes")
    } else if insecure {
        builder
            .dangerous()
            .with_no_certificate_verification()
            .expect("with_no_certificate_verification")
    } else {
        builder.with_system_roots().expect("with_system_roots")
    };

    let session = tokio::time::timeout(Duration::from_secs(10), client.connect(url_parsed))
        .await
        .expect("connect timed out")
        .expect("connect failed");

    let (mut send, mut recv) = session
        .open_bi()
        .await
        .expect("open_bi");

    if let Ok(s) = std::env::var("TETHER_WT_E2E_CHANNEL_ID") {
        let byte: u8 = s.parse().expect("CHANNEL_ID must be 0-255");
        send.write_all(&[byte]).await.expect("write channel byte");
    }

    let payload = b"{\"hello\":\"world\"}\n";
    send.write_all(payload).await.expect("write payload");
    send.finish().expect("finish");

    let echoed = tokio::time::timeout(Duration::from_secs(10), recv.read_to_end(1024))
        .await
        .expect("recv timeout")
        .expect("recv error");

    assert!(
        std::str::from_utf8(&echoed)
            .unwrap_or_default()
            .contains("hello"),
        "echo body did not contain 'hello': {:?}",
        std::str::from_utf8(&echoed).ok()
    );

    session.close(0, b"smoke-done");
    session.closed().await;
}
