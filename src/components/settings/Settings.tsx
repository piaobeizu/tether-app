// Settings (§11.Y / D-19 settings 4-area: account / skills /
// connection / about). Two-column layout: left nav + right body.
//
// Translates extras.jsx Settings into typed React 19. Account / about
// rows show static placeholder values for now — Phase 8+ will wire
// them to real device-key / version sources.

import { Icon } from "@/blocks/Icon";
import { useTetherStore } from "@/store";
import type { SettingsTab } from "@/store/types";

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

  const nav: NavEntry[] = [
    { key: "account", name: "account", sub: "wxk" },
    { key: "skills", name: "skills", sub: `${skills.length} installed` },
    { key: "connection", name: "connection", sub: connection.state },
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
                      "pill " + (connection.state === "live" ? "live" : "warn")
                    }
                  >
                    <span className="dot" />
                    {connection.state}
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
