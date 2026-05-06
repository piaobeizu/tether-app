// Deterministic mock QR. Seeded by the pair code so the pattern
// changes when actions.regeneratePairCode() runs. This is design-time
// scaffolding only — real pairing will pass the spec'd payload
// through a real QR encoder (e.g. `qrcode` npm) in Phase 8.

interface QRMockProps {
  seedKey: string;
  /** Cells per row/column. 25 matches the prototype. */
  size?: number;
}

export function QRMock({ seedKey, size = 25 }: QRMockProps) {
  let seed = Array.from(seedKey).reduce(
    (a, c) => a * 31 + c.charCodeAt(0),
    7,
  );
  if (seed === 0) seed = 17;
  const rng = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const cells: Array<[number, number]> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inFinderTopLeft = x < 7 && y < 7;
      const inFinderTopRight = x >= size - 7 && y < 7;
      const inFinderBottomLeft = x < 7 && y >= size - 7;
      const isFinder =
        inFinderTopLeft || inFinderTopRight || inFinderBottomLeft;
      if (isFinder) {
        const fx = x < 7 ? x : size - 1 - x;
        const fy = y < 7 ? y : size - 1 - y;
        if (
          fx === 0 ||
          fx === 6 ||
          fy === 0 ||
          fy === 6 ||
          (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4)
        ) {
          cells.push([x, y]);
        }
      } else if (rng() > 0.55) {
        cells.push([x, y]);
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      {cells.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill="#1B1A18" />
      ))}
    </svg>
  );
}
