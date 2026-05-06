// Phone bezel + status bar wrapper. Renders a label below the bezel
// for the design canvas (e.g. "mobile · main"). Children fill the
// screen area below the status bar.
//
// Layout-only — no store coupling.

import type { ReactNode } from "react";

interface PhoneFrameProps {
  label: string;
  children: ReactNode;
  statusBg?: string;
  statusColor?: string;
  time?: string;
}

export function PhoneFrame({
  label,
  children,
  statusBg = "var(--bg-app)",
  statusColor = "var(--ink-primary)",
  time = "9:41",
}: PhoneFrameProps) {
  return (
    <div className="phone-shell">
      <div className="phone-bezel">
        <div className="phone-screen" style={{ background: statusBg }}>
          <div className="phone-status" style={{ color: statusColor }}>
            <span className="mono">{time}</span>
            <span className="phone-notch" />
            <span className="phone-status-right">
              <svg width="14" height="9" viewBox="0 0 14 9">
                <path
                  fill="currentColor"
                  d="M0 7h2v2H0zm3-2h2v4H3zm3-2h2v6H6zm3-2h2v8H9zm3-2h2v10h-2z"
                />
              </svg>
              <span className="batt" />
            </span>
          </div>
          {children}
        </div>
      </div>
      <div className="phone-label mono">{label}</div>
    </div>
  );
}
