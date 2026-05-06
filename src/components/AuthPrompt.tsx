// AuthPrompt — modal dialog shown when the daemon requests permission to
// run a cc tool. Subscribes to `pendingAuthRequest` in the store; on
// pick, sends an `auth.tool-decision` frame back via the active rw
// attach subscription and clears the request.
//
// UX choice: modal (not toast). Tool execution is gated on the user's
// answer — a non-blocking toast can be missed and would leave cc hung
// for the broker timeout (60s). A modal forces the choice now.
//
// Wire shape lives in src/transport/auth.ts; cross-repo contract is the
// JSON-on-the-wire field names ("type", "requestId", "decision").

import { useTetherStore } from "@/store";
import {
  AUTH_TOOL_DECISION_TYPE,
  encodeAuthDecisionFrame,
  type AuthDecision,
  type AuthToolRequestMetadata,
} from "@/transport/auth";
import { sendInput, type AttachSubscription } from "@/transport/attach";

interface AuthPromptProps {
  /** Live rw attach subscription used to ship the decision back. When
   *  null, the prompt buttons render disabled with an explanatory tip. */
  subscription: AttachSubscription | null;
}

export function AuthPrompt({ subscription }: AuthPromptProps) {
  const pending = useTetherStore((s) => s.pendingAuthRequest);
  const clear = useTetherStore((s) => s.clearAuthRequest);

  if (!pending) return null;

  const decide = async (decision: AuthDecision): Promise<void> => {
    if (subscription) {
      try {
        await sendInput(
          subscription,
          encodeAuthDecisionFrame({
            type: AUTH_TOOL_DECISION_TYPE,
            requestId: pending.requestId,
            decision,
          }),
        );
      } catch (e) {
        // Surface the error to the connection banner — but still clear
        // the prompt so the user isn't stuck. The daemon-side timeout
        // (60s) will deny the tool call.
        const msg = e instanceof Error ? e.message : String(e);
        useTetherStore
          .getState()
          .setAttachState("error", `auth send: ${msg}`);
      }
    }
    clear();
  };

  const inputJson = (() => {
    try {
      return JSON.stringify(pending.toolInput, null, 2);
    } catch {
      return "<unserializable input>";
    }
  })();

  return (
    <div className="auth-prompt-backdrop" role="presentation">
      <div
        className="auth-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-prompt-title"
      >
        <h2 id="auth-prompt-title" className="auth-prompt-title">
          Allow tool: {pending.toolName}?
        </h2>
        <p className="auth-prompt-summary">{pending.summary}</p>
        <pre className="auth-prompt-input" aria-label="tool input">
          {inputJson}
        </pre>
        <div className="auth-prompt-actions">
          <button
            type="button"
            className="btn-primary-sm"
            disabled={!subscription}
            onClick={() => void decide("allow-once")}
          >
            Allow once
          </button>
          <button
            type="button"
            className="btn-primary-sm"
            disabled={!subscription}
            onClick={() => void decide("allow-always")}
          >
            Allow always
          </button>
          <button
            type="button"
            className="btn-ghost-sm"
            disabled={!subscription}
            onClick={() => void decide("deny-once")}
          >
            Deny once
          </button>
          <button
            type="button"
            className="btn-ghost-sm"
            disabled={!subscription}
            onClick={() => void decide("deny-always")}
          >
            Deny always
          </button>
        </div>
        {!subscription ? (
          <p className="auth-prompt-tip">
            attach socket is not in rw mode — switch to rw to answer
            authorization prompts (the daemon will deny on timeout).
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Stored shape — subset of AuthToolRequestMetadata that the store
 *  retains until the user picks. Re-exported so the slice + tests
 *  share the same definition. */
export type StoredAuthRequest = AuthToolRequestMetadata;
