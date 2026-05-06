// Phase-1 placeholder. Real surfaces (desktop / mobile / pair / settings) land
// in subsequent phases of the UI design handoff application — see
// .claude/claude-design.md for the staged plan.
//
// What this renders today: a token-smoke screen confirming the design tokens
// are wired (font + accent + bg + ink scales visible, dark-theme toggle works).

import { useState } from "react";

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  return (
    <div
      data-theme={theme}
      style={{
        minHeight: "100vh",
        background: "var(--bg-app)",
        color: "var(--ink-primary)",
        fontFamily: "var(--font-sans)",
        padding: "48px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontWeight: 400,
            fontSize: 48,
            letterSpacing: "-0.02em",
          }}
        >
          tether
        </h1>
        <span style={{ color: "var(--ink-tertiary)", fontSize: 14 }}>
          Phase&nbsp;1 — scaffold + tokens
        </span>
        <button
          type="button"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          style={{
            marginLeft: "auto",
            border: "1px solid var(--line)",
            background: "var(--bg-surface)",
            color: "var(--ink-primary)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: "var(--r-2)",
            cursor: "pointer",
          }}
        >
          theme: {theme}
        </button>
      </header>

      <p style={{ color: "var(--ink-secondary)", maxWidth: 720, margin: 0 }}>
        Token smoke screen. Phase 2+ will replace this with the real surfaces
        (workspace tree, fenced blocks, chat, pair flow, settings, errors) per
        the Claude Design handoff at{" "}
        <code className="mono" style={{ background: "var(--bg-code)", padding: "2px 6px", borderRadius: "var(--r-1)" }}>
          .workspace/memory/local/design-handoff-2026-05-06/
        </code>
        .
      </p>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
        <Swatch name="bg-app" />
        <Swatch name="bg-surface" />
        <Swatch name="bg-elevated" />
        <Swatch name="bg-sunken" />
        <Swatch name="bg-tint" />
        <Swatch name="bg-code" />
        <Swatch name="accent" />
        <Swatch name="success" />
        <Swatch name="warn" />
        <Swatch name="danger" />
        <Swatch name="info" />
      </section>
    </div>
  );
}

function Swatch({ name }: { name: string }) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--line-soft)",
        borderRadius: "var(--r-3)",
        padding: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "var(--sh-1)",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "var(--r-2)",
          background: `var(--${name})`,
          border: "1px solid var(--line-hairline)",
        }}
      />
      <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-secondary)" }}>
        --{name}
      </code>
    </div>
  );
}
