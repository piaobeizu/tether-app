// Media fenced block (§11.AA / phase1-dag-protocol §3).
//   - <MediaFull />     fullscreen-style preview pane (placeholder shell)
//   - <MediaCompact />  inline thumbnail + filename + open hint
// Phase-3 ships placeholder visuals; real envelope-supplied media
// (image / video / audio) lands later when the wire format ships.

import { Icon } from "./Icon";

interface CompactProps {
  onExpand?: () => void;
}

export function MediaFull() {
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
          media
        </span>
        <span style={{ fontWeight: 600 }}>screenshot — chat composer prototype</span>
        <span className="pill" style={{ marginLeft: "auto" }}>
          1.4 MB · png
        </span>
      </header>

      <div
        style={{
          aspectRatio: "16 / 9",
          background: "linear-gradient(135deg, #2a2620 0%, #1a1815 100%)",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "78%",
            height: "76%",
            background: "var(--bg-app)",
            borderRadius: 8,
            border: "1px solid #00000022",
            boxShadow: "0 30px 80px rgba(0,0,0,.4)",
            display: "grid",
            gridTemplateRows: "32px 1fr",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "var(--bg-sunken)",
              display: "flex",
              alignItems: "center",
              padding: "0 10px",
              gap: 6,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 99,
                background: "#E27A6F",
              }}
            />
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 99,
                background: "#E5C36A",
              }}
            />
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 99,
                background: "#7DB87E",
              }}
            />
          </div>
          <div style={{ padding: 16 }}>
            <div
              style={{
                height: 6,
                background: "var(--line-soft)",
                borderRadius: 3,
                width: "60%",
                marginBottom: 8,
              }}
            />
            <div
              style={{
                height: 6,
                background: "var(--line-soft)",
                borderRadius: 3,
                width: "84%",
                marginBottom: 8,
              }}
            />
            <div
              style={{
                height: 6,
                background: "var(--line-soft)",
                borderRadius: 3,
                width: "40%",
              }}
            />
          </div>
        </div>
      </div>

      <footer
        style={{
          padding: "8px 14px",
          display: "flex",
          gap: 8,
          alignItems: "center",
          fontSize: 11.5,
          color: "var(--ink-tertiary)",
        }}
      >
        <span className="mono">2026-05-02 · 14:08</span>
        <button
          type="button"
          className="btn-ghost-sm"
          style={{ marginLeft: "auto" }}
        >
          open ⤢
        </button>
        <button type="button" className="btn-ghost-sm">
          copy path
        </button>
      </footer>
    </div>
  );
}

export function MediaCompact({ onExpand }: CompactProps) {
  return (
    <div
      onClick={onExpand}
      style={{
        border: "1px solid var(--line-soft)",
        background: "var(--bg-surface)",
        borderRadius: "var(--r-3)",
        padding: 8,
        display: "flex",
        gap: 10,
        alignItems: "center",
        cursor: onExpand ? "pointer" : "default",
      }}
    >
      <div
        style={{
          width: 56,
          height: 40,
          borderRadius: "var(--r-2)",
          background: "linear-gradient(135deg, #2a2620, #1a1815)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#999",
          flexShrink: 0,
        }}
      >
        <Icon name="image" size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          screenshot — chat composer prototype
        </div>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-tertiary)",
            marginTop: 2,
          }}
        >
          png · 1.4 MB · {onExpand ? "expand" : "open ⤢"}
        </div>
      </div>
    </div>
  );
}
