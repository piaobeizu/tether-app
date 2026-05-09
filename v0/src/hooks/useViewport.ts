// Viewport detection — picks "desktop" or "mobile" based on a
// matchMedia breakpoint. Matches the prototype's design-canvas split:
// width >= 900px → desktop; below → mobile chat-first surface.
//
// SSR-safe (defaults to "desktop" in non-browser environments). React
// 19 use-sync-external-store flavor so it batches with concurrent
// rendering correctly.

import { useSyncExternalStore } from "react";

export type Viewport = "desktop" | "mobile";

const QUERY = "(min-width: 900px)";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const mql = window.matchMedia(QUERY);
  // Modern browsers + Tauri webviews use addEventListener; older
  // Safari fallback to addListener. The chrome105 / safari13 build
  // targets we ship to both have addEventListener.
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): Viewport {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia(QUERY).matches ? "desktop" : "mobile";
}

function getServerSnapshot(): Viewport {
  return "desktop";
}

export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
