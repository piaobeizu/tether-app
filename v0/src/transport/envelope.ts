// Wire-side envelope types — frontend mirror of the daemon's
// agent.WireEnvelope (== jsonl.Envelope identity-mapped at the daemon
// boundary).
//
// MUST stay in sync with internal/agent/envelope_emitter.go
// `WireEnvelope` (struct + JSON tags). The daemon is the source of
// truth for both the `kind` enum and the per-kind metadata shape — if
// the cc → wire mapping in `internal/cc/jsonl/mapper.go` adds a field
// or kind, this file is the corresponding frontend update.
//
// Why we don't auto-generate: the wire surface is small (≈8 fields,
// 3 kinds) and the JSON shape is hand-authored on the daemon side
// (Go struct tags, not protobuf / OpenAPI). Hand-mirroring keeps the
// types narrow + reviewable; a generator would add a build-time hop
// for negative value.

/**
 * Wire-shape envelope as produced by the daemon's
 * `internal/agent.WireEnvelope` Go struct (see envelope_emitter.go
 * lines emitting `kind` / `providerType` / `sessionId` / `skill` /
 * `plaintextMetadata` / `ciphertextPayload` / `sourceUuid`).
 *
 * Notes on `ciphertextPayload`:
 * - On the wire it is JSON-encoded base64 (Go's default for `[]byte`),
 *   NOT a number array. Use `decodePayload()` to materialize.
 * - For v0.1 the bytes are plaintext JSON; Epic #5 will encrypt in
 *   place at one well-marked seam, after which decoding requires a
 *   per-session key. That migration changes only this file.
 *
 * MUST stay in sync with internal/agent/envelope_emitter.go LocalEnvelope.
 */
export interface LocalEnvelope {
  /** One of the EnvelopeKind constants below. Daemon may add new
   *  values in patch versions — consumers should treat unknown kinds
   *  as forwardable-but-unhandled (mirrors the Go classifier's
   *  ClassUnknown → STATE downgrade). */
  kind: string;
  /** v0.1: always "claude-code". v0.2+ peers (codex / opencode) set
   *  their own values. */
  providerType: string;
  sessionId: string;
  /** Set only when daemon-side fence-tag-suffix grep is on (sub-task
   *  #11). Today: always empty. */
  skill?: string;
  /** Per-kind plaintext routing metadata — see the per-kind narrowing
   *  helpers below for the field shapes. */
  plaintextMetadata?: Record<string, unknown>;
  /** Base64-encoded JSON bytes — the cc-side message body for
   *  `output.agent-event`, the attachment for `output.hook-event`, the
   *  raw JSONL line for `session.state`. */
  ciphertextPayload?: string;
  /** cc record uuid (when present). Useful for client-side dedup
   *  across reconnects / replay. */
  sourceUuid?: string;
}

/** v0.1 envelope kinds emitted by `internal/cc/jsonl/mapper.go`. The
 *  daemon may add new ones in patch versions — keep this enum
 *  permissive at the type-system level (handleFrame falls through). */
export const EnvelopeKind = {
  AgentEvent: "output.agent-event",
  HookEvent: "output.hook-event",
  SessionState: "session.state",
  AuthToolRequest: "auth.tool-request",
} as const;

export type EnvelopeKindValue =
  (typeof EnvelopeKind)[keyof typeof EnvelopeKind];

/**
 * Decode the base64 ciphertextPayload into the underlying JSON bytes
 * and parse. Returns null on:
 *  - missing payload
 *  - invalid base64
 *  - invalid JSON
 *
 * v0.1 payload is plaintext JSON; this is a single seam for Epic #5
 * to slot per-session decryption in front of JSON.parse.
 */
export function decodePayload(env: LocalEnvelope): unknown {
  if (!env.ciphertextPayload) return null;
  let raw: string;
  try {
    // atob is fine here — payload is always valid base64 ASCII (Go's
    // encoding/json marshals []byte via std-base64). For non-ASCII
    // text we then re-encode below via TextDecoder("utf-8"). Plain
    // atob would silently latin-1-truncate multi-byte code points.
    raw = atob(env.ciphertextPayload);
  } catch {
    return null;
  }
  // raw is a "byte string" (each char is one byte). Convert to a
  // Uint8Array, then UTF-8 decode → real JS string.
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Extract concatenated text from a cc message payload. The cc
 * `message` shape is `{ role, content: [{ type, text? }, ...] }`
 * where content blocks may be of type `text`, `tool_use`,
 * `tool_result`, etc. We return only the joined `text` blocks; other
 * block types (tool_use / tool_result) are intentionally NOT
 * stringified into chat — the future DAG / fenced-block layers
 * surface them separately.
 *
 * Returns null if the payload doesn't contain any extractable text
 * (e.g. assistant turn that's pure tool_use). The caller decides
 * whether to render an empty bubble or skip the row entirely.
 */
export function extractAgentText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const t = (block as { type?: unknown }).type;
    if (t !== "text") continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string" && text.length > 0) parts.push(text);
  }
  if (parts.length === 0) return null;
  return parts.join("\n");
}

/**
 * Extract the role from a cc message payload. Falls back to the
 * envelope's `plaintextMetadata.role` (which the mapper populates
 * verbatim from the JSONL `type` field — "user" or "assistant").
 */
export function extractAgentRole(
  env: LocalEnvelope,
  payload: unknown,
): "user" | "assistant" | null {
  if (payload && typeof payload === "object") {
    const r = (payload as { role?: unknown }).role;
    if (r === "user" || r === "assistant") return r;
  }
  const meta = env.plaintextMetadata;
  if (meta && typeof meta === "object") {
    const r = (meta as { role?: unknown }).role;
    if (r === "user" || r === "assistant") return r;
  }
  return null;
}
