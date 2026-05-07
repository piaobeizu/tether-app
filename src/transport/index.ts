// tether transport — WebTransport-like surface backed by self-written
// Tauri commands that wrap the `web-transport-quinn` crate.
//
// Per spec §11.V (P1 #5 = ii-rebuilt) and §11.Y.5 (D-13 / D-21):
//   - All four targets (Android + macOS / Linux / Windows) go through the
//     SAME implementation. No WebView-native WebTransport, no abandoned
//     `tauri-plugin-web-transport`, no WS fallback.
//   - This shim is INTENTIONALLY minimal — we do NOT mirror the W3C
//     WebTransport IDL. The surface is just enough for tether's envelope
//     round-trip (connect, open bidi/uni, send, recv, close).
//
// Underlying Rust commands: see `src-tauri/src/wt/mod.rs`.
// Rust crate: `web-transport-quinn` 0.11.9 (kixelated, actively maintained).

export type {
  WtConnectOptions,
  WtOpenStreamOptions,
  WtSession,
  WtStream,
} from "./types";
export { wt } from "./client";
export { TetherWtError } from "./errors";
