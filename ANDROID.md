# Android target — bootstrap

Tauri 2 generates the Android Gradle project on demand. We do **not** check
in the generated tree (Gradle wrapper, `app/build.gradle.kts`, MainActivity,
etc.) — Tauri's `tauri android init` regenerates it from `tauri.conf.json`
and the Cargo crate's mobile entry point.

## One-time bootstrap (per developer machine)

Prerequisites:

- Android SDK + NDK (NDK r26d or newer recommended for Rust 1.95)
- Java 17
- Environment:
  ```sh
  export ANDROID_HOME=$HOME/Android/Sdk
  export NDK_HOME=$ANDROID_HOME/ndk/26.3.11579264
  export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64   # or your install
  ```
- Rust target installed:
  ```sh
  rustup target add aarch64-linux-android
  rustup target add armv7-linux-androideabi    # optional, 32-bit phones
  rustup target add i686-linux-android         # optional, x86 emulators
  rustup target add x86_64-linux-android       # optional, x86_64 emulators
  ```

Then from this directory:

```sh
pnpm install
pnpm tauri android init
```

This writes `src-tauri/gen/android/`. The output **is** committed in some
projects, but tether keeps it gitignored so that NDK / Gradle version drift
between developers doesn't churn the repo. The directory is regenerated on
first build.

## Verifying compile (without device)

```sh
cd src-tauri
cargo check --target aarch64-linux-android
```

`cargo check` for the Android target requires `cargo-ndk` or a manually
configured `[target.aarch64-linux-android]` linker section in
`~/.cargo/config.toml`. Suggested `~/.cargo/config.toml` snippet:

```toml
[target.aarch64-linux-android]
ar = "$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar"
linker = "$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"
```

(Replace `linux-x86_64` with `darwin-x86_64` on macOS and `24` with the
desired API level — must be ≥ 24 to match `tauri.conf.json:bundle.android.minSdkVersion`.)

## PoC-2.6 status

This is the scaffold slice. The actual Android smoke test against the
PoC-2 step1 server is **deferred to wave 3** per the Epic #7 task scope —
it depends on Epic #4 (server). See spec §10 PoC-2.6 for goals.
