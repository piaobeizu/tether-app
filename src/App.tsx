// Top-level entry. Picks the design canvas (?canvas in the URL) or
// the production AppShell (default). AppCanvas is lazy-loaded so it
// doesn't ship in the production bundle path.

import { lazy, Suspense } from "react";
import { AppShell } from "./AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";

const AppCanvas = lazy(() =>
  import("./AppCanvas").then((m) => ({ default: m.AppCanvas })),
);

function isCanvasMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.search.includes("canvas");
}

export function App() {
  if (isCanvasMode()) {
    return (
      <Suspense fallback={null}>
        <AppCanvas />
      </Suspense>
    );
  }
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
