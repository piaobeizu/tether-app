// AuthPrompt — unit tests for the modal dialog. Exercises:
//   - hidden when no pending request
//   - renders tool name + summary + four buttons
//   - clicking "allow once" sends the right decision frame via sendInput
//   - clicking "deny always" sends the right decision frame
//   - clears the pending request after a click
//   - buttons are disabled when subscription is null

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { act } from "react";

import type { AttachSubscription } from "@/transport/attach";

vi.mock("@/transport/attach", () => {
  return {
    sendInput: vi.fn(),
  };
});

// eslint-disable-next-line import/first
import { AuthPrompt } from "./AuthPrompt";
// eslint-disable-next-line import/first
import { useTetherStore } from "@/store";
// eslint-disable-next-line import/first
import * as transport from "@/transport/attach";

const sendInputMock = transport.sendInput as ReturnType<typeof vi.fn>;

function fakeSub(): AttachSubscription {
  return { id: "fake-1", dispose: vi.fn(async () => {}) };
}

function decodeSentDecision(callArg: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(callArg));
}

describe("AuthPrompt", () => {
  beforeEach(() => {
    sendInputMock.mockReset();
    sendInputMock.mockResolvedValue(undefined);
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
    const { container } = render(<AuthPrompt subscription={fakeSub()} />);
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
    render(<AuthPrompt subscription={fakeSub()} />);
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
    const sub = fakeSub();
    render(<AuthPrompt subscription={sub} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    });

    expect(sendInputMock).toHaveBeenCalledTimes(1);
    const [calledSub, payload] = sendInputMock.mock.calls[0]!;
    expect(calledSub).toBe(sub);
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
    render(<AuthPrompt subscription={fakeSub()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /deny always/i }));
    });

    expect(sendInputMock).toHaveBeenCalledTimes(1);
    expect(
      decodeSentDecision(sendInputMock.mock.calls[0]![1] as Uint8Array),
    ).toEqual({
      type: "auth.tool-decision",
      requestId: "auth-deny",
      decision: "deny-always",
    });
  });

  it("disables buttons when subscription is null", () => {
    useTetherStore.setState({
      pendingAuthRequest: {
        requestId: "auth-x",
        toolName: "Bash",
        toolInput: {},
        summary: "Bash",
        sessionId: "sid-1",
      },
    });
    render(<AuthPrompt subscription={null} />);
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
    render(<AuthPrompt subscription={fakeSub()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    });
    const s = useTetherStore.getState();
    expect(s.pendingAuthRequest?.requestId).toBe("second");
    expect(s.authRequestQueue).toHaveLength(0);
  });

  it("surfaces sendInput failure as an attach error but still clears the prompt", async () => {
    sendInputMock.mockRejectedValueOnce(new Error("ipc broken"));
    useTetherStore.setState({
      pendingAuthRequest: {
        requestId: "auth-fail",
        toolName: "Bash",
        toolInput: {},
        summary: "Bash",
        sessionId: "sid-1",
      },
    });
    render(<AuthPrompt subscription={fakeSub()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    });
    const s = useTetherStore.getState();
    expect(s.attachState).toBe("error");
    expect(s.attachError).toMatch(/ipc broken/);
    expect(s.pendingAuthRequest).toBeNull();
  });
});
