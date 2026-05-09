//! `tether_skill_list` Tauri command — bridge from the React shell to
//! `tether skill list`.
//!
//! ### Why subprocess (v0.1)
//!
//! The CLI's `skillList` (cmd/tether/skill.go) reads `~/.tether/skills/`,
//! parses each per-skill `tether.toml`, and prints `<name> <version>`
//! lines. The underlying `internal/skill.Pool` is a Go type — there is
//! no FFI surface from Rust into the Go runtime in this build, and
//! adding one (cgo + library packaging across desktop + mobile target
//! triples) is multi-day work that would block this slice.
//!
//! Subprocess (`tether skill list`) is 100% behavior-equivalent for the
//! list verb because it touches the same `~/.tether/skills/` path the
//! daemon would. Trade-offs:
//!
//! - **Latency**: ~10ms cold cache (Go binary startup + `os.ReadDir` +
//!   `toml.Unmarshal` per skill). Acceptable for a Settings tab open.
//! - **Tether binary discovery**: we look up `$PATH`, then fall back to
//!   `~/.cargo/bin/tether` and `~/go/bin/tether` (the two most common
//!   `go install` destinations). Fail-fast if none are present.
//! - **Forward-compat**: when we DO add an in-process skill listing
//!   (e.g. via a daemon-side Tauri plugin), the JS shape stays
//!   identical — just the implementation flips.
//!
//! ### JSON shape
//!
//! The current CLI prints aligned-text rows. We do NOT shell out to the
//! plain `tether skill list` because text parsing is fragile. Instead
//! we add a `--json` subflag. (See cmd/tether/skill.go on the daemon
//! side.) The Tauri command marshals the resulting slice straight to
//! the frontend — field names match the Go struct tags so
//! `loadSkills.ts` does a single mapping pass.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// Wall-clock budget for one `tether skill list --json` invocation.
/// 10s is generous — happy path is ~10ms — but covers slow disks /
/// stalled NFS mounts under `~/.tether/skills/` without hanging the
/// Settings tab forever.
const SKILL_LIST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillRow {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// Optional — the CLI only reports `enabled` once tether.toml-side
    /// enablement state lands. v0.1: omitted; the TS side defaults to
    /// `true` per the loadSkills.ts contract.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Optional — populated when an `update` channel reports a newer
    /// release. v0.1: never set (no registry probe).
    #[serde(skip_serializing_if = "Option::is_none", rename = "updateAvailable")]
    pub update_available: Option<String>,
}

#[tauri::command]
pub async fn tether_skill_list() -> Result<Vec<SkillRow>, String> {
    let bin = locate_tether_binary().ok_or_else(|| {
        "could not find a `tether` binary on $PATH or under ~/.cargo/bin / ~/go/bin"
            .to_string()
    })?;

    let spawn = Command::new(&bin)
        .args(["skill", "list", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    let output = tokio::time::timeout(SKILL_LIST_TIMEOUT, spawn)
        .await
        .map_err(|_| {
            format!(
                "tether skill list timed out after {}s — daemon binary may be hung",
                SKILL_LIST_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("spawn {} skill list: {e}", bin.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "tether skill list (exit={:?}): {}",
            output.status.code(),
            stderr.trim()
        ));
    }

    parse_skill_list_json(&output.stdout)
}

/// Locate the `tether` binary. Strategy:
///
/// 1. `TETHER_BIN` env override (used by tests + dev iteration).
/// 2. Walk `$PATH` (cross-platform — uses `std::env::split_paths` so
///    Windows' `;` separator works alongside POSIX `:`).
/// 3. `~/.cargo/bin/tether{.exe}` (standard `cargo install` layout).
/// 4. `~/go/bin/tether{.exe}` (default `go install` GOPATH layout).
///
/// Binary basename uses `std::env::consts::EXE_EXTENSION` so Windows
/// resolves `tether.exe` while POSIX resolves `tether`.
fn locate_tether_binary() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("TETHER_BIN") {
        let pb = PathBuf::from(&p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    let basename = format!(
        "tether{}{}",
        if std::env::consts::EXE_EXTENSION.is_empty() {
            ""
        } else {
            "."
        },
        std::env::consts::EXE_EXTENSION
    );
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(&basename);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        for sub in [".cargo/bin", "go/bin"] {
            let candidate = PathBuf::from(&home).join(sub).join(&basename);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn parse_skill_list_json(stdout: &[u8]) -> Result<Vec<SkillRow>, String> {
    // The daemon ALWAYS emits at least `[]\n` for `--json` (see
    // cmd/tether/skill.go: "Always emit a JSON array even when
    // empty"). Empty stdout therefore means the binary on disk is
    // older than the --json flag — surface as a typed version-skew
    // error instead of silently returning an empty list (which would
    // make the user think they have no skills installed).
    if stdout.iter().all(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r')) {
        return Err(
            "daemon emitted no JSON for `tether skill list --json` — \
            the `tether` binary is too old to support the --json flag. \
            Install the latest tether from this repo and try again."
                .to_string(),
        );
    }
    serde_json::from_slice::<Vec<SkillRow>>(stdout)
        .map_err(|e| format!("parse `tether skill list --json` output: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_json_output() {
        let stdout = br#"[
            {"name":"refactor.code","version":"0.4.2","description":"DAG-driven code restructuring"},
            {"name":"spec.write","version":"0.2.1","description":"spec writeup with structured form"}
        ]"#;
        let rows = parse_skill_list_json(stdout).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "refactor.code");
        assert_eq!(rows[0].version, "0.4.2");
        assert_eq!(rows[0].description, "DAG-driven code restructuring");
        assert!(rows[0].enabled.is_none());
        assert!(rows[0].update_available.is_none());
    }

    #[test]
    fn parses_with_optional_fields_present() {
        let stdout = br#"[{"name":"x","version":"1","description":"d","enabled":false,"updateAvailable":"2.0"}]"#;
        let rows = parse_skill_list_json(stdout).unwrap();
        assert_eq!(rows[0].enabled, Some(false));
        assert_eq!(rows[0].update_available.as_deref(), Some("2.0"));
    }

    #[test]
    fn empty_stdout_surfaces_version_skew_error() {
        // Empty / whitespace-only stdout is treated as "binary too old
        // to support --json", NOT as "no skills installed". The
        // daemon's contract is `[]` for empty.
        let err = parse_skill_list_json(b"").unwrap_err();
        assert!(err.contains("too old"), "expected version-skew error, got {err}");
        let err = parse_skill_list_json(b"\n  \t").unwrap_err();
        assert!(err.contains("too old"), "expected version-skew error, got {err}");
    }

    #[test]
    fn malformed_json_surfaces_error() {
        let err = parse_skill_list_json(b"not json").unwrap_err();
        assert!(err.contains("parse"));
    }

    #[test]
    fn empty_array_returns_empty_list() {
        let rows = parse_skill_list_json(b"[]").unwrap();
        assert!(rows.is_empty());
    }
}
