// Desktop pair initiator (§11.J / D-16, §11.AB pairing protocol).
//
// Slice #4 wiring: on mount this calls `pair_start` (Tauri command in
// src-tauri/src/wt/pair.rs) and renders the returned 6-char SAS string.
// "It matches" calls `pair_confirm`; "Cancel" / "Regenerate" call
// `pair_abort` then re-issue. Errors from any pair_* command surface in
// the existing meta slot.

import { useEffect } from "react";
import { useTetherStore } from "@/store";
import { QRMock } from "./QRMock";

export function PairDesktop() {
  const pairCode = useTetherStore((s) => s.pairCode);
  const pairTtl = useTetherStore((s) => s.pairTtl);
  const pairError = useTetherStore((s) => s.pairError);
  const pairHandleId = useTetherStore((s) => s.pairHandleId);
  const regeneratePairCode = useTetherStore((s) => s.regeneratePairCode);
  const confirmPair = useTetherStore((s) => s.confirmPair);
  const abortPair = useTetherStore((s) => s.abortPair);

  // Trigger pair_start on first mount of the desktop initiator screen.
  // Subsequent re-renders are no-ops because pairHandleId stays set
  // until confirmPair / abortPair / pair_start failure.
  useEffect(() => {
    if (pairHandleId === null) {
      void regeneratePairCode();
    }
    // We intentionally only run on mount; the pairHandleId guard above
    // prevents double-start without a deps array dance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ttlPadded = String(pairTtl).padStart(2, "0");

  return (
    <div className="pair-desktop">
      <div className="pair-card">
        <div className="pair-head">
          <span className="mono section-label">PAIR A DEVICE</span>
          <span className="pill">
            <span className="dot" />
            waiting · 0:{ttlPadded}
          </span>
        </div>

        <div className="pair-body">
          <div className="qr-wrap">
            <QRMock seedKey={pairCode} />
            <span className="qr-corner tl" />
            <span className="qr-corner tr" />
            <span className="qr-corner bl" />
            <span className="qr-corner br" />
          </div>

          <div className="pair-side">
            <div
              className="serif"
              style={{ fontStyle: "italic", fontSize: 28, lineHeight: 1.1 }}
            >
              scan with your phone
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 13.5,
                color: "var(--ink-secondary)",
                lineHeight: 1.55,
              }}
            >
              open tether on your phone, tap <strong>pair device</strong>,
              and scan this QR — or enter the code below manually.
            </div>

            <div
              className="pair-code"
              data-testid="pair-sas"
              aria-label="pair-sas"
            >
              {Array.from(pairCode).map((ch, i) => (
                <span key={i}>{ch === "-" ? "·" : ch}</span>
              ))}
            </div>

            <div className="pair-meta mono">
              <div>
                <span>fingerprint</span>
                <span>SHA256:8a2f…b4c1</span>
              </div>
              <div>
                <span>ttl</span>
                <span>0:{ttlPadded} / 1:00</span>
              </div>
              <div>
                <span>transport</span>
                <span>webtransport · h3</span>
              </div>
              {pairError !== null ? (
                <div data-testid="pair-error">
                  <span>error</span>
                  <span style={{ color: "var(--danger, #c83030)" }}>
                    {pairError}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="pair-actions">
              <button
                type="button"
                className="btn-ghost-sm"
                onClick={() => {
                  void abortPair("user-cancel");
                }}
              >
                cancel
              </button>
              <button
                type="button"
                className="btn-ghost-sm"
                onClick={() => {
                  void regeneratePairCode();
                }}
              >
                ↺ regenerate
              </button>
              <button
                type="button"
                className="btn-ghost-sm"
                onClick={() => {
                  void confirmPair();
                }}
                disabled={pairHandleId === null && pairError !== null}
              >
                it matches
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
