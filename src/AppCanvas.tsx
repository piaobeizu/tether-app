// Design canvas — all 8 surfaces from §11.Y / §11.J / D-19 rendered
// on a single page for design review, regression, and visual
// hand-off. NOT the production app shell.
//
// Reach this from the URL by appending `?canvas`. The default URL
// renders the real <AppShell />.

import { useEffect, useState } from "react";
import { Desktop } from "@/components/desktop/Desktop";
import { ErrorStates } from "@/components/errors/ErrorStates";
import { MobileMain } from "@/components/mobile/MobileMain";
import { PhoneFrame } from "@/components/mobile/PhoneFrame";
import { PairDesktop } from "@/components/pair/PairDesktop";
import { PairMobile } from "@/components/pair/PairMobile";
import { Settings } from "@/components/settings/Settings";
import { startMockTimers } from "@/store/timers";

export function AppCanvas() {
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
          design canvas — 8 surfaces · ?canvas mode
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
        <PhoneFrame label="mobile · main · drawer + skill detail · all interactive">
          <MobileMain />
        </PhoneFrame>
      </CanvasRow>

      <CanvasRow>
        <CanvasCell minHeight={540}>
          <PairDesktop />
        </CanvasCell>
        <PhoneFrame
          label="mobile · pair · scan + confirm"
          statusBg="#0a0a08"
          statusColor="white"
          time="9:42"
        >
          <PairMobile />
        </PhoneFrame>
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
