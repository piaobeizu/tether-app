// Settings (§11.Y / D-19 settings 4-area: account / skills /
// connection / about). Two-column layout: left nav + right body.
//
// Translates extras.jsx Settings into typed React 19. Account / about
// rows show static placeholder values for now — Phase 8+ will wire
// them to real device-key / version sources.

import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/blocks/Icon";
import { useTetherStore } from "@/store";
import type { SettingsTab } from "@/store/types";
import {
  pairListDevices,
  pairForgetDevice,
  type PairedDevice,
} from "@/transport/pair";

interface NavEntry {
  key: SettingsTab;
  name: string;
  sub: string;
}

export function Settings() {
  const settingsTab = useTetherStore((s) => s.settingsTab);
  const skills = useTetherStore((s) => s.skills);
  const connection = useTetherStore((s) => s.connection);
  const setSettingsTab = useTetherStore((s) => s.setSettingsTab);
  const toggleSkill = useTetherStore((s) => s.toggleSkill);
  const reconnect = useTetherStore((s) => s.reconnect);
  const attachSessionId = useTetherStore((s) => s.attachSessionId);
  const daemonUrl = useTetherStore((s) => s.daemonUrl);
  const pinnedCertSha256 = useTetherStore((s) => s.pinnedCertSha256);
  const attachState = useTetherStore((s) => s.attachState);
  const attachError = useTetherStore((s) => s.attachError);
  const setAttachSessionId = useTetherStore((s) => s.setAttachSessionId);
  const setDaemonUrl = useTetherStore((s) => s.setDaemonUrl);
  const setPinnedCertSha256 = useTetherStore((s) => s.setPinnedCertSha256);
  const triggerAttachReconnect = useTetherStore((s) => s.triggerAttachReconnect);
  const setRoute = useTetherStore((s) => s.setRoute);

  // Local-only paired-device list. Re-fetched whenever the user lands
  // on the connection tab and after a "forget device" action. The
  // store is intentionally NOT used as the source of truth — the on-
  // disk registry under ~/.tether/users/default/devices/ is canonical
  // and the list only matters when the connection panel is visible.
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[] | null>(
    null,
  );
  const [pairListError, setPairListError] = useState<string | null>(null);

  const refreshPairedDevices = useCallback(async (): Promise<void> => {
    try {
      const list = await pairListDevices();
      setPairedDevices(list);
      setPairListError(null);
    } catch (e) {
      // happy-dom / vitest without an invoke mock will land here. The
      // panel renders the error inline so the user knows pairs aren't
      // listable rather than seeing a stale "0 devices" claim.
      const msg = e instanceof Error ? e.message : String(e);
      setPairedDevices(null);
      setPairListError(msg);
    }
  }, []);

  useEffect(() => {
    if (settingsTab === "connection") {
      void refreshPairedDevices();
    }
  }, [settingsTab, refreshPairedDevices]);

  const nav: NavEntry[] = [
    { key: "account", name: "account", sub: "wxk" },
    { key: "skills", name: "skills", sub: `${skills.length} installed` },
    { key: "connection", name: "connection", sub: attachState },
    { key: "about", name: "about", sub: "v0.1.0-rc.3" },
  ];

  return (
    <div className="set-root">
      <header className="set-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" className="icon-btn">
            <Icon name="back" size={16} />
          </button>
          <span
            className="serif"
            style={{ fontStyle: "italic", fontSize: 22 }}
          >
            settings
          </span>
        </div>
        <span className="pill">
          <span className="dot" />
          v0.1.0-rc.3
        </span>
      </header>

      <div className="set-grid">
        <nav className="set-nav">
          {nav.map((entry) => (
            <button
              type="button"
              key={entry.key}
              onClick={() => setSettingsTab(entry.key)}
              className={
                "set-nav-btn " + (settingsTab === entry.key ? "on" : "")
              }
            >
              <span className="set-nav-name">{entry.name}</span>
              <span className="set-nav-sub mono">{entry.sub}</span>
            </button>
          ))}
        </nav>

        <main className="set-body scroll-thin">
          {settingsTab === "account" && (
            <>
              <div className="set-section-title">profile</div>
              <Row k="user" v="wxk · piaobeizu" action={<button type="button" className="btn-ghost-sm">change</button>} />
              <Row k="token" v="tth_8a2f…b4c1" action={<button type="button" className="btn-ghost-sm">rotate</button>} />
            </>
          )}

          {settingsTab === "skills" && (
            <>
              <div className="set-section-title">installed · {skills.length}</div>
              {skills.map((s) => (
                <div key={s.name} className="set-row">
                  <span className="set-row-k">{s.name}</span>
                  <span className="set-row-v">
                    v{s.v}
                    {s.update && (
                      <span style={{ color: "var(--accent)", marginLeft: 8 }}>
                        {s.update}
                      </span>
                    )}
                    <span
                      style={{
                        display: "block",
                        color: "var(--ink-tertiary)",
                        fontFamily: "var(--font-sans)",
                        fontSize: 11.5,
                        marginTop: 2,
                      }}
                    >
                      {s.desc}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {s.update && (
                      <button type="button" className="btn-primary-sm">
                        update
                      </button>
                    )}
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={s.on}
                        onChange={() => toggleSkill(s.name)}
                      />
                      <span className="switch-track" />
                    </label>
                  </span>
                </div>
              ))}
            </>
          )}

          {settingsTab === "connection" && (
            <>
              <div className="set-section-title">daemon</div>
              <Row
                k="status"
                v={
                  <span
                    className={
                      "pill " + (attachState === "connected" ? "live" : "warn")
                    }
                  >
                    <span className="dot" />
                    {attachState}
                  </span>
                }
                action={
                  <button
                    type="button"
                    className="btn-ghost-sm"
                    onClick={reconnect}
                  >
                    reconnect
                  </button>
                }
              />
              <Row k="latency" v={`${connection.latency ?? "–"}ms`} />
              <Row k="protocol" v="webtransport · h3 · QUIC v1" />
              <Row k="e2e" v="X25519 · ChaCha20-Poly1305" />

              <div className="set-section-title" style={{ marginTop: 18 }}>
                webtransport
              </div>
              <Row
                k="state"
                v={
                  <span
                    className={
                      "pill " +
                      (attachState === "connected"
                        ? "live"
                        : attachState === "idle"
                          ? ""
                          : "warn")
                    }
                  >
                    <span className="dot" />
                    {attachState}
                  </span>
                }
                action={
                  <button
                    type="button"
                    className="btn-ghost-sm"
                    onClick={triggerAttachReconnect}
                    disabled={!attachSessionId}
                  >
                    reconnect
                  </button>
                }
              />
              <Row
                k="daemonUrl"
                v={
                  <input
                    type="text"
                    aria-label="daemon url"
                    placeholder="https://localhost:4444"
                    value={daemonUrl}
                    onChange={(e) => setDaemonUrl(e.target.value.trim())}
                    style={inputStyle}
                  />
                }
              />
              <Row
                k="sessionId"
                v={
                  <input
                    type="text"
                    aria-label="attach session id"
                    placeholder="cc session uuid"
                    value={attachSessionId}
                    onChange={(e) => setAttachSessionId(e.target.value.trim())}
                    style={inputStyle}
                  />
                }
              />
              <Row
                k="pinnedCertSha256"
                v={
                  <input
                    type="text"
                    aria-label="pinned cert sha256"
                    placeholder="leave empty for OS trust; pin only for self-signed dev"
                    value={pinnedCertSha256}
                    onChange={(e) =>
                      setPinnedCertSha256(e.target.value.trim())
                    }
                    style={inputStyle}
                  />
                }
              />
              {attachError && (
                <Row
                  k="error"
                  v={
                    <span style={{ color: "var(--accent)", fontSize: 11.5 }}>
                      {attachError}
                    </span>
                  }
                />
              )}

              <div className="set-section-title" style={{ marginTop: 18 }}>
                paired devices ·{" "}
                {pairedDevices === null ? "?" : pairedDevices.length}
              </div>
              {pairListError && (
                <Row
                  k="error"
                  v={
                    <span style={{ color: "var(--accent)", fontSize: 11.5 }}>
                      {pairListError}
                    </span>
                  }
                />
              )}
              {pairedDevices !== null && pairedDevices.length === 0 && (
                <Row
                  k="status"
                  v={
                    <span
                      style={{
                        color: "var(--ink-tertiary)",
                        fontSize: 11.5,
                      }}
                    >
                      no devices paired — pair first to attach
                    </span>
                  }
                />
              )}
              {pairedDevices?.map((d) => (
                <Row
                  key={d.deviceId}
                  k={d.displayName || d.deviceId}
                  v={
                    <span
                      className="mono"
                      style={{
                        fontSize: 11.5,
                        color: "var(--ink-tertiary)",
                      }}
                    >
                      {d.kind} · {d.deviceId.slice(0, 12)}… · paired{" "}
                      {d.pairedAt.slice(0, 10)}
                    </span>
                  }
                  action={
                    <button
                      type="button"
                      className="btn-ghost-sm"
                      aria-label={`forget ${d.deviceId}`}
                      onClick={() => {
                        void (async () => {
                          try {
                            await pairForgetDevice(d.deviceId);
                          } catch {
                            /* surfaced via refresh */
                          }
                          await refreshPairedDevices();
                        })();
                      }}
                    >
                      forget
                    </button>
                  }
                />
              ))}
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn-primary-sm"
                  onClick={() => setRoute("pair")}
                >
                  pair new device
                </button>
              </div>
            </>
          )}

          {settingsTab === "about" && (
            <>
              <div className="set-section-title">build</div>
              <Row k="version" v="v0.1.0-rc.3" />
              <Row k="platform" v="macOS 14.4 · arm64" />
              <Row
                k="license"
                v="MIT"
                action={<button type="button" className="btn-ghost-sm">view</button>}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Row({
  k,
  v,
  action,
}: {
  k: string;
  v: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="set-row">
      <span className="set-row-k">{k}</span>
      <span className="set-row-v">{v}</span>
      <span>{action}</span>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 320,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "4px 8px",
  background: "var(--bg-input, transparent)",
  color: "var(--ink-primary)",
  border: "1px solid var(--ink-tertiary)",
  borderRadius: 4,
};
