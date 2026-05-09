// Vitest setup — runs once per worker before any test file. Adds
// jest-dom matchers (toBeInTheDocument, toHaveTextContent, etc.) and
// stubs the matchMedia API the viewport hook depends on (happy-dom
// ships a permissive matchMedia, but we want deterministic queries
// per test).

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// Default to desktop in tests; individual tests can override via
// `window.matchMedia = vi.fn().mockReturnValue({ matches: true, ... })`.
if (typeof window !== "undefined" && !("matchMedia" in window)) {
  // Minimal matchMedia stub for happy-dom environments that lack one.
  // Returned object satisfies the API surface the viewport hook uses
  // (matches / addEventListener("change") / removeEventListener("change")).
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      addListener: () => {},
      removeListener: () => {},
    }),
  });
}

afterEach(() => {
  vi.useRealTimers();
});
