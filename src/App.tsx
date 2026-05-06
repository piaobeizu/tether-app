// Top-level entry. Picks the design canvas (?canvas in the URL) or
// the production AppShell (default).

import { AppCanvas } from "./AppCanvas";
import { AppShell } from "./AppShell";

export function App() {
  if (typeof window !== "undefined" && window.location.search.includes("canvas")) {
    return <AppCanvas />;
  }
  return <AppShell />;
}
