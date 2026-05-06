// Phase-2 smoke screen. The Phase-1 token swatches stay; on top of them
// we now wire the store + timers so the runtime exercise covers:
//   - useTetherStore() hook subscription
//   - state read (activeWorkspace, DAG progress, pair TTL countdown)
//   - action dispatch (rollbackDag, pauseDag, regeneratePairCode, theme toggle)
//   - startMockTimers() side-effect lifecycle
//
// Phases 3-7 replace this with the real surfaces (workspace tree, fenced
// blocks, chat, pair flow, settings, errors). The store import contract
// stays stable across that transition.

import { useEffect, useState, type CSSProperties } from "react";
import { useTetherStore } from "@/store";
import { startMockTimers } from "@/store/timers";

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Subscribe to fields actually displayed below — zustand re-renders
  // only when the selected slice changes.
  const activeWorkspace = useTetherStore((s) => s.activeWorkspace);
  const dagNodes = useTetherStore((s) => s.dag.nodes);
  const dagPaused = useTetherStore((s) => s.dag.paused);
  const elapsedMs = useTetherStore((s) => s.dag.elapsedMs);
  const pairCode = useTetherStore((s) => s.pairCode);
  const pairTtl = useTetherStore((s) => s.pairTtl);
  const rollbackDag = useTetherStore((s) => s.rollbackDag);
  const pauseDag = useTetherStore((s) => s.pauseDag);
  const regeneratePairCode = useTetherStore((s) => s.regeneratePairCode);

  useEffect(() => startMockTimers(), []);

  const dagDone = dagNodes.filter((n) => n.status === "done").length;

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
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
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
          Phase&nbsp;2 — store + timers
        </span>
        <button
          type="button"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          style={btn()}
        >
          theme: {theme}
        </button>
      </header>

      <p style={{ color: "var(--ink-secondary)", maxWidth: 720, margin: 0 }}>
        Smoke screen — proves the store wiring. Phase 3+ replace this with the
        real surfaces (fenced blocks → desktop layout → mobile → pair → settings).
      </p>

      <section style={card()}>
        <h2 style={cardTitle()}>store: workspace</h2>
        <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 14 }}>
          activeWorkspace = <strong>{activeWorkspace}</strong>
        </p>
      </section>

      <section style={card()}>
        <h2 style={cardTitle()}>store: DAG (auto-advances every ~7s while running)</h2>
        <p style={{ margin: "0 0 12px 0", fontFamily: "var(--font-mono)", fontSize: 14 }}>
          {dagDone} / {dagNodes.length} done · elapsed{" "}
          {(elapsedMs / 1000).toFixed(0)}s · paused: {String(dagPaused)}
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {dagNodes.map((n) => (
            <li
              key={n.id}
              style={{
                display: "flex",
                gap: 12,
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: n.status === "done" ? "var(--ink-tertiary)" : "var(--ink-primary)",
              }}
            >
              <span style={{ width: 80, color: nodeStatusColor(n.status) }}>{n.status}</span>
              <span>{n.label}</span>
              {n.ms !== null && <span style={{ color: "var(--ink-tertiary)" }}>{n.ms}ms</span>}
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={pauseDag} style={btn()}>
            {dagPaused ? "▶ resume" : "❚❚ pause"}
          </button>
          <button type="button" onClick={rollbackDag} style={btn()}>
            ↺ rollback
          </button>
        </div>
      </section>

      <section style={card()}>
        <h2 style={cardTitle()}>store: pair (TTL counts down every 1s)</h2>
        <p style={{ margin: "0 0 12px 0", fontFamily: "var(--font-mono)", fontSize: 14 }}>
          code = <strong>{pairCode}</strong> · ttl = {pairTtl}s
        </p>
        <button type="button" onClick={regeneratePairCode} style={btn()}>
          ↺ regenerate
        </button>
      </section>
    </div>
  );
}

function nodeStatusColor(status: string): string {
  if (status === "done") return "var(--success)";
  if (status === "running") return "var(--accent)";
  if (status === "error") return "var(--danger)";
  return "var(--ink-quat)";
}

function btn(): CSSProperties {
  return {
    border: "1px solid var(--line)",
    background: "var(--bg-surface)",
    color: "var(--ink-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: "var(--r-2)",
    cursor: "pointer",
  };
}

function card(): CSSProperties {
  return {
    background: "var(--bg-surface)",
    border: "1px solid var(--line-soft)",
    borderRadius: "var(--r-3)",
    padding: 16,
    boxShadow: "var(--sh-1)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };
}

function cardTitle(): CSSProperties {
  return {
    margin: 0,
    fontSize: 13,
    fontWeight: 500,
    color: "var(--ink-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };
}
