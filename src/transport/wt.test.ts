// Vitest coverage for the WT TS surface (`wt.connect(...)` + the
// `WtSession` / `WtStream` proxies) defined in ./client.ts.
//
// We mock `@tauri-apps/api/core::invoke` because vitest runs in
// happy-dom — there is no Tauri runtime, so the Rust side is replaced
// by a recorded-call `vi.fn()`. The point of these tests is to lock in
// the IPC shape the Rust commands expect: arg names (camelCase),
// option defaults, and the exact set of commands invoked. If any of
// those drift between Rust and TS, this test catches it.
//
// MUST stay in sync with src-tauri/src/wt/mod.rs (#[tauri::command]
// names + their argument structs). When the Rust surface adds a new
// option, add a matching assertion here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("transport/wt", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    mockInvoke.mockReset();
  });

  it("connect() invokes wt_connect with camelCase options + sane defaults", async () => {
    mockInvoke.mockResolvedValueOnce("session-7" as unknown);

    const { wt } = await import("./client");
    const session = await wt.connect({
      url: "https://server.example:4433/wt",
    });

    expect(session.id).toBe("session-7");
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("wt_connect", {
      url: "https://server.example:4433/wt",
      options: {
        alpn: null,
        insecure: false,
        pinnedCertSha256: null,
        timeoutMs: 10_000,
      },
    });
  });

  it("connect() forwards pinnedCertSha256 + custom timeout", async () => {
    mockInvoke.mockResolvedValueOnce("session-1" as unknown);
    const { wt } = await import("./client");

    await wt.connect({
      url: "https://server.example:4433/wt",
      pinnedCertSha256: [
        "d2fcb20d13ee095d50e8b77b272215e3b985e595294572256c1187838ff48930",
      ],
      timeoutMs: 5_000,
    });

    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("wt_connect", {
      url: "https://server.example:4433/wt",
      options: {
        alpn: null,
        insecure: false,
        pinnedCertSha256: [
          "d2fcb20d13ee095d50e8b77b272215e3b985e595294572256c1187838ff48930",
        ],
        timeoutMs: 5_000,
      },
    });
  });

  it("connect() rejects pin + insecure client-side (matches Rust invariant)", async () => {
    const { wt, TetherWtError } = await import("./index");
    await expect(
      wt.connect({
        url: "https://server.example:4433/wt",
        insecure: true,
        pinnedCertSha256: ["00".repeat(32)],
      }),
    ).rejects.toBeInstanceOf(TetherWtError);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("openBidi() with channelId writes the §3.3.3 prefix server-side via options", async () => {
    mockInvoke
      .mockResolvedValueOnce("session-2") // wt_connect
      .mockResolvedValueOnce("stream-9"); // wt_open_bidi

    const { wt } = await import("./client");
    const session = await wt.connect({
      url: "https://x:4433/wt",
      insecure: true,
    });
    const stream = await session.openBidi({ channelId: 0x01 });

    expect(stream.id).toBe("stream-9");
    expect(mockInvoke).toHaveBeenLastCalledWith("wt_open_bidi", {
      sessionId: "session-2",
      options: { channelId: 0x01 },
    });
  });

  it("openBidi() without options sends a null options field (no prefix byte)", async () => {
    mockInvoke
      .mockResolvedValueOnce("session-3")
      .mockResolvedValueOnce("stream-10");

    const { wt } = await import("./client");
    const session = await wt.connect({
      url: "https://x:4433/wt",
      insecure: true,
    });
    await session.openBidi();

    expect(mockInvoke).toHaveBeenLastCalledWith("wt_open_bidi", {
      sessionId: "session-3",
      options: null,
    });
  });

  it("openUni() forwards channelId the same way", async () => {
    mockInvoke
      .mockResolvedValueOnce("session-4")
      .mockResolvedValueOnce("stream-11");

    const { wt } = await import("./client");
    const session = await wt.connect({
      url: "https://x:4433/wt",
      insecure: true,
    });
    await session.openUni({ channelId: 0x02 });

    expect(mockInvoke).toHaveBeenLastCalledWith("wt_open_uni", {
      sessionId: "session-4",
      options: { channelId: 0x02 },
    });
  });

  it("openBidi() rejects out-of-range channelId at the boundary", async () => {
    mockInvoke.mockResolvedValueOnce("session-5");

    const { wt, TetherWtError } = await import("./index");
    const session = await wt.connect({
      url: "https://x:4433/wt",
      insecure: true,
    });

    await expect(session.openBidi({ channelId: 256 })).rejects.toBeInstanceOf(
      TetherWtError,
    );
    await expect(session.openBidi({ channelId: -1 })).rejects.toBeInstanceOf(
      TetherWtError,
    );
    // Only the connect invoke should have happened.
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith(
      "wt_connect",
      expect.anything(),
    );
  });

  it("send / recv / close pass the streamId through verbatim", async () => {
    mockInvoke
      .mockResolvedValueOnce("session-6")
      .mockResolvedValueOnce("stream-12") // openBidi
      .mockResolvedValueOnce(undefined) // send
      .mockResolvedValueOnce([1, 2, 3]) // recv → number[]
      .mockResolvedValueOnce(undefined); // close_stream

    const { wt } = await import("./client");
    const session = await wt.connect({
      url: "https://x:4433/wt",
      insecure: true,
    });
    const stream = await session.openBidi();

    await stream.send(new Uint8Array([9, 8, 7]));
    expect(mockInvoke).toHaveBeenLastCalledWith("wt_send", {
      streamId: "stream-12",
      bytes: new Uint8Array([9, 8, 7]),
    });

    const recvd = await stream.recv();
    expect(mockInvoke).toHaveBeenLastCalledWith("wt_recv", {
      streamId: "stream-12",
    });
    expect(recvd).toEqual(new Uint8Array([1, 2, 3]));

    await stream.close();
    expect(mockInvoke).toHaveBeenLastCalledWith("wt_close_stream", {
      streamId: "stream-12",
    });
  });

  it("recv() returns null on clean peer-close (Ok(None) → JS null)", async () => {
    mockInvoke
      .mockResolvedValueOnce("session-7")
      .mockResolvedValueOnce("stream-13")
      .mockResolvedValueOnce(null); // recv → null

    const { wt } = await import("./client");
    const session = await wt.connect({
      url: "https://x:4433/wt",
      insecure: true,
    });
    const stream = await session.openBidi();

    const recvd = await stream.recv();
    expect(recvd).toBeNull();
  });

  it("session.close() invokes wt_close with the sessionId", async () => {
    mockInvoke.mockResolvedValueOnce("session-8").mockResolvedValueOnce(undefined);

    const { wt } = await import("./client");
    const session = await wt.connect({
      url: "https://x:4433/wt",
      insecure: true,
    });
    await session.close();

    expect(mockInvoke).toHaveBeenLastCalledWith("wt_close", {
      sessionId: "session-8",
    });
  });

  it("wraps Rust-side errors in TetherWtError with op tag", async () => {
    mockInvoke.mockRejectedValueOnce("connect failed: dial tcp ...");
    const { wt, TetherWtError } = await import("./index");

    await expect(
      wt.connect({ url: "https://nope:4433/wt", insecure: true }),
    ).rejects.toMatchObject({
      name: "TetherWtError",
      message: expect.stringContaining("[tether-wt:connect]"),
    });
    // type-narrow check
    try {
      await wt.connect({ url: "https://nope:4433/wt", insecure: true });
    } catch (e) {
      expect(e).toBeInstanceOf(TetherWtError);
    }
  });
});
