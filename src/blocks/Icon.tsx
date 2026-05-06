// Inline SVG icon component. Translated from the prototype's
// `<symbol id="i-...">` defs in index.html. Only the icons that the
// Phase-3 fenced blocks actually use live here; later phases will add
// more (folder / chevron / send / settings / phone / etc.) when the
// surfaces that need them land.
//
// Stroke 1.5–1.7px @ 24px viewBox, matching the prototype's defs.

import type { CSSProperties } from "react";

export type IconName = "check" | "image";

interface IconProps {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}

export function Icon({ name, size = 16, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {name === "check" && <path d="m5 12 5 5L20 7" strokeWidth={2} />}
      {name === "image" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth={1.5} />
          <circle cx="9" cy="10" r="1.6" strokeWidth={1.5} />
          <path d="m4 18 5-5 4 4 3-3 4 4" strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}
