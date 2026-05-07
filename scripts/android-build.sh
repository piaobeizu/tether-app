#!/usr/bin/env bash
# scripts/android-build.sh — convenience wrapper for `cargo tauri android build`.
#
# Bundles the Android cross-compile env (NDK + SDK + JDK) and runs the
# tauri-cli build command. Output APK lands under
# src-tauri/gen/android/app/build/outputs/apk/<flavor>/<buildType>/.
#
# USAGE:
#   scripts/android-build.sh           # debug build (debug-signed APK)
#   scripts/android-build.sh release   # release APK (needs keystore — see below)
#
# REQUIRES (one-time):
#   - Android NDK r27+ at $ANDROID_NDK_HOME (or via SDK at $ANDROID_HOME/ndk/<ver>)
#   - Android SDK at $ANDROID_HOME with platform-tools, platforms;android-34, build-tools;34.0.0
#   - JDK 17 at $JAVA_HOME
#   - tauri-cli 2.x: `cargo install tauri-cli --locked`
#   - cargo tauri android init  (run once; generates src-tauri/gen/android/)
#
# Release builds need a keystore; either:
#   1. Set up gen/android/app/keystore/upload-keystore.jks + corresponding
#      gradle signing config (per Android signing docs), or
#   2. Use the auto-generated debug keystore (debug builds, not for prod).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_ROOT"

PROFILE="${1:-debug}"

if ! command -v cargo-tauri >/dev/null 2>&1; then
  echo "ERROR: cargo-tauri not found. Run: cargo install tauri-cli --locked --version '^2.0'" >&2
  exit 1
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  echo "ERROR: ANDROID_HOME not set. Install Android SDK + cmdline-tools." >&2
  exit 1
fi
if [[ -z "${ANDROID_NDK_HOME:-}" && -z "${NDK_HOME:-}" ]]; then
  echo "ERROR: Neither ANDROID_NDK_HOME nor NDK_HOME set. Install NDK r27+." >&2
  exit 1
fi
if [[ -z "${JAVA_HOME:-}" ]]; then
  echo "ERROR: JAVA_HOME not set. Install JDK 17." >&2
  exit 1
fi

# Source env helper (sets CC_<triple> + AR_<triple> + PATH for ring/cc-rs)
source "$SCRIPT_DIR/android-env.sh"

# One-time check for the gradle-managed Android Studio scaffold
if [[ ! -d src-tauri/gen/android ]]; then
  echo "src-tauri/gen/android not found — running 'cargo tauri android init' first..."
  cargo tauri android init
fi

# Build
case "$PROFILE" in
  debug)
    cargo tauri android build --debug
    APK_GLOB='src-tauri/gen/android/app/build/outputs/apk/universal/debug/*.apk'
    ;;
  release)
    cargo tauri android build
    APK_GLOB='src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk'
    ;;
  *)
    echo "ERROR: unknown profile '$PROFILE' (want: debug | release)" >&2
    exit 1
    ;;
esac

# Surface the resulting APK path(s)
echo ""
echo "=== APK output ==="
shopt -s nullglob
APKS=( $APK_GLOB )
if [[ ${#APKS[@]} -eq 0 ]]; then
  # Tauri may also emit per-arch APKs depending on flavor config
  ALT_GLOB='src-tauri/gen/android/app/build/outputs/apk/**/*.apk'
  APKS=( $ALT_GLOB )
fi
if [[ ${#APKS[@]} -eq 0 ]]; then
  echo "WARN: build finished but no APK found at expected paths." >&2
  exit 1
fi
for apk in "${APKS[@]}"; do
  size=$(du -h "$apk" | cut -f1)
  echo "  $apk ($size)"
done
