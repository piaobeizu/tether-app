// tether-app library entrypoint.
//
// Both the desktop binary (`main.rs`) and the mobile entrypoints
// (Tauri-generated `lib_main.rs` for Android/iOS) call `run()`.
//
// ## Plugin wiring (PR-3 BLOCKER 2 fix)
//
// `capabilities/default.json` declares permissions for `fs`, `deep-link`,
// `barcode-scanner`, and `stronghold`. Tauri 2 fails capability resolution
// at runtime if a permission row references a plugin that wasn't
// registered with `.plugin(...)`, so we register all four here.
//
// ## Stronghold KDF — Argon2id (v0.1 ship-blocker B2 fix)
//
// `tauri_plugin_stronghold::Builder::new` accepts a `Fn(&str) -> Vec<u8>`
// that maps the user-supplied password to a 32-byte symmetric key used to
// encrypt the on-disk vault. We use Argon2id with OWASP-recommended (2024)
// parameters — see `derive_stronghold_key` for the exact tuple.

mod attach;
mod skills;
mod wt;

/// Derive the 32-byte Stronghold vault key from a user password using
/// Argon2id.
///
/// Parameters (OWASP password-storage cheat sheet, 2024):
///   - variant      : Argon2id (mixed memory/time hardness; default-secure)
///   - m_cost       : 19 * 1024 = 19 MiB
///   - t_cost       : 2 iterations
///   - p_cost       : 1 lane
///   - output       : 32 bytes
///
/// **Salt**: a stable per-application 16-byte ASCII constant. The Stronghold
/// vault is unrecoverable if the same password produces a different key on
/// the next launch, so the salt MUST be deterministic for a given install.
/// Threat model: an attacker has the encrypted vault file but not the
/// password — Argon2id's memory cost makes a precomputed rainbow table
/// per-tether-deployment prohibitive in practice. v0.2 follow-up: move the
/// salt to a per-install random value persisted alongside the vault (would
/// invalidate any existing v0.1 vault on upgrade — needs a migration path).
///
/// This is intentionally a free function (not a closure) so the unit tests
/// can pin the exact byte output without spinning up a Tauri builder.
pub fn derive_stronghold_key(password: &str) -> Vec<u8> {
    use argon2::{Algorithm, Argon2, Params, Version};

    // 16-byte ASCII constant. Length chosen to satisfy Argon2's MIN_SALT_LEN
    // (8 bytes) with margin. DO NOT change without a vault migration plan —
    // changing the salt = invalidating every existing user's vault.
    const STRONGHOLD_SALT: &[u8; 16] = b"tether-sh-v1-slt";

    let params = Params::new(
        19 * 1024, // m_cost: 19 MiB (OWASP floor)
        2,         // t_cost: 2 iterations
        1,         // p_cost: 1 lane
        Some(32),  // output: 32 bytes
    )
    .expect("Argon2 params constants are within valid ranges");

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut out = vec![0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), STRONGHOLD_SALT, &mut out)
        .expect("Argon2id derivation cannot fail with valid params + 16B salt");
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let wt_state = wt::WtState::default();
    let attach_state = attach::AttachState::default();
    let pair_state = wt::pair::PairState::new();

    let builder = tauri::Builder::default()
        .manage(wt_state)
        .manage(attach_state)
        .manage(pair_state)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password: &str| {
                derive_stronghold_key(password)
            })
            .build(),
        );

    // barcode-scanner is `#![cfg(mobile)]`-gated upstream — the crate
    // exposes no `init()` on desktop. Mirror that gate here so desktop
    // builds compile while mobile builds still register the plugin.
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    builder
        .invoke_handler(tauri::generate_handler![
            wt::wt_connect,
            wt::wt_open_bidi,
            wt::wt_open_uni,
            wt::wt_send,
            wt::wt_recv,
            wt::envelope::wt_recv_envelope,
            wt::wt_close_stream,
            wt::wt_close,
            wt::pair::pair_start,
            wt::pair::pair_confirm,
            wt::pair::pair_abort,
            wt::pair::pair_list_devices,
            wt::pair::pair_forget_device,
            attach::tether_attach_subscribe,
            attach::tether_attach_unsubscribe,
            attach::tether_attach_send_input,
            skills::tether_skill_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod stronghold_kdf_tests {
    use super::derive_stronghold_key;

    /// Golden-vector pin — Argon2id(m=19MiB, t=2, p=1, salt="tether-sh-v1-slt",
    /// password="test-password") produces this exact 32-byte key.
    ///
    /// Any future change to the variant, parameters, salt, or password input
    /// pre-processing will trip this test loud. Bumping these on purpose
    /// (e.g. raising m_cost in v0.2) means re-pinning AND a vault migration
    /// path for existing users — see the doc comment on `derive_stronghold_key`.
    #[test]
    fn stronghold_kdf_argon2id_golden() {
        let key = derive_stronghold_key("test-password");
        let expected: [u8; 32] = GOLDEN_TEST_PASSWORD;
        assert_eq!(
            key.as_slice(),
            &expected[..],
            "Argon2id golden vector drifted — check params, salt, variant"
        );
    }

    /// The empty-password edge case is also pinned. Stronghold uses this
    /// path for first-run vault initialization in some flows; if the
    /// derivation accidentally short-circuits empty input we want to know.
    #[test]
    fn stronghold_kdf_argon2id_golden_empty() {
        let key = derive_stronghold_key("");
        let expected: [u8; 32] = GOLDEN_EMPTY;
        assert_eq!(key.as_slice(), &expected[..]);
    }

    /// Latency guard. m_cost=19MiB, t_cost=2, p_cost=1 is ~100-500ms on
    /// modern hardware. A 2s ceiling catches an accidental m_cost typo
    /// (e.g. 19*1024*1024 = 19 GiB). Skip on `TETHER_SKIP_KDF_LATENCY` so
    /// CI on slow shared runners can opt out.
    #[test]
    fn argon2_runs_under_2s_on_modern_hardware() {
        if std::env::var_os("TETHER_SKIP_KDF_LATENCY").is_some() {
            eprintln!("skipping KDF latency test (TETHER_SKIP_KDF_LATENCY set)");
            return;
        }
        let start = std::time::Instant::now();
        let _ = derive_stronghold_key("test-password");
        let elapsed = start.elapsed();
        assert!(
            elapsed < std::time::Duration::from_secs(2),
            "Argon2id derivation took {:?} — expected <2s; check m_cost wasn't bumped by accident",
            elapsed
        );
    }

    #[test]
    #[ignore]
    fn _print_golden_vectors() {
        let k1 = derive_stronghold_key("test-password");
        let k2 = derive_stronghold_key("");
        eprintln!("GOLDEN_TEST_PASSWORD:");
        for chunk in k1.chunks(8) {
            let hex: Vec<String> = chunk.iter().map(|b| format!("0x{:02X}", b)).collect();
            eprintln!("    {},", hex.join(", "));
        }
        eprintln!("GOLDEN_EMPTY:");
        for chunk in k2.chunks(8) {
            let hex: Vec<String> = chunk.iter().map(|b| format!("0x{:02X}", b)).collect();
            eprintln!("    {},", hex.join(", "));
        }
    }

    // === Golden vectors (generated 2026-05-07 from this exact code) =====
    // To regenerate: temporarily print the output of derive_stronghold_key
    // and re-pin. Do NOT regenerate just to make the test pass — drift
    // signals a real change to the KDF tuple that needs a vault migration.

    const GOLDEN_TEST_PASSWORD: [u8; 32] = [
        0xA8, 0x32, 0x2A, 0x55, 0x09, 0x03, 0x1B, 0x8F,
        0x72, 0x0B, 0x56, 0xF2, 0x53, 0x4F, 0x8E, 0x40,
        0xD6, 0xAC, 0x9A, 0x7A, 0x19, 0xE3, 0x5A, 0xB5,
        0x7C, 0xA5, 0xE0, 0x95, 0xD8, 0x3C, 0xEC, 0x1E,
    ];
    const GOLDEN_EMPTY: [u8; 32] = [
        0xC3, 0xEA, 0x1C, 0xDD, 0xCE, 0xEB, 0x5E, 0x79,
        0x98, 0x17, 0x15, 0x2F, 0x15, 0xEF, 0x01, 0x9F,
        0x36, 0xB2, 0x9C, 0xDC, 0xE6, 0x0E, 0x75, 0x10,
        0x57, 0xD9, 0xD6, 0x9D, 0xF2, 0x1D, 0x54, 0x51,
    ];
}
