// ReloadBanner — render-presence tests.
//
// We don't lock down the exact wording in the DOM (the UX team owns
// copy) — instead we assert the data-testid is in the document iff
// `reload.active` is true. This keeps the test stable while leaving
// freedom to translate / shorten the surfaced string.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { act } from "react";

import { ReloadBanner } from "./ReloadBanner";
import { useTetherStore } from "@/store";

describe("ReloadBanner", () => {
  beforeEach(() => {
    // Drop any leftover reload state from previous suites.
    useTetherStore.getState().clearReloading();
  });

  afterEach(() => {
    cleanup();
    useTetherStore.getState().clearReloading();
  });

  it("renders nothing when reload.active is false", () => {
    render(<ReloadBanner />);
    expect(screen.queryByTestId("reload-banner")).not.toBeInTheDocument();
  });

  it("renders the banner when reload.active is true", () => {
    render(<ReloadBanner />);
    act(() => {
      useTetherStore.getState().setReloading("session.state");
    });
    expect(screen.getByTestId("reload-banner")).toBeInTheDocument();
  });

  it("disappears when clearReloading is called", () => {
    render(<ReloadBanner />);
    act(() => {
      useTetherStore.getState().setReloading("session.state");
    });
    expect(screen.queryByTestId("reload-banner")).toBeInTheDocument();
    act(() => {
      useTetherStore.getState().clearReloading();
    });
    expect(screen.queryByTestId("reload-banner")).not.toBeInTheDocument();
  });

  it("uses role=status with aria-live=polite for assistive tech", () => {
    render(<ReloadBanner />);
    act(() => {
      useTetherStore.getState().setReloading("session.state");
    });
    const node = screen.getByTestId("reload-banner");
    expect(node).toHaveAttribute("role", "status");
    expect(node).toHaveAttribute("aria-live", "polite");
  });
});
