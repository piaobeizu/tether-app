// Real app shell. Renders ONE surface at a time per viewport, picked
// by store.route + useViewport():
//
//   desktop:
//     home     → <Desktop />
//     pair     → <PairDesktop />
//     settings → <Settings />
//     errors   → <ErrorStates />
//
//   mobile:
//     home     → <MobileMain />        (drawer + skill push handled internally)
//     pair     → <PairMobile />        (3-step companion flow)
//     settings → <Settings />          (reuses desktop's Settings; mobile
//                                       css already gives it full bleed)
//     errors   → <ErrorStates />
//
// To open the design canvas (all 8 surfaces simultaneously), append
// `?canvas` to the URL.
//
// Phase-2 timers boot once on mount and live for the app's lifetime.

import { useEffect } from "react";
import { useTetherStore } from "@/store";
import { startMockTimers } from "@/store/timers";
import { useViewport } from "@/hooks/useViewport";
import { Desktop } from "@/components/desktop/Desktop";
import { MobileMain } from "@/components/mobile/MobileMain";
import { PairDesktop } from "@/components/pair/PairDesktop";
import { PairMobile } from "@/components/pair/PairMobile";
import { Settings } from "@/components/settings/Settings";
import { ErrorStates } from "@/components/errors/ErrorStates";

export function AppShell() {
  const route = useTetherStore((s) => s.route);
  const viewport = useViewport();

  useEffect(() => startMockTimers(), []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-app)",
        color: "var(--ink-primary)",
        fontFamily: "var(--font-sans)",
        display: "grid",
      }}
    >
      <SurfaceWindow viewport={viewport}>
        {viewport === "desktop"
          ? renderDesktopRoute(route)
          : renderMobileRoute(route)}
      </SurfaceWindow>
    </div>
  );
}

function renderDesktopRoute(route: ReturnType<typeof useTetherStore.getState>["route"]) {
  switch (route) {
    case "home":
      return <Desktop />;
    case "pair":
      return <PairDesktop />;
    case "settings":
      return <Settings />;
    case "errors":
      return <ErrorStates />;
  }
}

function renderMobileRoute(route: ReturnType<typeof useTetherStore.getState>["route"]) {
  switch (route) {
    case "home":
      return <MobileMain />;
    case "pair":
      return <PairMobile />;
    case "settings":
      return <Settings />;
    case "errors":
      return <ErrorStates />;
  }
}

function SurfaceWindow({
  viewport,
  children,
}: {
  viewport: ReturnType<typeof useViewport>;
  children: React.ReactNode;
}) {
  // Mobile surfaces ship with their own PhoneFrame OR fill the
  // viewport edge-to-edge — desktop surfaces are framed cards. Use a
  // simple wrapper so the framing is the surface's call.
  if (viewport === "mobile") {
    return (
      <div
        style={{
          width: "100%",
          minHeight: "100vh",
          display: "flex",
          alignItems: "stretch",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        padding: 24,
        display: "grid",
      }}
    >
      {children}
    </div>
  );
}
