import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { wt } from "@/transport";
import { App } from "@/App";
import "@/styles/tokens.css";
import "@/styles/atoms.css";
import "@/styles/desktop.css";
import "@/styles/mobile.css";
import "@/styles/pair.css";
import "@/styles/settings.css";

// Dev-only: expose wt to window for devtools probing. Production
// builds drop this branch entirely so the WT client doesn't leak to
// the global scope where third-party content (if any) could touch it.
declare global {
  interface Window {
    __tether_wt?: typeof wt;
  }
}
if (import.meta.env.DEV) {
  window.__tether_wt = wt;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("tether: #root not found in index.html");
}
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
