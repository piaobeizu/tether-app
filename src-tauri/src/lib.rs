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
// Stronghold needs a key-derivation closure. For the v0.1 scaffold we
// install a placeholder that derives a 32-byte key from the input via
// `std::collections::hash_map::DefaultHasher` (a non-cryptographic
// SipHash-2-4) — explicitly NOT production-grade.
//
// **Build-time gate**: a release build with `--features insecure-kdf`
// disabled trips a `compile_error!` so this placeholder cannot ship
// to end users by accident. To produce a release artifact you MUST
// either (a) enable the `insecure-kdf` feature explicitly (CI / dev
// builds), or (b) replace the closure with an Argon2id-based KDF and
// remove this gate. See `Cargo.toml`'s feature declaration.

mod attach;
mod skills;
mod wt;

// Release-build guard: the Stronghold KDF below is a non-cryptographic
// placeholder. We refuse to compile a release build unless the
// `insecure-kdf` feature is explicitly opted into, OR the placeholder
// has been replaced (delete this block AT THE SAME TIME you replace
// the closure — they're a matched pair).
#[cfg(all(not(debug_assertions), not(feature = "insecure-kdf")))]
compile_error!(
    "tether-app: Stronghold KDF is a non-cryptographic placeholder. \
    Replace it with an Argon2id-based derivation before shipping a \
    release build, or build with `--features insecure-kdf` to opt into \
    the placeholder explicitly (dev / CI smoke only — NOT for end users)."
);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let wt_state = wt::WtState::default();
    let attach_state = attach::AttachState::default();

    let builder = tauri::Builder::default()
        .manage(wt_state)
        .manage(attach_state)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        // TODO(security-review): replace with a real Argon2id-based key
        // derivation (or platform Keystore-backed) before any production
        // build. The current closure is a placeholder so capability
        // resolution succeeds; it must NOT ship as-is.
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password: &str| {
                use std::collections::hash_map::DefaultHasher;
                use std::hash::{Hash, Hasher};
                // Deterministic 32-byte fill from the password — placeholder
                // only. v0.1 scaffold; tracked as a security-review followup.
                let mut out = [0u8; 32];
                for (i, chunk) in out.chunks_mut(8).enumerate() {
                    let mut h = DefaultHasher::new();
                    (i as u64).hash(&mut h);
                    password.hash(&mut h);
                    let v = h.finish().to_le_bytes();
                    let n = chunk.len();
                    chunk.copy_from_slice(&v[..n]);
                }
                out.to_vec()
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
            attach::tether_attach_subscribe,
            attach::tether_attach_unsubscribe,
            attach::tether_attach_send_input,
            skills::tether_skill_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
