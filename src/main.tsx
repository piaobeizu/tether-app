import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { wt } from "@/transport";
import { App } from "@/App";
import "@/styles/tokens.css";
import "@/styles/atoms.css";
import "@/styles/desktop.css";
import "@/styles/mobile.css";
import "@/styles/pair.css";

// Expose wt to window for devtools probing during scaffold phase.
// (Real wiring lands in Phase 3+ store / connection state.)
declare global {
  interface Window {
    __tether_wt?: typeof wt;
  }
}
window.__tether_wt = wt;

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("tether: #root not found in index.html");
}
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
