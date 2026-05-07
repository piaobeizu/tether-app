// Error-state showcase. Three failure surfaces stacked into one frame
// so the design canvas can verify the visual contract for each:
//   - Top:    daemon-unreachable banner (warn-tint, retry / dismiss)
//   - Middle: catch-up replay failure card (danger icon + serif
//             headline + mono stack trace + reconnect actions)
//   - Bottom right: WT-reconnect floating pill (live / reconnecting,
//             pulsing dot, retry button when not live)
//
// All three subscribe to the same connection / wtState slice; use
// the bolt button on Desktop's titlebar (Phase 4) or the
// reconnect button here to flip between the states.

import { Icon } from "@/blocks/Icon";
import { useTetherStore } from "@/store";

export function ErrorStates() {
  const errorBannerVisible = useTetherStore((s) => s.errorBannerVisible);
  const attachState = useTetherStore((s) => s.attachState);
  const connection = useTetherStore((s) => s.connection);
  const reconnect = useTetherStore((s) => s.reconnect);
  const dismissBanner = useTetherStore((s) => s.dismissBanner);

  return (
    <div className="err-root">
      {errorBannerVisible && (
        <div className="err-banner">
          <span className="warn-dot" />
          <span style={{ fontWeight: 600 }}>daemon unreachable</span>
          <span style={{ color: "var(--ink-secondary)", fontSize: 12.5 }}>
            — retrying · attempt {connection.attempt || 2} of 3
          </span>
          <button
            type="button"
            className="btn-ghost-sm"
            style={{ marginLeft: "auto" }}
            onClick={reconnect}
          >
            retry now
          </button>
          <button
            type="button"
            className="icon-btn-sm"
            onClick={dismissBanner}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div className="err-center">
        <div className="err-card">
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "var(--danger-tint)",
              color: "var(--danger)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 18,
            }}
          >
            <Icon name="x" size={22} />
          </div>
          <div
            className="serif"
            style={{ fontSize: 28, lineHeight: 1.15, fontStyle: "italic" }}
          >
            会话状态恢复失败
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 13.5,
              color: "var(--ink-secondary)",
              lineHeight: 1.55,
              maxWidth: 460,
            }}
          >
            The catch-up snapshot from{" "}
            <span className="mono">daemon@8a2f</span> couldn't be replayed —
            version mismatch.
          </div>
          <div
            style={{
              marginTop: 18,
              padding: 14,
              background: "var(--bg-code)",
              borderRadius: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--ink-secondary)",
              lineHeight: 1.6,
            }}
          >
            <div style={{ color: "var(--danger)" }}>
              err: envelope.version_mismatch
            </div>
            <div>at catchup.replay (snapshot.ts:147)</div>
            <div>got=v2 want=v3 events=128</div>
          </div>
          <div style={{ marginTop: 22, display: "flex", gap: 8 }}>
            <button type="button" className="btn-ghost-sm">
              view raw log
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="btn-ghost-sm"
              onClick={dismissBanner}
            >
              new session
            </button>
            <button
              type="button"
              className="btn-primary-sm"
              onClick={reconnect}
            >
              reconnect
            </button>
          </div>
        </div>
      </div>

      <div className="err-wt">
        <span className={"wt-dot " + (attachState === "connected" ? "live" : "reconnecting")} />
        <span className="mono" style={{ fontSize: 11 }}>
          WT · {attachState}
        </span>
        {attachState !== "connected" && (
          <button
            type="button"
            className="btn-ghost-sm"
            onClick={reconnect}
            style={{ padding: "3px 8px" }}
          >
            ↺
          </button>
        )}
      </div>
    </div>
  );
}
