// Real app shell (Phase 8 + Phase-8.1 fixes).
//
// Renders ONE surface at a time per (viewport, route). The route
// lives in zustand; theme also lives in zustand and persists via
// localStorage. The data-theme attribute is set on the shell root
// so all token vars cascade through.
//
// AppCanvas (?canvas in URL) is the design-time alternative — see
// src/App.tsx for the gate.

import { useEffect, type ReactNode } from "react";
import { useTetherStore } from "@/store";
import { startMockTimers } from "@/store/timers";
import { useViewport } from "@/hooks/useViewport";
import { AttachBridge } from "@/components/AttachBridge";
import { ReloadBanner } from "@/components/ReloadBanner";
import { Desktop } from "@/components/desktop/Desktop";
import { MobileMain } from "@/components/mobile/MobileMain";
import { PairDesktop } from "@/components/pair/PairDesktop";
import { PairMobile } from "@/components/pair/PairMobile";
import { Settings } from "@/components/settings/Settings";
import { ErrorStates } from "@/components/errors/ErrorStates";
import type { AppRoute, Theme } from "@/store/types";
import type { Viewport } from "@/hooks/useViewport";

export function AppShell() {
  const route = useTetherStore((s) => s.route);
  const theme = useTetherStore((s) => s.theme);
  const viewport = useViewport();

  useEffect(() => startMockTimers(), []);

  return (
    <div
      data-theme={theme}
      style={{
        minHeight: "100vh",
        background: "var(--bg-app)",
        color: "var(--ink-primary)",
        fontFamily: "var(--font-sans)",
        display: "grid",
      }}
    >
      <AttachBridge />
      {/* Reload banner sits ABOVE the surface window on both viewports
       *  so it's visible regardless of which route is active. Mobile
       *  intentionally gets the same top-banner treatment (not a
       *  bottom-toast) — toasts collide with the composer / IME and
       *  hide behind the on-screen keyboard. */}
      <ReloadBanner />
      <SurfaceWindow viewport={viewport}>
        {viewport === "desktop"
          ? renderDesktopRoute(route)
          : renderMobileRoute(route)}
      </SurfaceWindow>
    </div>
  );
}

function renderDesktopRoute(route: AppRoute): ReactNode {
  switch (route) {
    case "home":
      return <Desktop />;
    case "pair":
      return <PairDesktop />;
    case "settings":
      return <Settings />;
    case "errors":
      return <ErrorStates />;
    default:
      return assertNever(route);
  }
}

function renderMobileRoute(route: AppRoute): ReactNode {
  switch (route) {
    case "home":
      return <MobileMain />;
    case "pair":
      return <PairMobile />;
    case "settings":
      return <Settings />;
    case "errors":
      return <ErrorStates />;
    default:
      return assertNever(route);
  }
}

function assertNever(x: never): never {
  throw new Error(`unreachable AppRoute: ${String(x)}`);
}

function SurfaceWindow({
  viewport,
  children,
}: {
  viewport: Viewport;
  children: ReactNode;
}) {
  // Mobile surfaces fill the viewport edge-to-edge; desktop surfaces
  // get a 24-px-padded grid so the framed cards don't sit on the
  // browser chrome.
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

// Re-export for tests / dev tooling that wants the constant directly.
// (Avoids a hard import on Theme from a deeply nested module.)
export type { Theme };
