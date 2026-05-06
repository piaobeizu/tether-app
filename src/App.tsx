// Phase-4 — desktop three-column layout (§11.Y / D-19) becomes the App.
//
// What's exercised: workspace tree (left), skill artifact pane with
// DAG full block (middle), chat with composer + slash popover + 4
// fenced-block compact renderers (right), status bar, optional error
// banner, theme toggle.
//
// Phase 5 adds mobile chat-first surface + a viewport switch so both
// can coexist on the design canvas. Phase 7 brings settings + tweaks
// (light/dark toggle moves there).

import { useEffect, useState } from "react";
import { Desktop } from "@/components/desktop/Desktop";
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
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          style={{
            color: "var(--ink-tertiary)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          Phase&nbsp;4 — desktop layout (§11.Y / D-19)
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
          flex: 1,
          minHeight: 720,
          display: "grid",
          maxWidth: 1440,
          width: "100%",
          margin: "0 auto",
        }}
      >
        <Desktop />
      </div>
    </div>
  );
}
