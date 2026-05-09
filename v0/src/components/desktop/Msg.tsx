// Chat message bubble. User messages right-align with a dark bubble;
// AI messages left-align with a small tether avatar + name.
//
// Re-used by mobile chat in Phase 5; keeping it framework-agnostic
// (no store coupling, takes children + meta props).

import type { ReactNode } from "react";
import { Icon } from "@/blocks/Icon";
import type { ChatRole } from "@/store/types";

interface MsgProps {
  from: ChatRole;
  time: string;
  children: ReactNode;
}

export function Msg({ from, time, children }: MsgProps) {
  if (from === "system") {
    // Ambient/info row — used by hook-event echoes, "connected" notices,
    // reload markers. Muted styling, no avatar, full-width.
    return (
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-tertiary)",
          fontStyle: "italic",
          padding: "4px 0",
        }}
      >
        <span className="mono" style={{ marginRight: 8 }}>
          {time}
        </span>
        {children}
      </div>
    );
  }
  if (from === "user") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
        }}
      >
        <div
          style={{
            maxWidth: "86%",
            padding: "10px 14px",
            background: "var(--ink-primary)",
            color: "var(--bg-app)",
            borderRadius: "14px 14px 4px 14px",
            fontSize: 13.5,
            lineHeight: 1.5,
          }}
        >
          {children}
        </div>
        <div
          className="mono"
          style={{ fontSize: 10.5, color: "var(--ink-tertiary)" }}
        >
          you · {time}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: "var(--accent)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
          }}
        >
          <Icon name="tether" size={11} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>tether</span>
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-tertiary)" }}
        >
          {time}
        </span>
      </div>
      <div
        style={{
          fontSize: 13.5,
          lineHeight: 1.55,
          color: "var(--ink-primary)",
          paddingLeft: 25,
        }}
      >
        {children}
      </div>
    </div>
  );
}
