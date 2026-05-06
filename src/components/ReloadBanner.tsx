// ReloadBanner — surfaces "正在重载会话…" while the daemon's session
// subsystem is recovering cc. Mounts inside AppShell, above the
// per-route surface, so both desktop and mobile see the same banner
// without each route having to render its own.
//
// State source: `reload.active` in the zustand store. Driven by
// AttachBridge.handleFrame on `session.state + recordType=system`
// envelopes; cleared by any subsequent agent-event / hook-event frame
// or by the 30s safety timeout in the store.
//
// Visual contract:
//   - Uses --info / --info-tint tokens (NOT hard-coded colors) so the
//     dark theme picks up the right cascade automatically.
//   - Pulsing dot mirrors `.dt-error-banner .pulse-dot` so the visual
//     vocabulary stays consistent with the existing daemon-unreachable
//     banner — but the COLOR is info-blue, not warn-amber, because
//     reload is an in-progress notice, not an error.
//   - Position: top-of-shell on both viewports. Desktop: above the
//     framed grid; mobile: above the phone frame. This avoids the
//     bottom-toast pattern which would collide with the mobile
//     composer's IME / keyboard.
//
// i18n: the v0.1 codebase mixes English + Chinese strings (see e.g.
// `m-head-sub` "live · refactor running" alongside the v0.1 backlog
// item title "正在重载会话..."). We follow that precedent and surface
// both — Chinese as the primary string per the backlog wording, with
// the English in parens for non-CJK readers. When a real i18n layer
// lands, this becomes a single t("reload.indicator") call.

import { useTetherStore } from "@/store";

export function ReloadBanner() {
  const reloadActive = useTetherStore((s) => s.reload.active);
  if (!reloadActive) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="reload-banner"
      style={{
        padding: "6px 16px",
        background: "var(--info-tint)",
        borderBottom: "1px solid var(--info)",
        color: "var(--ink-primary)",
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        // Reuses the global `@keyframes pulse` (defined in atoms.css)
        // — the .pulse-dot class itself is scoped to .dt-error-banner
        // so we inline the box + animation here. Color is `--info` so
        // the dot picks up the right hue in both light/dark themes.
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: "var(--info)",
          animation: "pulse 1s infinite",
          display: "inline-block",
        }}
      />
      <span style={{ fontWeight: 600 }}>正在重载会话…</span>
      <span style={{ color: "var(--ink-secondary)" }}>
        (reloading session — please wait)
      </span>
    </div>
  );
}
