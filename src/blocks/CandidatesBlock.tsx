// Candidates fenced block (§11.AA / phase1-dag-protocol §3).
//   - <CandidatesFull />     full filterable picker (5 candidates)
//   - <CandidatesCompact />  3 most-recent + "view all" expand
// `picked` is store-managed (multi-select); the candidate list itself
// is block-local data (see ./data.ts).

import { useState } from "react";
import { useTetherStore } from "@/store";
import { sampleCandidates } from "./data";
import { Icon } from "./Icon";

interface CompactProps {
  onExpand?: () => void;
}

export function CandidatesFull() {
  const picked = useTetherStore((s) => s.picked);
  const toggleCandidate = useTetherStore((s) => s.toggleCandidate);
  const sendMessage = useTetherStore((s) => s.sendMessage);
  const [filter, setFilter] = useState("");

  const filtered = sampleCandidates.filter(
    (c) =>
      !filter ||
      c.title.toLowerCase().includes(filter.toLowerCase()) ||
      c.tag.includes(filter.toLowerCase()),
  );

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
          padding: "10px 14px",
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--bg-elevated)",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span className="mono" style={{ color: "var(--ink-tertiary)" }}>
          candidates
        </span>
        <span style={{ fontWeight: 600 }}>pick a block-renderer architecture</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          className="input mono"
          style={{ width: 140, marginLeft: "auto", padding: "4px 8px" }}
        />
      </header>

      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {filtered.map((c, i) => {
          const on = picked.includes(c.id);
          return (
            <li
              key={c.id}
              onClick={() => toggleCandidate(c.id)}
              style={{
                padding: "12px 14px",
                borderBottom:
                  i < filtered.length - 1
                    ? "1px solid var(--line-hairline)"
                    : "0",
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                cursor: "pointer",
                background: on ? "var(--accent-tint)" : "transparent",
              }}
            >
              <span
                style={{
                  marginTop: 2,
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border:
                    "1.5px solid " +
                    (on ? "var(--accent)" : "var(--ink-quat)"),
                  background: on ? "var(--accent)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  flexShrink: 0,
                }}
              >
                {on && <Icon name="check" size={11} />}
              </span>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{c.title}</span>
                  <span
                    className="mono"
                    style={{ fontSize: 10.5, color: "var(--ink-tertiary)" }}
                  >
                    · {c.tag}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-secondary)",
                    marginTop: 3,
                  }}
                >
                  {c.desc}
                </div>
              </div>
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-tertiary)" }}
              >
                {c.id}
              </span>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li
            style={{
              padding: 20,
              textAlign: "center",
              color: "var(--ink-tertiary)",
              fontSize: 12,
            }}
          >
            no matches
          </li>
        )}
      </ul>

      <footer
        style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--line-soft)",
          background: "var(--bg-elevated)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 11.5, color: "var(--ink-tertiary)" }}>
          {picked.length} of {sampleCandidates.length} selected
        </span>
        <button
          type="button"
          className="btn-primary-sm"
          onClick={() => sendMessage(`submit: ${picked.join(", ")}`)}
        >
          submit selection
        </button>
      </footer>
    </div>
  );
}

export function CandidatesCompact({ onExpand }: CompactProps) {
  const picked = useTetherStore((s) => s.picked);
  const toggleCandidate = useTetherStore((s) => s.toggleCandidate);

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
          CANDIDATES
        </span>
        <span style={{ fontWeight: 600 }}>pick architecture</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--ink-tertiary)",
          }}
        >
          {picked.length} picked
        </span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {sampleCandidates.slice(0, 3).map((c) => {
          const on = picked.includes(c.id);
          return (
            <div
              key={c.id}
              onClick={() => toggleCandidate(c.id)}
              style={{
                padding: "8px 10px",
                border:
                  "1px solid " + (on ? "var(--accent)" : "var(--line-soft)"),
                borderRadius: "var(--r-2)",
                background: on ? "var(--accent-tint)" : "var(--bg-elevated)",
                fontSize: 12,
                display: "flex",
                justifyContent: "space-between",
                cursor: "pointer",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontWeight: 500,
                  flex: 1,
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {c.title}
              </span>
              <span
                className="mono"
                style={{
                  color: "var(--ink-tertiary)",
                  fontSize: 10.5,
                }}
              >
                {c.tag}
              </span>
            </div>
          );
        })}
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            style={{
              padding: "8px 10px",
              border: "1px dashed var(--line)",
              borderRadius: "var(--r-2)",
              background: "transparent",
              color: "var(--ink-secondary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            view all {sampleCandidates.length} →
          </button>
        )}
      </div>
    </div>
  );
}
