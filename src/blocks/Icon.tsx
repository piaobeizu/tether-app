// Inline SVG icon component. Translated from the prototype's
// `<symbol id="i-...">` defs in index.html. Stroke 1.5–1.7px @ 24px
// viewBox throughout, matching the prototype's defs.
//
// Add icons here as later phases need them — keep a single switch so
// tree-shaking trims unused branches at build time.

import type { CSSProperties } from "react";

export type IconName =
  | "check"
  | "image"
  | "folder"
  | "folder-open"
  | "chevron"
  | "chev-down"
  | "search"
  | "plus"
  | "x"
  | "settings"
  | "phone"
  | "bolt"
  | "arrow-up"
  | "tether"
  | "send"
  | "menu"
  | "back"
  | "play"
  | "ellipsis"
  | "edit"
  | "paperclip"
  | "spark"
  | "link";

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
      {renderPath(name)}
    </svg>
  );
}

function renderPath(name: IconName) {
  switch (name) {
    case "check":
      return <path d="m5 12 5 5L20 7" strokeWidth={2} />;
    case "image":
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth={1.5} />
          <circle cx="9" cy="10" r="1.6" strokeWidth={1.5} />
          <path d="m4 18 5-5 4 4 3-3 4 4" strokeWidth={1.5} />
        </>
      );
    case "folder":
      return (
        <path
          d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z"
          strokeWidth={1.5}
        />
      );
    case "folder-open":
      return (
        <>
          <path
            d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2H19.5A1.5 1.5 0 0 1 21 8.5V10H3V6.5Z"
            strokeWidth={1.5}
          />
          <path
            d="M3 10h18l-1.6 7.2a1.5 1.5 0 0 1-1.5 1.3H6.1a1.5 1.5 0 0 1-1.5-1.3L3 10Z"
            strokeWidth={1.5}
          />
        </>
      );
    case "chevron":
      return <path d="m9 6 6 6-6 6" strokeWidth={1.7} />;
    case "chev-down":
      return <path d="m6 9 6 6 6-6" strokeWidth={1.7} />;
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="7" strokeWidth={1.6} />
          <path d="m20 20-3.5-3.5" strokeWidth={1.6} />
        </>
      );
    case "plus":
      return <path d="M12 5v14M5 12h14" strokeWidth={1.7} />;
    case "x":
      return <path d="M6 6l12 12M18 6 6 18" strokeWidth={1.7} />;
    case "settings":
      return (
        <>
          <circle cx="12" cy="12" r="3" strokeWidth={1.5} />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9 1.7 1.7 0 0 0 4.3 7.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
            strokeWidth={1.5}
          />
        </>
      );
    case "phone":
      return (
        <>
          <rect x="6" y="2" width="12" height="20" rx="2.5" strokeWidth={1.5} />
          <path d="M11 18h2" strokeWidth={1.5} />
        </>
      );
    case "bolt":
      return <path d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z" strokeWidth={1.6} />;
    case "arrow-up":
      return <path d="M12 19V5M5 12l7-7 7 7" strokeWidth={1.7} />;
    case "tether":
      return (
        <>
          <circle cx="6" cy="6" r="2.5" strokeWidth={1.6} />
          <circle cx="18" cy="18" r="2.5" strokeWidth={1.6} />
          <path
            d="M8 8c2 4 6 6 8 8M8 8c0 2 1 4 3 5M16 16c0-2-1-4-3-5"
            strokeWidth={1.6}
          />
        </>
      );
    case "send":
      return (
        <path d="M3 11.5 21 4l-7.5 18-2.5-8-8-2.5Z" strokeWidth={1.6} />
      );
    case "menu":
      return <path d="M4 7h16M4 12h16M4 17h16" strokeWidth={1.7} />;
    case "back":
      return <path d="m15 6-6 6 6 6" strokeWidth={1.7} />;
    case "play":
      return <path d="M7 5v14l12-7L7 5Z" strokeWidth={1.6} />;
    case "ellipsis":
      return (
        <>
          <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </>
      );
    case "edit":
      return <path d="M4 20h4l11-11-4-4L4 16v4Z" strokeWidth={1.5} />;
    case "paperclip":
      return (
        <path
          d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 1 1-3-3L15 6"
          strokeWidth={1.6}
        />
      );
    case "spark":
      return (
        <path
          d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"
          strokeWidth={1.5}
        />
      );
    case "link":
      return (
        <>
          <path
            d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"
            strokeWidth={1.6}
          />
          <path
            d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"
            strokeWidth={1.6}
          />
        </>
      );
  }
}
