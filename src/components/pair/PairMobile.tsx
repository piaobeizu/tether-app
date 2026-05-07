// Mobile pair companion (§11.J / D-16) — 3-step flow on a black
// status bar:
//   scan    — viewfinder + animated scan line; tap to advance
//   confirm — sheet with device + fingerprint + 6-char code; cancel
//             returns to scan, confirm advances to success
//   success — green checkmark + "paired" headline (auto-resets after
//             3s via store.confirmPair → setMobilePairStep("scan"))
//
// Phase 7+ Tauri Mobile build will wire the viewfinder to
// tauri-plugin-barcode-scanner; v0.1 design-time uses the click-to-
// simulate affordance.

import { Icon } from "@/blocks/Icon";
import { useTetherStore } from "@/store";

export function PairMobile() {
  const pairMobileStep = useTetherStore((s) => s.pairMobileStep);
  const pairCode = useTetherStore((s) => s.pairCode);
  const pairError = useTetherStore((s) => s.pairError);
  const setMobilePairStep = useTetherStore((s) => s.setMobilePairStep);
  const confirmPair = useTetherStore((s) => s.confirmPair);
  const abortPair = useTetherStore((s) => s.abortPair);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        height: "100%",
        background: "#0a0a08",
      }}
    >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px 12px",
            color: "white",
          }}
        >
          <button
            type="button"
            className="m-iconbtn"
            style={{ color: "white" }}
          >
            <Icon name="x" size={18} />
          </button>
          <div
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            pair with desktop
          </div>
          <span style={{ width: 36 }} />
        </header>

        {pairMobileStep === "success" ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 999,
                background: "var(--success)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
              }}
            >
              <Icon name="check" size={32} />
            </div>
            <div
              className="serif"
              style={{ fontSize: 24, fontStyle: "italic" }}
            >
              paired
            </div>
            <div
              className="mono"
              style={{ fontSize: 12, color: "rgba(255,255,255,.5)" }}
            >
              session shared with desktop
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: 32,
            }}
          >
            <div
              className="scan-frame"
              onClick={() => setMobilePairStep("confirm")}
            >
              <span className="sc tl" />
              <span className="sc tr" />
              <span className="sc bl" />
              <span className="sc br" />
              <div className="scan-line" />
            </div>
            <div
              className="mono"
              style={{
                marginTop: 18,
                color: "rgba(255,255,255,.6)",
                fontSize: 11,
              }}
            >
              {pairMobileStep === "scan"
                ? "tap to simulate scan"
                : "scanned ✓"}
            </div>
          </div>
        )}

        {pairMobileStep === "confirm" ? (
          <div className="pair-confirm-sheet">
            <div
              className="serif"
              style={{ fontStyle: "italic", fontSize: 22 }}
            >
              confirm desktop identity
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 12.5,
                color: "var(--ink-secondary)",
              }}
            >
              verify the fingerprint matches your desktop.
            </div>

            <div className="pair-fp-card">
              <FpRow k="device" v="desktop" />
              <FpRow k="fingerprint" v="SHA256:8a2f…b4c1" accent />
              <FpRow k="code" v={pairCode} big />
            </div>

            {pairError !== null ? (
              <div
                data-testid="pair-error"
                className="mono"
                style={{
                  marginTop: 12,
                  fontSize: 11,
                  color: "var(--danger, #c83030)",
                }}
              >
                {pairError}
              </div>
            ) : null}

            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button
                type="button"
                className="m-btn-ghost"
                style={{ flex: 1 }}
                onClick={() => {
                  void abortPair("user-cancel");
                  setMobilePairStep("scan");
                }}
              >
                cancel
              </button>
              <button
                type="button"
                className="m-btn-primary"
                style={{ flex: 2 }}
                onClick={() => {
                  void confirmPair();
                }}
              >
                <Icon name="check" size={14} />
                &nbsp;confirm
              </button>
            </div>
          </div>
        ) : (
          <div />
        )}
    </div>
  );
}

interface FpRowProps {
  k: string;
  v: string;
  accent?: boolean;
  big?: boolean;
}

function FpRow({ k, v, accent, big }: FpRowProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        fontSize: 12.5,
      }}
    >
      <span
        className="mono"
        style={{
          color: "var(--ink-tertiary)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {k}
      </span>
      <span
        className="mono"
        style={{
          color: accent ? "var(--accent-deep)" : "var(--ink-primary)",
          fontSize: big ? 18 : 12.5,
          letterSpacing: big ? "0.05em" : 0,
        }}
      >
        {v}
      </span>
    </div>
  );
}
