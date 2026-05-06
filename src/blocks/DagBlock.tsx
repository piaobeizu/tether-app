// DAG fenced block (§11.AA / phase1-dag-protocol §3).
// Two layouts:
//   - <DagFull />     full artifact-pane state machine + node aside
//   - <DagCompact />  inline chat representation (status bar + label)
// Both subscribe to the live store so they update with the auto-tick.

import { Fragment, useState } from "react";
import { useTetherStore } from "@/store";
import type { DagNode, DagNodeStatus } from "@/store/types";

const DAG_POS: Record<string, { x: number; y: number }> = {
  n1: { x: 60, y: 60 },
  n2: { x: 220, y: 60 },
  n3: { x: 380, y: 60 },
  n4: { x: 540, y: 60 },
  n5: { x: 380, y: 180 },
  n6: { x: 540, y: 180 },
};
const DAG_EDGES: ReadonlyArray<readonly [string, string]> = [
  ["n1", "n2"],
  ["n2", "n3"],
  ["n3", "n4"],
  ["n4", "n5"],
  ["n5", "n6"],
] as const;

const STATUS_COLOR: Record<DagNodeStatus, string> = {
  done: "var(--success)",
  running: "var(--accent)",
  queued: "var(--ink-quat)",
  error: "var(--danger)",
};

const formatElapsed = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

interface CompactProps {
  onExpand?: () => void;
}

export function DagFull() {
  const dag = useTetherStore((s) => s.dag);
  const pauseDag = useTetherStore((s) => s.pauseDag);
  const rollbackDag = useTetherStore((s) => s.rollbackDag);
  const [selected, setSelected] = useState("n4");

  const node: DagNode = dag.nodes.find((n) => n.id === selected) ?? dag.nodes[3]!;
  const doneCount = dag.nodes.filter((n) => n.status === "done").length;

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-3)",
        background: "var(--bg-surface)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--bg-elevated)",
          fontSize: 12,
        }}
      >
        <span className="mono" style={{ color: "var(--ink-tertiary)" }}>
          dag
        </span>
        <span style={{ fontWeight: 600 }}>refactor: extract fenced block renderer</span>
        <span className="pill" style={{ marginLeft: "auto" }}>
          <span
            className="dot"
            style={{ background: dag.paused ? "var(--ink-quat)" : "var(--accent)" }}
          />
          {doneCount} / {dag.nodes.length} {dag.paused ? "· paused" : ""}
        </span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px" }}>
        <div style={{ padding: 16, borderRight: "1px solid var(--line-soft)" }}>
          <svg
            viewBox="0 0 660 260"
            style={{ width: "100%", height: 260, display: "block" }}
          >
            {DAG_EDGES.map(([a, b], i) => {
              const A = DAG_POS[a]!;
              const B = DAG_POS[b]!;
              const aN = dag.nodes.find((n) => n.id === a);
              const bN = dag.nodes.find((n) => n.id === b);
              const isActive =
                aN?.status === "done" && bN?.status === "running";
              return (
                <path
                  key={i}
                  d={`M ${A.x + 60} ${A.y + 18} C ${A.x + 110} ${A.y + 18}, ${B.x - 50} ${B.y + 18}, ${B.x} ${B.y + 18}`}
                  fill="none"
                  stroke={isActive ? "var(--accent)" : "var(--line)"}
                  strokeWidth={isActive ? 2 : 1.3}
                  strokeDasharray={isActive ? "4 4" : "0"}
                />
              );
            })}
            {dag.nodes.map((n) => {
              const p = DAG_POS[n.id];
              if (!p) return null;
              const isSel = n.id === selected;
              const fill =
                n.status === "running"
                  ? "var(--accent-tint)"
                  : n.status === "done"
                    ? "var(--success-tint)"
                    : "var(--bg-elevated)";
              const stroke = STATUS_COLOR[n.status];
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  onClick={() => setSelected(n.id)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    width="120"
                    height="36"
                    rx="6"
                    fill={fill}
                    stroke={isSel ? "var(--ink-primary)" : stroke}
                    strokeWidth={isSel ? 2 : 1.2}
                  />
                  <circle cx="12" cy="18" r="4" fill={stroke} />
                  <text
                    x="24"
                    y="22"
                    fontFamily="Geist Mono, monospace"
                    fontSize="11.5"
                    fill="var(--ink-primary)"
                  >
                    {n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <aside style={{ padding: 14, fontSize: 12.5 }}>
          <div
            className="mono"
            style={{ color: "var(--ink-tertiary)", fontSize: 11 }}
          >
            NODE · {node.id}
          </div>
          <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>
            {node.label}
          </div>
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gap: 8,
              color: "var(--ink-secondary)",
            }}
          >
            <KvRow
              k="status"
              v={
                <span style={{ display: "inline-flex", alignItems: "center" }}>
                  {node.status === "running" && <span className="dot-anim" />}
                  {node.status}
                </span>
              }
            />
            <KvRow k="elapsed" v={formatElapsed(dag.elapsedMs)} />
            {node.ms !== null && <KvRow k="duration" v={`${node.ms}ms`} />}
          </div>
          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <button type="button" className="btn-ghost-sm" onClick={pauseDag}>
              {dag.paused ? "▶ resume" : "❚❚ pause"}
            </button>
            <button
              type="button"
              className="btn-ghost-sm"
              onClick={rollbackDag}
            >
              ↺ rollback
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function DagCompact({ onExpand }: CompactProps) {
  const dag = useTetherStore((s) => s.dag);
  const doneCount = dag.nodes.filter((n) => n.status === "done").length;
  const running = dag.nodes.find((n) => n.status === "running");

  return (
    <div
      style={{
        border: "1px solid var(--line-soft)",
        background: "var(--bg-surface)",
        borderRadius: "var(--r-3)",
        padding: "10px 12px",
        fontSize: 12.5,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            color: "var(--ink-tertiary)",
            letterSpacing: "0.06em",
          }}
        >
          DAG
        </span>
        <span style={{ fontWeight: 600 }}>refactor: extract block renderer</span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--ink-tertiary)",
          }}
        >
          {doneCount}/{dag.nodes.length}
        </span>
      </div>
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        {dag.nodes.map((n, i) => (
          <Fragment key={n.id}>
            <span
              title={n.label}
              style={{
                width: 18,
                height: 6,
                borderRadius: 2,
                background:
                  n.status === "done"
                    ? "var(--success)"
                    : n.status === "running"
                      ? "var(--accent)"
                      : "var(--ink-quat)",
                opacity: n.status === "queued" ? 0.35 : 1,
                animation:
                  n.status === "running" ? "pulse 1.4s infinite" : "none",
              }}
            />
            {i < dag.nodes.length - 1 && (
              <span
                style={{ width: 4, height: 1, background: "var(--line)" }}
              />
            )}
          </Fragment>
        ))}
      </div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          fontSize: 11.5,
          color: "var(--ink-tertiary)",
        }}
      >
        <span className="mono">{running ? "running →" : "complete →"}</span>
        &nbsp;
        <span style={{ color: "var(--ink-primary)" }}>
          {running?.label ?? "report"}
        </span>
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: 0,
              color: "var(--accent)",
              font: "500 11.5px var(--font-sans)",
              cursor: "pointer",
            }}
          >
            expand →
          </button>
        )}
      </div>
    </div>
  );
}

function KvRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span
        className="mono"
        style={{ color: "var(--ink-tertiary)", fontSize: 11 }}
      >
        {k}
      </span>
      <span className="mono" style={{ fontSize: 11.5 }}>
        {v}
      </span>
    </div>
  );
}
