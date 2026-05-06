// Phase-5 — desktop + mobile side-by-side on a design canvas.
//
// Both surfaces share the Phase-2 zustand store, so a message sent
// from one shows in the other; the chat-block compact renderers in
// mobile/desktop both expand into the same skill detail (skill push
// on mobile / artifact pane on desktop).
//
// Phase 6 adds pair flow (desktop initiator + mobile companion).
// Phase 7 brings settings + errors. Phase 8 adds animation polish
// + tree virtualization.

import { useEffect, useState } from "react";
import { Desktop } from "@/components/desktop/Desktop";
import { MobileMain } from "@/components/mobile/MobileMain";
import { startMockTimers } from "@/store/timers";

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => startMockTimers(), []);

  return (
    <div
      data-theme={theme}
      style={{
        minHeight: "100vh",
        background: "#E9E4D6",
        color: "var(--ink-primary)",
        fontFamily: "var(--font-sans)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            color: "var(--ink-tertiary)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          Phase&nbsp;5 — desktop + mobile (§11.Y / D-19)
        </span>
        <button
          type="button"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          className="btn-ghost-sm"
          style={{ marginLeft: "auto" }}
        >
          theme: {theme}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 32,
          alignItems: "flex-start",
          maxWidth: 1800,
          width: "100%",
          margin: "0 auto",
        }}
      >
        <div style={{ minHeight: 720, display: "grid" }}>
          <Desktop />
        </div>
        <MobileMain />
      </div>
    </div>
  );
}
