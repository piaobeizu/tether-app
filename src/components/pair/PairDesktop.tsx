// Desktop pair initiator (§11.J / D-16).
//
// Shows: QR code (mock) + 6-character SAS code + fingerprint + TTL
// countdown + cancel/regenerate buttons. The TTL ticks down via the
// Phase-2 store timer; pressing "regenerate" issues a new code +
// resets TTL to 60s.

import { useTetherStore } from "@/store";
import { QRMock } from "./QRMock";

export function PairDesktop() {
  const pairCode = useTetherStore((s) => s.pairCode);
  const pairTtl = useTetherStore((s) => s.pairTtl);
  const regeneratePairCode = useTetherStore((s) => s.regeneratePairCode);

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

            <div className="pair-code">
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
            </div>

            <div className="pair-actions">
              <button type="button" className="btn-ghost-sm">
                cancel
              </button>
              <button
                type="button"
                className="btn-ghost-sm"
                onClick={regeneratePairCode}
              >
                ↺ regenerate
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
