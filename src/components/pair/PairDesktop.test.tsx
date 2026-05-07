// PairDesktop — slice #4 wiring. Verifies the desktop initiator
// component is correctly hooked up to the Rust-side `pair_*` Tauri
// commands via `transport/pair.ts`. The transport module is mocked at
// import boundary; the store calls into it via dynamic import.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/transport/pair", () => ({
  pairStart: vi.fn(),
  pairConfirm: vi.fn(),
  pairAbort: vi.fn(),
  pairListDevices: vi.fn(),
  pairForgetDevice: vi.fn(),
}));

// eslint-disable-next-line import/first
import * as transport from "@/transport/pair";
// eslint-disable-next-line import/first
import { PairDesktop } from "./PairDesktop";
// eslint-disable-next-line import/first
import { useTetherStore } from "@/store";

const pairStartMock = transport.pairStart as ReturnType<typeof vi.fn>;
const pairConfirmMock = transport.pairConfirm as ReturnType<typeof vi.fn>;
const pairAbortMock = transport.pairAbort as ReturnType<typeof vi.fn>;

const SAS_FIXTURE = "J8LNUS";

function setTauri(active: boolean) {
  const w = window as unknown as { __TAURI_INTERNALS__?: object };
  if (active) {
    w.__TAURI_INTERNALS__ = {};
  } else {
    delete w.__TAURI_INTERNALS__;
  }
}

function setStreamId(streamId: string | null) {
  // The store reads `_pairStreamId` off itself when running under Tauri.
  // Tests poke it in directly via setState since there is no public
  // setter (it's an internal coordination field driven by the WT
  // bring-up flow).
  useTetherStore.setState({ _pairStreamId: streamId });
}

describe("PairDesktop", () => {
  beforeEach(() => {
    pairStartMock.mockReset();
    pairConfirmMock.mockReset();
    pairAbortMock.mockReset();
    useTetherStore.setState({
      pairCode: "TST-CD1",
      pairTtl: 60,
      pairHandleId: null,
      pairError: null,
      pairMobileStep: "scan",
      attachSessionId: "device-desktop-test",
    });
    setTauri(true);
    setStreamId("stream-1");
  });

  afterEach(() => {
    cleanup();
    setTauri(false);
    setStreamId(null);
  });

  it("invokes pair_start on mount and renders the returned SAS", async () => {
    pairStartMock.mockResolvedValue({
      handleId: "h-1",
      sas: SAS_FIXTURE,
      peerDeviceId: "device-mobile-test",
      peerDisplayName: "Test Phone",
      peerKind: "mobile",
    });

    render(<PairDesktop />);

    await waitFor(() => {
      expect(pairStartMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(useTetherStore.getState().pairCode).toBe(SAS_FIXTURE);
      expect(useTetherStore.getState().pairHandleId).toBe("h-1");
    });
    // SAS digits land in the existing SAS slot (one <span> per char).
    const sasNode = screen.getByTestId("pair-sas");
    expect(sasNode.textContent).toBe(SAS_FIXTURE);
  });

  it("clicking 'it matches' calls pair_confirm with the active handle", async () => {
    pairStartMock.mockResolvedValue({
      handleId: "h-2",
      sas: SAS_FIXTURE,
      peerDeviceId: "device-mobile-test",
      peerDisplayName: "Test Phone",
      peerKind: "mobile",
    });
    pairConfirmMock.mockResolvedValue({
      peerDeviceId: "device-mobile-test",
      longTermKeyId: "ltk-test",
      longTermKeyB64: "AAAA",
      displayName: "Test Phone",
    });

    render(<PairDesktop />);
    await waitFor(() => {
      expect(useTetherStore.getState().pairHandleId).toBe("h-2");
    });

    fireEvent.click(screen.getByRole("button", { name: /it matches/i }));

    await waitFor(() => {
      expect(pairConfirmMock).toHaveBeenCalledTimes(1);
      expect(pairConfirmMock).toHaveBeenCalledWith("h-2");
    });
  });

  it("clicking 'cancel' calls pair_abort with the user-cancel reason", async () => {
    pairStartMock.mockResolvedValue({
      handleId: "h-3",
      sas: SAS_FIXTURE,
      peerDeviceId: "device-mobile-test",
      peerDisplayName: "Test Phone",
      peerKind: "mobile",
    });
    pairAbortMock.mockResolvedValue(undefined);

    render(<PairDesktop />);
    await waitFor(() => {
      expect(useTetherStore.getState().pairHandleId).toBe("h-3");
    });

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(pairAbortMock).toHaveBeenCalledTimes(1);
      expect(pairAbortMock).toHaveBeenCalledWith("h-3", "user-cancel");
    });
    expect(useTetherStore.getState().pairHandleId).toBeNull();
  });

  it("surfaces pair_start failure as a pairError in the meta slot", async () => {
    pairStartMock.mockRejectedValue("version-incompatible");

    render(<PairDesktop />);

    await waitFor(() => {
      expect(useTetherStore.getState().pairError).toBe("version-incompatible");
    });
    expect(screen.getByTestId("pair-error").textContent).toMatch(
      /version-incompatible/,
    );
  });
});
