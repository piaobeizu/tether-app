// Tool-authorization wire types — pinned byte-for-byte to the Go side
// in tether/internal/agent/auth.go. DO NOT rename fields without
// updating the Go struct tags in lockstep — the cross-repo contract is
// the JSON-on-the-wire shape, not the type names.
//
// Inbound envelope (daemon → UI):
//   LocalEnvelope{
//     kind: "auth.tool-request",
//     sessionId: "...",
//     plaintextMetadata: { requestId, toolName, toolInput, summary }
//   }
//
// Outbound input frame (UI → daemon, length-prefixed JSON):
//   { type: "auth.tool-decision", requestId: "...", decision: "..." }

export const AUTH_TOOL_REQUEST_KIND = "auth.tool-request" as const;
export const AUTH_TOOL_DECISION_TYPE = "auth.tool-decision" as const;

export type AuthDecision =
  | "allow-once"
  | "allow-always"
  | "deny-once"
  | "deny-always";

/** Parsed shape of an inbound auth.tool-request envelope's
 *  plaintextMetadata bag. Daemon serializes via Go's
 *  `map[string]any`, so toolInput is `unknown` rather than a typed
 *  shape — render as JSON string in the UI. */
export interface AuthToolRequestMetadata {
  requestId: string;
  toolName: string;
  /** Verbatim JSON pass-through from cc PreToolUse. May be any shape. */
  toolInput: unknown;
  /** Short ≤120-char human-readable summary computed daemon-side. */
  summary: string;
}

export interface AuthToolDecisionFrame {
  type: typeof AUTH_TOOL_DECISION_TYPE;
  requestId: string;
  decision: AuthDecision;
}

/** Type-guard — checks an arbitrary frame body looks like an
 *  auth.tool-request LocalEnvelope. Used by AttachBridge.handleFrame
 *  to dispatch into the auth-prompt slice. */
export function isAuthToolRequest(
  body: unknown,
): body is { kind: string; sessionId: string; plaintextMetadata: AuthToolRequestMetadata } {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  if (o.kind !== AUTH_TOOL_REQUEST_KIND) return false;
  if (typeof o.sessionId !== "string") return false;
  const meta = o.plaintextMetadata;
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  return (
    typeof m.requestId === "string" &&
    typeof m.toolName === "string" &&
    typeof m.summary === "string"
  );
}

/** Encode a decision frame as the byte payload sent over
 *  `tether_attach_send_input`. The daemon JSON-parses the input frame
 *  payload and routes by `type`. */
export function encodeAuthDecisionFrame(frame: AuthToolDecisionFrame): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(frame));
}
