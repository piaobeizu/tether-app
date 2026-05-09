# tether-app

Tauri 2 multi-target app for the `tether` project.

## Targets

Single Tauri 2 project, four build targets:

| Target | Triple                          | Bundle |
| ------ | ------------------------------- | ------ |
| macOS  | x86_64-apple-darwin / aarch64-apple-darwin | `.dmg` / `.app` |
| Linux  | x86_64-unknown-linux-gnu        | `.deb` / `.AppImage` |
| Windows| x86_64-pc-windows-msvc          | `.msi` / `.exe` |
| Android| aarch64-linux-android           | `.apk` / `.aab` |

iOS is deferred to v0.1.x (D-13).

## Architecture

- **Frontend** — `src/` (TypeScript + Vite). Layout switches by viewport
  (desktop three-pane / mobile single-pane). Today this is a stub `main.ts`.
- **Self-written WT command** — `src-tauri/src/wt/` wraps
  [`web-transport-quinn`](https://crates.io/crates/web-transport-quinn) 0.11.9
  in six minimal Tauri commands. This is the **single transport
  implementation** across all four targets — no `tauri-plugin-web-transport`
  (abandoned), no WebView-native WT, no WS fallback.
- **JS shim** — `src/transport/` exposes a small `wt` object
  (`connect / openBidi / openUni / send / recv / close`). It does **not**
  mirror the W3C WebTransport IDL; we only need enough surface for the
  tether envelope round-trip.

See spec sections §11.V (P1 #5 = ii-rebuilt) and §11.Y.5 (D-13 / D-21).

## Dev

```sh
pnpm install

# Desktop dev
pnpm tauri dev

# Android dev (requires SDK + NDK + emulator/device — see ANDROID.md)
pnpm tauri android init    # one-time; emits src-tauri/gen/android/
pnpm tauri android dev
```

## Build verification

Desktop:

```sh
cd src-tauri
cargo check
```

Android (requires NDK + cargo-ndk on PATH; otherwise document and skip):

```sh
cd src-tauri
rustup target add aarch64-linux-android
cargo check --target aarch64-linux-android
```

## What's NOT here yet (intentional)

- Real Android APK build / device signing.
- PoC-2.6 dial against `server.gcp-vm:4433` — depends on Epic #4 server.
- Workspace tree / chat / pair / settings UI surfaces.
- FCM custom Tauri plugin (no official upstream; lives in a follow-up).
- Real Android Keystore plugin (we ship `tauri-plugin-stronghold` as a
  cross-platform vault stand-in for the scaffold).
