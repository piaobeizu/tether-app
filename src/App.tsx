// Phase-3 smoke screen — fenced-block gallery.
//
// Renders all 4 block kinds in compact + full layout via the
// <FencedBlock /> dispatcher, on top of the live store + timers from
// Phase 2. This is the closest-to-real preview surface until Phase 4
// lands the desktop three-column layout that hosts these for real.
//
// What this verifies at build/runtime:
//   - <FencedBlock /> dispatcher routes every kind/layout pair
//   - Each block subscribes to its store slice and updates with the
//     auto-tick (DAG progress / pair TTL / candidate selection / form)
//   - Theme toggle still works (data-theme="dark" cascades through
//     all block CSS-var consumers)
//
// Replaced wholesale in Phase 4-7 by real surfaces.

import { useEffect, useState } from "react";
import { FencedBlock } from "@/blocks";
import { useTetherStore } from "@/store";
import { startMockTimers } from "@/store/timers";
import type { FencedBlockKind } from "@/store/types";

const BLOCK_KINDS: readonly FencedBlockKind[] = [
  "dag",
  "form",
  "candidates",
  "media",
] as const;

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const activeWorkspace = useTetherStore((s) => s.activeWorkspace);

  useEffect(() => startMockTimers(), []);

  return (
    <div
      data-theme={theme}
      style={{
        minHeight: "100vh",
        background: "var(--bg-app)",
        color: "var(--ink-primary)",
        fontFamily: "var(--font-sans)",
        padding: "32px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontWeight: 400,
            fontSize: 40,
            letterSpacing: "-0.02em",
          }}
        >
          tether
        </h1>
        <span style={{ color: "var(--ink-tertiary)", fontSize: 14 }}>
          Phase&nbsp;3 — fenced-block gallery
        </span>
        <span
          className="mono"
          style={{ color: "var(--ink-tertiary)", fontSize: 12 }}
        >
          ws: {activeWorkspace}
        </span>
        <button
          type="button"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          className="btn-ghost-sm"
          style={{ marginLeft: "auto" }}
        >
          theme: {theme}
        </button>
      </header>

      <p style={{ color: "var(--ink-secondary)", maxWidth: 720, margin: 0 }}>
        Each block on the left is the <strong>compact</strong> layout (chat
        inline). Each block on the right is the <strong>full</strong> layout
        (artifact pane). All eight subscribe to the live store — DAG advances
        on its own; click candidates / type in form / toggle theme to verify
        propagation.
      </p>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(240px, 360px) 1fr",
          gap: 24,
          alignItems: "start",
        }}
      >
        {BLOCK_KINDS.map((kind) => (
          <BlockRow key={kind} kind={kind} />
        ))}
      </section>
    </div>
  );
}

function BlockRow({ kind }: { kind: FencedBlockKind }) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Label>compact · {kind}</Label>
        <FencedBlock kind={kind} layout="compact" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Label>full · {kind}</Label>
        <FencedBlock kind={kind} layout="full" />
      </div>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10.5,
        color: "var(--ink-tertiary)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}
