// Form fenced block (§11.AA / phase1-dag-protocol §3).
//   - <FormFull />     full configurable form (4 fields)
//   - <FormCompact />  single input + continue button
// Submits via store.sendMessage so the chat surfaces an "apply form"
// or "continue form" line — Phase 5+ swaps this with a real wire
// envelope.

import type { ReactNode } from "react";
import { useTetherStore } from "@/store";

const STRATEGIES = ["compose", "inherit", "duplicate"] as const;

interface CompactProps {
  onExpand?: () => void;
}

export function FormFull() {
  const form = useTetherStore((s) => s.form);
  const setForm = useTetherStore((s) => s.setForm);
  const sendMessage = useTetherStore((s) => s.sendMessage);

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
          form
        </span>
        <span style={{ fontWeight: 600 }}>configure refactor task</span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--ink-tertiary)",
          }}
        >
          step 2 / 3
        </span>
      </header>

      <div style={{ padding: 18, display: "grid", gap: 16 }}>
        <Field label="task name" hint="kebab-case identifier">
          <input
            value={form.name}
            onChange={(e) => setForm({ name: e.target.value })}
            className="input mono"
          />
        </Field>
        <Field label="scope" hint="repo-relative path">
          <input
            value={form.scope}
            onChange={(e) => setForm({ scope: e.target.value })}
            className="input mono"
          />
        </Field>
        <Field label="strategy">
          <div style={{ display: "flex", gap: 6 }}>
            {STRATEGIES.map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setForm({ strategy: s })}
                className={"seg " + (form.strategy === s ? "on" : "")}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
        <Field label="dry run" hint="preview changes without writing">
          <label className="switch">
            <input
              type="checkbox"
              checked={form.dryRun}
              onChange={(e) => setForm({ dryRun: e.target.checked })}
            />
            <span className="switch-track" />
          </label>
        </Field>
      </div>

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
          <span className="kbd">⌘</span> <span className="kbd">↵</span> to submit
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn-ghost-sm">
            back
          </button>
          <button
            type="button"
            className="btn-primary-sm"
            onClick={() =>
              sendMessage(`apply form: ${form.name} → ${form.strategy}`)
            }
          >
            apply
          </button>
        </div>
      </footer>
    </div>
  );
}

export function FormCompact({ onExpand }: CompactProps) {
  const form = useTetherStore((s) => s.form);
  const setForm = useTetherStore((s) => s.setForm);
  const sendMessage = useTetherStore((s) => s.sendMessage);

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
          FORM
        </span>
        <span style={{ fontWeight: 600 }}>configure refactor task</span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--ink-tertiary)",
          }}
        >
          2/3
        </span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <input
          value={form.name}
          onChange={(e) => setForm({ name: e.target.value })}
          placeholder="task name"
          className="input mono"
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn-primary-sm"
            style={{ flex: 1 }}
            onClick={() => sendMessage(`continue form: ${form.name}`)}
          >
            continue →
          </button>
          {onExpand && (
            <button
              type="button"
              className="btn-ghost-sm"
              onClick={onExpand}
            >
              expand
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "160px 1fr",
        gap: 14,
        alignItems: "start",
      }}
    >
      <div>
        <div
          className="mono"
          style={{ fontSize: 11.5, color: "var(--ink-secondary)" }}
        >
          {label}
        </div>
        {hint && (
          <div
            style={{ fontSize: 11, color: "var(--ink-tertiary)", marginTop: 2 }}
          >
            {hint}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}
