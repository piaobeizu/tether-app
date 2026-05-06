// Stub entry — wt module is exposed via @/transport for later UI wiring.
import { wt } from "@/transport";

// Just expose to window so it's reachable from devtools during scaffold phase.
// (UI wiring is out of scope for Epic #7's scaffold slice.)
declare global {
  interface Window {
    __tether_wt?: typeof wt;
  }
}

window.__tether_wt = wt;

const status = document.getElementById("status");
if (status) {
  status.textContent =
    "scaffold ready — call window.__tether_wt.connect(...) once a server is reachable";
}
