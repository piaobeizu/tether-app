// Shape of the in-process tether app store. Mirrors the prototype's
// store.jsx (Claude Design bundle 2026-05-06) with TypeScript types.
//
// Phases 3+ replace mock data with real wiring (daemon socket / WT
// envelope stream / fence-tag-suffix grep results). The shape and
// action surface stay stable so consuming components never see the
// transition.

export type ConnectionState = "live" | "reconnecting" | "dropped";
export type WtState = "live" | "reconnecting";

/** Daemon attach bridge state — the local Unix socket pump that
 *  AppShell opens against `~/.tether/attach.sock`. Distinct from the
 *  device-to-device WT state above (which fronts the cross-network
 *  WebTransport session). v0.1: surfaces via the connection-state slice
 *  so the existing banner UI works without rewiring.
 *
 *  State semantics — note the deliberate split between auto-retry and
 *  manual-retry so callers reading the store don't conflate them:
 *  - `idle`            — no sessionId set, or bridge has not run yet.
 *  - `connecting`      — opening the socket (Rust-side `connecting` event).
 *  - `connected`       — `attach.ack` received, frame loop running.
 *  - `backoff-pending` — bridge is internally waiting out the 2s
 *                        auto-retry backoff after a transient drop /
 *                        error. Subsequent `connecting` transition is
 *                        automatic. NOT triggered by user action.
 *  - `reconnecting`    — user clicked the "reconnect" button (manual
 *                        retry); resets the auto-retry budget.
 *                        Different from `backoff-pending` because the
 *                        UI may want to surface them differently (e.g.
 *                        spinner vs. dimmed-banner).
 *  - `error`           — terminal-for-this-attempt failure; bridge
 *                        will transition to `backoff-pending` if the
 *                        retry budget allows, else `no-daemon`.
 *  - `no-daemon`       — auto-retry budget exhausted; user must click
 *                        reconnect to resume. */
export type AttachState =
  | "idle"
  | "connecting"
  | "connected"
  | "backoff-pending"
  | "reconnecting"
  | "error"
  | "no-daemon";

export interface Connection {
  state: ConnectionState;
  /** ms; null while reconnecting or dropped */
  latency: number | null;
  /** monotonic counter — incremented on each reconnect attempt */
  attempt: number;
}

export type WorkspaceStatus = "live" | "idle";

export interface Workspace {
  name: string;
  status: WorkspaceStatus;
  /** Count of skills enabled in this workspace's tether.toml. */
  skills: number;
  /** Top-level paths surfaced in the workspace tree (mock for v0.1). */
  files: readonly string[];
  /** Files with unstaged edits — drives the dirty-dot in the tree. */
  dirty: readonly string[];
}

export type MobileRoute = "main" | "skill" | "pair";

/** Top-level route for the real app shell (Phase 8+). The design
 *  canvas mode at App.canvas.tsx ignores this and renders all
 *  surfaces simultaneously. */
export type AppRoute = "home" | "pair" | "settings" | "errors";

/** Theme. Persisted to localStorage; the AppShell stamps
 *  `data-theme` on its root so token vars cascade through the tree. */
export type Theme = "light" | "dark";

export type DagNodeStatus = "queued" | "running" | "done" | "error";

export interface DagNode {
  id: string;
  label: string;
  status: DagNodeStatus;
  /** Elapsed ms once status transitions to done. null while queued/running. */
  ms: number | null;
}

export interface DagState {
  nodes: DagNode[];
  paused: boolean;
  elapsedMs: number;
}

export type ChatRole = "user" | "ai";
export type FencedBlockKind = "dag" | "form" | "candidates" | "media";

export interface ChatMessage {
  id: string;
  from: ChatRole;
  /** "HH:MM" 24-hour. Mock data uses fixed values; live stream uses the
   *  envelope's `ts` field formatted client-side. */
  t: string;
  text: string;
  /** When set, the renderer attaches the corresponding fenced block
   *  inline (compact layout). */
  block?: FencedBlockKind;
}

export interface FormValues {
  name: string;
  scope: string;
  strategy: string;
  dryRun: boolean;
}

export type ChatExpanded = Record<FencedBlockKind, boolean>;

export type SettingsTab = "account" | "skills" | "connection" | "about";

export interface Skill {
  name: string;
  v: string;
  on: boolean;
  /** When set, tells the user "→ <new version>" is available. */
  update?: string;
  desc: string;
}

export type PairMobileStep = "scan" | "confirm" | "success";

/** Slash-menu commands surfaced in the desktop composer when text starts with "/".
 *  Phase 4 wires real handlers; Phase 2 just renders the menu items. */
export interface SlashCommand {
  cmd: string;
  desc: string;
}
