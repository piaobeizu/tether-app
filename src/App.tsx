// Phase-7 — full canvas: desktop + mobile-main + pair (desktop +
// mobile companion) + settings + error states. The eight surfaces
// from §11.Y / §11.J / D-19 are now all on screen.
//
// What this canvas is for: design review, regression, hand-off — NOT
// the production app shell. Phase 8 will switch the real app entry
// to a routable layout (single surface at a time per viewport)
// instead of the design-canvas grid.

import { useEffect, useState } from "react";
import { Desktop } from "@/components/desktop/Desktop";
import { ErrorStates } from "@/components/errors/ErrorStates";
import { MobileMain } from "@/components/mobile/MobileMain";
import { PairDesktop } from "@/components/pair/PairDesktop";
import { PairMobile } from "@/components/pair/PairMobile";
import { Settings } from "@/components/settings/Settings";
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
          Phase&nbsp;7 — desktop + mobile + pair + settings + errors
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

      <CanvasRow>
        <CanvasCell minHeight={720}>
          <Desktop />
        </CanvasCell>
        <MobileMain />
      </CanvasRow>

      <CanvasRow>
        <CanvasCell minHeight={540}>
          <PairDesktop />
        </CanvasCell>
        <PairMobile />
      </CanvasRow>

      <CanvasRow>
        <CanvasCell minHeight={520}>
          <Settings />
        </CanvasCell>
        <CanvasCell minHeight={520}>
          <ErrorStates />
        </CanvasCell>
      </CanvasRow>
    </div>
  );
}

function CanvasRow({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

function CanvasCell({
  minHeight,
  children,
}: {
  minHeight: number;
  children: React.ReactNode;
}) {
  return <div style={{ minHeight, display: "grid" }}>{children}</div>;
}
