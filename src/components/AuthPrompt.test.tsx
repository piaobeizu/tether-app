// AuthPrompt — unit tests for the modal dialog. Exercises:
//   - hidden when no pending request
//   - renders tool name + summary + four buttons
//   - clicking "allow once" calls the sender with the right decision frame
//   - clicking "deny always" calls the sender with the right decision frame
//   - clears the pending request after a click
//   - buttons are disabled when sender is null
//
// Slice #5 / D-21: AuthPrompt now takes a transport-agnostic
// `InputSender` callback instead of a UDS attach subscription. The
// daemon is reached over WebTransport in the live app; this test
// stubs the sender function directly.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { act } from "react";

// eslint-disable-next-line import/first
import { AuthPrompt, type InputSender } from "./AuthPrompt";
// eslint-disable-next-line import/first
import { useTetherStore } from "@/store";

type SenderMock = ReturnType<typeof vi.fn> & InputSender;

function makeSender(): SenderMock {
  return vi.fn(async (_bytes: Uint8Array) => {}) as unknown as SenderMock;
}

function decodeSentDecision(callArg: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(callArg));
}

describe("AuthPrompt", () => {
  beforeEach(() => {
    useTetherStore.setState({
      pendingAuthRequest: null,
      authRequestQueue: [],
      attachState: "idle",
      attachError: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when no pending request", () => {
    const { container } = render(<AuthPrompt sender={makeSender()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders tool name, summary, and four buttons", () => {
    useTetherStore.setState({
      pendingAuthRequest: {
        requestId: "auth-123",
        toolName: "Bash",
        toolInput: { command: "ls -la /tmp" },
        summary: "Bash: ls -la /tmp",
        sessionId: "sid-1",
      },
    });
    render(<AuthPrompt sender={makeSender()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Allow tool: Bash/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Bash: ls -la /tmp")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /allow once/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /allow always/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /deny once/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /deny always/i }),
    ).toBeInTheDocument();
  });

  it("sends auth.tool-decision with allow-once on Allow once click", async () => {
    useTetherStore.setState({
      pendingAuthRequest: {
        requestId: "auth-abc",
        toolName: "Read",
        toolInput: { file_path: "/tmp/x" },
        summary: "Read /tmp/x",
        sessionId: "sid-1",
      },
    });
    const sender = makeSender();
    render(<AuthPrompt sender={sender} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    });

    expect(sender).toHaveBeenCalledTimes(1);
    const [payload] = sender.mock.calls[0]!;
    expect(decodeSentDecision(payload as Uint8Array)).toEqual({
      type: "auth.tool-decision",
      requestId: "auth-abc",
      decision: "allow-once",
    });
    // Pending cleared after pick.
    expect(useTetherStore.getState().pendingAuthRequest).toBeNull();
  });

  it("sends deny-always on Deny always click", async () => {
    useTetherStore.setState({
      pendingAuthRequest: {
        requestId: "auth-deny",
        toolName: "Bash",
        toolInput: {},
        summary: "Bash",
        sessionId: "sid-1",
      },
    });
    const sender = makeSender();
    render(<AuthPrompt sender={sender} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /deny always/i }));
    });

    expect(sender).toHaveBeenCalledTimes(1);
    expect(
      decodeSentDecision(sender.mock.calls[0]![0] as Uint8Array),
    ).toEqual({
      type: "auth.tool-decision",
      requestId: "auth-deny",
      decision: "deny-always",
    });
  });

  it("disables buttons when sender is null", () => {
    useTetherStore.setState({
      pendingAuthRequest: {
        requestId: "auth-x",
        toolName: "Bash",
        toolInput: {},
        summary: "Bash",
        sessionId: "sid-1",
      },
    });
    render(<AuthPrompt sender={null} />);
    const btn = screen.getByRole("button", { name: /allow once/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/attach socket is not in rw mode/i)).toBeInTheDocument();
  });

  it("dequeues the next pending request after clearing", async () => {
    useTetherStore.setState({
      pendingAuthRequest: {
        requestId: "first",
        toolName: "Bash",
        toolInput: {},
        summary: "first",
        sessionId: "sid-1",
      },
      authRequestQueue: [
        {
          requestId: "second",
          toolName: "Read",
          toolInput: {},
          summary: "second",
          sessionId: "sid-1",
        },
      ],
    });
    render(<AuthPrompt sender={makeSender()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    });
    const s = useTetherStore.getState();
    expect(s.pendingAuthRequest?.requestId).toBe("second");
    expect(s.authRequestQueue).toHaveLength(0);
  });

  it("surfaces sender failure as an attach error but still clears the prompt", async () => {
    const sender = vi.fn(async () => {
      throw new Error("ipc broken");
    });
    useTetherStore.setState({
      pendingAuthRequest: {
        requestId: "auth-fail",
        toolName: "Bash",
        toolInput: {},
        summary: "Bash",
        sessionId: "sid-1",
      },
    });
    render(<AuthPrompt sender={sender} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    });
    const s = useTetherStore.getState();
    expect(s.attachState).toBe("error");
    expect(s.attachError).toMatch(/ipc broken/);
    expect(s.pendingAuthRequest).toBeNull();
  });
});
