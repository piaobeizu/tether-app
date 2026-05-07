#!/usr/bin/env bash
# scripts/android-env.sh — source this before `cargo check/build --target=*-linux-android*`
# Required: ANDROID_NDK_HOME pointing at NDK r27 (current LTS) or newer.
# Verified working: r27d, r28c, r29.
#
# Usage:
#   export ANDROID_NDK_HOME=/opt/android-ndk-r29
#   source scripts/android-env.sh
#   cargo check --target=aarch64-linux-android --lib
#
# Exports:
#   ANDROID_NDK_TOOLCHAIN_BIN — NDK clang/llvm-ar dir
#   CC_<triple> + AR_<triple> for the 4 Android targets cargo + ring/cc-rs need
#   PATH — prepended with toolchain bin
#
# minSdk pinned at 21 (Tauri 2 Mobile floor; bump alongside cargo-mobile2 + Gradle).

# Use parameter expansion defaults instead of `set -u` so this script
# stays robust when sourced into shells that have unbound variables
# elsewhere (e.g. some shell-snapshot wrappers reference ZSH_VERSION
# without setting it).
if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  echo "ERROR: ANDROID_NDK_HOME not set. Install NDK r27+ (current LTS) and export ANDROID_NDK_HOME=/path/to/ndk." >&2
  return 1 2>/dev/null || exit 1
fi
if [[ ! -d "$ANDROID_NDK_HOME" ]]; then
  echo "ERROR: ANDROID_NDK_HOME=$ANDROID_NDK_HOME is not a directory." >&2
  return 1 2>/dev/null || exit 1
fi

# Detect host platform for prebuilt toolchain dir
case "$(uname -s)" in
  Linux)   HOST_TAG=linux-x86_64 ;;
  Darwin)  HOST_TAG=darwin-x86_64 ;;
  *)       echo "ERROR: unsupported host $(uname -s)" >&2; return 1 2>/dev/null || exit 1 ;;
esac

export ANDROID_NDK_TOOLCHAIN_BIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$HOST_TAG/bin"
if [[ ! -x "$ANDROID_NDK_TOOLCHAIN_BIN/aarch64-linux-android21-clang" ]]; then
  echo "ERROR: $ANDROID_NDK_TOOLCHAIN_BIN/aarch64-linux-android21-clang not found." >&2
  echo "       Verify NDK install + ANDROID_NDK_HOME path." >&2
  return 1 2>/dev/null || exit 1
fi

export CC_aarch64_linux_android="$ANDROID_NDK_TOOLCHAIN_BIN/aarch64-linux-android21-clang"
export CC_armv7_linux_androideabi="$ANDROID_NDK_TOOLCHAIN_BIN/armv7a-linux-androideabi21-clang"
export CC_x86_64_linux_android="$ANDROID_NDK_TOOLCHAIN_BIN/x86_64-linux-android21-clang"
export CC_i686_linux_android="$ANDROID_NDK_TOOLCHAIN_BIN/i686-linux-android21-clang"
export AR_aarch64_linux_android="$ANDROID_NDK_TOOLCHAIN_BIN/llvm-ar"
export AR_armv7_linux_androideabi="$ANDROID_NDK_TOOLCHAIN_BIN/llvm-ar"
export AR_x86_64_linux_android="$ANDROID_NDK_TOOLCHAIN_BIN/llvm-ar"
export AR_i686_linux_android="$ANDROID_NDK_TOOLCHAIN_BIN/llvm-ar"

case ":$PATH:" in
  *":$ANDROID_NDK_TOOLCHAIN_BIN:"*) ;;
  *) export PATH="$ANDROID_NDK_TOOLCHAIN_BIN:$PATH" ;;
esac

echo "android-env: NDK=$ANDROID_NDK_HOME"
echo "             toolchain=$ANDROID_NDK_TOOLCHAIN_BIN"
echo "             CC_<triple> set for 4 targets, PATH prepended."
