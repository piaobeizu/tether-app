// Phase-6 — full canvas: desktop + mobile-main side-by-side, with
// pair flow (desktop initiator + mobile companion) below.
//
// Both halves of §11.Y share the Phase-2 zustand store; the pair
// flow rides on the same store (pairCode / pairTtl auto-tick from
// store/timers; pairMobileStep state machine). Tap the mobile
// scan-frame to advance scan → confirm → success; the success state
// auto-resets after 3s.
//
// Phase 7 brings settings + errors. Phase 8 adds animation polish +
// tree virtualization + tests.

import { useEffect, useState } from "react";
import { Desktop } from "@/components/desktop/Desktop";
import { MobileMain } from "@/components/mobile/MobileMain";
import { PairDesktop } from "@/components/pair/PairDesktop";
import { PairMobile } from "@/components/pair/PairMobile";
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
          Phase&nbsp;6 — desktop + mobile + pair flow (§11.Y / §11.J)
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 32,
          alignItems: "flex-start",
          maxWidth: 1800,
          width: "100%",
          margin: "32px auto 0",
        }}
      >
        <div style={{ minHeight: 540, display: "grid" }}>
          <PairDesktop />
        </div>
        <PairMobile />
      </div>
    </div>
  );
}
