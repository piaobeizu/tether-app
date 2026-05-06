// Tether app store. Single source of truth for the app's UI surfaces —
// workspace registry, DAG progress, chat messages, fenced-block
// expansion, pair flow, settings, connection state.
//
// Backed by zustand v5. State and Actions are produced by separate
// factory functions so each one's literal stays small enough for TS 6's
// contextual inference to type-check cleanly (large unioned literals
// were tripping noImplicitAny).
//
// Vanilla access (`useTetherStore.getState()`) is used by the timer
// module, which cannot call hooks.
//
// Phases 5+ replace mock fields with real envelope-stream wiring. The
// shape + action surface stay stable so consuming components don't
// change.

import { create } from "zustand";
import { loadSkills } from "./loadSkills";
import {
  initialChat,
  initialConnection,
  initialDag,
  initialForm,
  initialWorkspaces,
} from "./mock";
import type {
  AppRoute,
  AttachState,
  ChatExpanded,
  ChatMessage,
  Connection,
  DagNode,
  DagState,
  FencedBlockKind,
  FormValues,
  MobileRoute,
  PairMobileStep,
  PendingAuthRequest,
  SettingsTab,
  Skill,
  SlashCommand,
  Theme,
  Workspace,
  WtState,
} from "./types";

const THEME_STORAGE_KEY = "tether.theme";
const ATTACH_SID_STORAGE_KEY = "tether.attach.sessionId";

function readPersistedTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // Storage may be disabled (private mode, Tauri WebView lock-down).
  }
  return "light";
}

function writePersistedTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Best effort; toggling will still work in-memory.
  }
}

function readPersistedAttachSessionId(): string {
  // Priority: localStorage (user-set) > VITE_TETHER_SESSION_ID build-
  // time env (debug builds) > empty (UI shows the input field with no
  // pre-fill). We deliberately do NOT default to a hard-coded sid
  // because v0.1 has no way to pick one safely without a workspace
  // listing UI.
  if (typeof window !== "undefined") {
    try {
      const v = window.localStorage.getItem(ATTACH_SID_STORAGE_KEY);
      if (v) return v;
    } catch {
      /* localStorage may be disabled */
    }
  }
  // Vite exposes the env on `import.meta.env` after the `VITE_` prefix
  // allowlist (see vite.config.ts envPrefix). This fallback lets the
  // dev iteration loop auto-fill via a `.env.local`-style override.
  // Cast through unknown to placate TS lib config that doesn't ship
  // import.meta.env types.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> })
    .env;
  if (env && typeof env.VITE_TETHER_SESSION_ID === "string") {
    return env.VITE_TETHER_SESSION_ID;
  }
  return "";
}

function writePersistedAttachSessionId(sid: string): void {
  if (typeof window === "undefined") return;
  try {
    if (sid === "") {
      window.localStorage.removeItem(ATTACH_SID_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ATTACH_SID_STORAGE_KEY, sid);
    }
  } catch {
    /* best effort */
  }
}

// -------- shape --------

export interface ReloadState {
  /** True while a session reload is in progress. Drives the
   *  "正在重载会话…" banner. Cleared automatically when the next
   *  non-reload envelope arrives, or by a 30s safety timeout (see
   *  setReloading). */
  active: boolean;
  /** Free-form reason surfaced to the UI, e.g. the envelope kind that
   *  triggered the reload. Null when active is false. */
  reason: string | null;
  /** Wall-clock ms since epoch when reload started. Null when inactive.
   *  Useful for the safety-timeout countdown and dev diagnostics. */
  startedAt: number | null;
}

export interface State {
  // Workspaces
  activeWorkspace: string;
  workspaces: Record<string, Workspace>;

  // Mobile navigation
  drawerOpen: boolean;
  mobileRoute: MobileRoute;

  // Connection
  connection: Connection;
  paired: boolean;
  wtState: WtState;

  // DAG
  dag: DagState;

  // Chat
  chat: ChatMessage[];
  picked: string[];
  form: FormValues;
  composerText: string;
  slashOpen: boolean;
  chatExpanded: ChatExpanded;

  // Ambient
  errorBannerVisible: boolean;

  /** Session-reload UX feedback (v0.1 backlog item). Surfaces the
   *  "正在重载会话…" banner above AppShell while the daemon's session
   *  subsystem is recovering cc (Session.Recover firing after a cc
   *  exit). See AttachBridge.handleFrame for the wire-side trigger. */
  reload: ReloadState;

  // Settings
  settingsTab: SettingsTab;
  skills: Skill[];

  // Pair
  pairCode: string;
  pairTtl: number;
  pairMobileStep: PairMobileStep;

  // Top-level shell route (Phase 8). Drives <AppShell />; ignored
  // by the design-canvas App where every surface is rendered.
  route: AppRoute;

  // Theme — persisted to localStorage; cascades through tokens via
  // the `data-theme` attribute on the AppShell root.
  theme: Theme;

  // Local-daemon attach bridge (Phase 9). The sessionId is persisted
  // to localStorage so reopening the app reattaches to the same cc
  // session. State is set by the AttachBridge effect in AppShell.
  attachSessionId: string;
  attachState: AttachState;
  /** Last error string surfaced from the attach bridge — used by the
   *  Settings → connection panel; reset on a successful reconnect. */
  attachError: string | null;
  /** Monotonic counter — flipped by setAttachReconnectTrigger so the
   *  AttachBridge effect can re-run without a full app remount. */
  attachReconnectAttempt: number;

  // Tool authorization (Phase 9.1). Single in-flight request at a
  // time — cc serializes PreToolUse hooks per call site, but if
  // multiple show up the second one queues and we surface them in
  // arrival order. v0.1 keeps the queue in-memory only.
  pendingAuthRequest: PendingAuthRequest | null;
  authRequestQueue: PendingAuthRequest[];
}

export interface Actions {
  // Chat
  sendMessage: (text: string) => void;
  setComposer: (text: string) => void;
  pickSlash: (cmd: string) => void;
  toggleCandidate: (id: string) => void;
  setForm: (patch: Partial<FormValues>) => void;
  toggleChatBlock: (key: FencedBlockKind) => void;
  /** Append a chat message coming FROM an envelope (or any
   *  non-user-input source). Used by AttachBridge to push agent /
   *  hook / system rows. The `id` MUST be unique within the chat
   *  array — callers commonly use the envelope's `sourceUuid`. If the
   *  id is already present, the call is a no-op (idempotent across
   *  daemon replays on reconnect). */
  appendChat: (msg: ChatMessage) => void;

  // Workspaces / mobile
  setActiveWorkspace: (name: string) => void;
  toggleDrawer: () => void;
  setMobileRoute: (route: MobileRoute) => void;

  // DAG
  pauseDag: () => void;
  rollbackDag: () => void;
  /** Internal — used by the auto-advance ticker. */
  _advanceDag: () => void;

  // Settings / skills
  setSettingsTab: (tab: SettingsTab) => void;
  toggleSkill: (name: string) => void;
  /** Internal — populated by `loadSkills()` on store creation, or by
   *  tests that want to seed the list deterministically without
   *  awaiting the loader. */
  _setSkills: (skills: Skill[]) => void;

  // Connection
  reconnect: () => void;
  dismissBanner: () => void;
  triggerError: () => void;

  // Pair
  regeneratePairCode: () => void;
  setMobilePairStep: (step: PairMobileStep) => void;
  confirmPair: () => void;
  /** Internal — used by the TTL countdown ticker. */
  _tickPairTtl: () => void;

  // Routing (Phase 8)
  setRoute: (route: AppRoute) => void;

  // Theme
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // Attach bridge (Phase 9)
  setAttachSessionId: (sessionId: string) => void;
  setAttachState: (state: AttachState, error?: string | null) => void;
  triggerAttachReconnect: () => void;

  // Tool authorization (Phase 9.1)
  pushAuthRequest: (req: PendingAuthRequest) => void;
  clearAuthRequest: () => void;

  /** Mark the session as reloading. `reason` is surfaced verbatim to the
   *  banner — typically the envelope kind that triggered it. Arms a 30s
   *  safety timeout: if no clearReloading() arrives in that window, we
   *  auto-clear and console-warn so the UI never wedges if the daemon
   *  forgets to close the cycle. Calling setReloading again resets the
   *  timer; calling clearReloading cancels it. */
  setReloading: (reason: string) => void;
  /** Clear an in-progress reload. Idempotent — safe to call when
   *  reload.active is already false. Cancels the safety timeout. */
  clearReloading: () => void;
}

export type Slice = State & Actions;

// -------- helpers (used by both factories) --------

const PAIR_TTL_INITIAL = 60;

const PAIR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const regenCode = (): string => {
  const pick = (n: number): string =>
    Array.from({ length: n }, () =>
      PAIR_CODE_ALPHABET.charAt(
        Math.floor(Math.random() * PAIR_CODE_ALPHABET.length),
      ),
    ).join("");
  return `${pick(3)}-${pick(3)}`;
};

const formatHM = (date: Date): string =>
  date.toLocaleTimeString("en-GB").slice(0, 5);

const initialChatExpanded: ChatExpanded = {
  dag: false,
  form: false,
  candidates: false,
  media: false,
};

const MOCK_AI_REPLIES: readonly string[] = [
  "got it — applying that now.",
  "looking at the code… I'll surface candidates in a sec.",
  "queued. I'll report back when the DAG advances.",
  "checking the daemon log for related events.",
  "done. let me know if that's what you wanted.",
];

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { cmd: "/refactor", desc: "DAG-driven code restructuring" },
  { cmd: "/spec", desc: "spec writeup with structured form" },
  { cmd: "/triage", desc: "candidate issue surfacer" },
  { cmd: "/diff", desc: "interactive diff review" },
  { cmd: "/research", desc: "media-heavy research synthesis" },
] as const;

// -------- state factory --------

/** Mock fallback gate — Phase 10.
 *
 *  Real envelope traffic drives chat + DAG once the AttachBridge is
 *  connected. With no daemon attached, the UI would otherwise render
 *  empty and feel dead — so in dev (`vite dev` browser preview, the
 *  AppCanvas design surface, vitest) we seed chat + DAG with the v0.1
 *  mock corpus so the layouts have something to lay out.
 *
 *  Production builds (Tauri desktop / mobile) skip the mock so the
 *  user never sees fake agent turns mixed with real ones — they get
 *  an honest empty chat with the connection-state banner instead.
 *
 *  See also: `_advanceDag` and `sendMessage` below — both gate their
 *  mock chatter on `attachState !== "connected"` so once the bridge
 *  comes online the mocks stop firing even in dev.
 *
 *  Mirrors the same gate used by `loadSkills()` (Phase 9) — Vite
 *  defines `import.meta.env.DEV` as a build-time replaced literal so
 *  the prod bundle dead-code-eliminates the mock import below. */
function shouldUseMockFallback(): boolean {
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  return env?.DEV === true;
}

function initialState(): State {
  const mockFallback = shouldUseMockFallback();
  return {
    activeWorkspace: "tether-app",
    workspaces: initialWorkspaces,

    drawerOpen: false,
    mobileRoute: "main",

    connection: initialConnection,
    paired: true,
    wtState: "live",

    // DAG / chat: empty in production (driven by envelopes once
    // AttachBridge connects). Populated with the v0.1 mock corpus in
    // dev so the design canvas / browser preview have something to
    // render before a daemon is attached.
    dag: mockFallback
      ? initialDag
      : { nodes: [], paused: false, elapsedMs: 0 },

    chat: mockFallback ? initialChat : [],
    picked: ["c2"],
    form: initialForm,
    composerText: "",
    slashOpen: false,
    chatExpanded: initialChatExpanded,

    errorBannerVisible: true,

    settingsTab: "skills",
    skills: [],

    pairCode: "4F2-9K7",
    pairTtl: 47,
    pairMobileStep: "scan",

    route: "home",
    theme: readPersistedTheme(),

    attachSessionId: readPersistedAttachSessionId(),
    attachState: "idle",
    attachError: null,
    attachReconnectAttempt: 0,

    pendingAuthRequest: null,
    authRequestQueue: [],

    reload: { active: false, reason: null, startedAt: null },
  };
}

/** Safety timeout in ms — if reload state stays active past this, the
 *  UI auto-clears and logs a warning. 30s is a deliberately generous
 *  bound: cc cold-start typically takes <10s, but plugin reload + auth
 *  re-warmup can stretch on slow disks. Any reload exceeding this is a
 *  bug in the daemon or the JSONL pump, not a user-visible "this is
 *  normal" delay — better to surface stuck-state than freeze the UI. */
export const RELOAD_SAFETY_TIMEOUT_MS = 30_000;

/** Module-scoped timer handle so setReloading() / clearReloading() can
 *  cancel each other and so multiple setReloading() calls just refresh
 *  the deadline rather than stack a queue of timers. */
let reloadSafetyTimer: ReturnType<typeof setTimeout> | null = null;

function clearReloadSafetyTimer(): void {
  if (reloadSafetyTimer !== null) {
    clearTimeout(reloadSafetyTimer);
    reloadSafetyTimer = null;
  }
}

// -------- actions factory --------

type SetSlice = (
  partial:
    | Partial<Slice>
    | ((s: Slice) => Partial<Slice>),
  replace?: false,
) => void;
type GetSlice = () => Slice;

function makeActions(set: SetSlice, get: GetSlice): Actions {
  return {
    sendMessage: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const userMsg: ChatMessage = {
        id: `u${Date.now()}`,
        from: "user",
        t: formatHM(new Date()),
        text: trimmed,
      };
      set((s) => ({
        chat: [...s.chat, userMsg],
        composerText: "",
        slashOpen: false,
      }));

      // Phase 10 gating: when the AttachBridge is connected, real
      // agent turns arrive via `output.agent-event` envelopes and the
      // user's input would (in v0.2+) be forwarded to the daemon's
      // SendUserMessage seam. Until that wiring lands, suppress the
      // canned mock reply so the user doesn't see fake AI text mixed
      // with real envelope output. Disconnected dev mode keeps the
      // mock so the design canvas + browser preview feel alive.
      if (get().attachState === "connected") return;

      const reply =
        MOCK_AI_REPLIES[Math.floor(Math.random() * MOCK_AI_REPLIES.length)] ??
        MOCK_AI_REPLIES[0]!;
      setTimeout(() => {
        set((s) => ({
          chat: [
            ...s.chat,
            {
              id: `a${Date.now()}`,
              from: "ai",
              t: formatHM(new Date()),
              text: reply,
            },
          ],
        }));
      }, 800);
    },

    setComposer: (text) => {
      set({ composerText: text, slashOpen: text.startsWith("/") });
    },

    pickSlash: (cmd) => {
      set({ composerText: `${cmd} `, slashOpen: false });
    },

    toggleCandidate: (id) => {
      set((s) => ({
        picked: s.picked.includes(id)
          ? s.picked.filter((x) => x !== id)
          : [...s.picked, id],
      }));
    },

    setForm: (patch) => {
      set((s) => ({ form: { ...s.form, ...patch } }));
    },

    toggleChatBlock: (key) => {
      set((s) => ({
        chatExpanded: { ...s.chatExpanded, [key]: !s.chatExpanded[key] },
      }));
    },

    appendChat: (msg) => {
      // Idempotent on id — Phase-9 reconnects can replay the daemon's
      // recent envelope buffer and we don't want duplicate rows. The
      // dedup check is O(n) on the chat array; n stays small (chat
      // sessions are bounded to hundreds of turns) so the explicit
      // Set lookup isn't worth the allocation.
      set((s) => {
        if (s.chat.some((m) => m.id === msg.id)) return s;
        return { chat: [...s.chat, msg] };
      });
    },

    setActiveWorkspace: (name) => {
      set({ activeWorkspace: name, drawerOpen: false });
    },

    toggleDrawer: () => {
      set((s) => ({ drawerOpen: !s.drawerOpen }));
    },

    setMobileRoute: (route) => {
      set({ mobileRoute: route });
    },

    pauseDag: () => {
      set((s) => ({ dag: { ...s.dag, paused: !s.dag.paused } }));
    },

    rollbackDag: () => {
      set((s) => ({
        dag: {
          ...s.dag,
          nodes: s.dag.nodes.map((n: DagNode, i: number) =>
            i === 0
              ? { ...n, status: "running" as const, ms: null }
              : { ...n, status: "queued" as const, ms: null },
          ),
          elapsedMs: 0,
        },
      }));
    },

    _advanceDag: () => {
      const cur = get();
      // Skip ticks when the current route doesn't render a DAG. Cuts
      // the 1Hz re-render churn on settings / errors / pair routes
      // for components subscribed to s.dag.
      if (cur.route !== "home") return;
      // Phase 10 gating: when the AttachBridge is connected, real DAG
      // progress will be driven by envelope events. Disable the mock
      // ticker so the deterministic envelope-driven tests don't see
      // spurious node transitions from the 1Hz background timer. The
      // ticker resumes automatically when the bridge drops back below
      // "connected" (so disconnect → mock animation in dev).
      if (cur.attachState === "connected") return;
      if (cur.dag.paused) return;
      const ri = cur.dag.nodes.findIndex(
        (n: DagNode) => n.status === "running",
      );
      if (ri === -1) return;
      const willAdvance = Math.random() > 0.85;
      set((s) => {
        const dag = s.dag;
        const elapsed = dag.elapsedMs + 1000;
        if (!willAdvance) {
          return { dag: { ...dag, elapsedMs: elapsed } };
        }
        const nodes = [...dag.nodes];
        const next = nodes[ri];
        if (next) {
          nodes[ri] = {
            ...next,
            status: "done",
            ms: 1500 + Math.floor(Math.random() * 2500),
          };
        }
        const after = nodes[ri + 1];
        if (after) {
          nodes[ri + 1] = { ...after, status: "running" };
        }
        return { dag: { ...dag, nodes, elapsedMs: elapsed } };
      });
    },

    setSettingsTab: (tab) => {
      set({ settingsTab: tab });
    },

    toggleSkill: (name) => {
      set((s) => ({
        skills: s.skills.map((sk: Skill) =>
          sk.name === name ? { ...sk, on: !sk.on } : sk,
        ),
      }));
    },

    _setSkills: (skills) => {
      set({ skills });
    },

    reconnect: () => {
      set({
        connection: { state: "reconnecting", latency: null, attempt: 1 },
        wtState: "reconnecting",
      });
      setTimeout(() => {
        set({
          connection: {
            state: "live",
            latency: 14 + Math.floor(Math.random() * 10),
            attempt: 0,
          },
          wtState: "live",
          errorBannerVisible: false,
        });
      }, 1800);
    },

    dismissBanner: () => {
      set({ errorBannerVisible: false });
    },

    triggerError: () => {
      set({
        errorBannerVisible: true,
        wtState: "reconnecting",
        connection: { state: "reconnecting", latency: null, attempt: 1 },
      });
    },

    regeneratePairCode: () => {
      set({ pairCode: regenCode(), pairTtl: PAIR_TTL_INITIAL });
    },

    setMobilePairStep: (step) => {
      set({ pairMobileStep: step });
    },

    confirmPair: () => {
      set({ pairMobileStep: "success" });
      setTimeout(() => set({ pairMobileStep: "scan" }), 3000);
    },

    _tickPairTtl: () => {
      // Pair TTL only matters while the user is on the pair surface.
      // On any other route the timer is wasted churn.
      const cur = get();
      if (cur.route !== "pair") return;
      set((s) =>
        s.pairTtl <= 0
          ? { pairTtl: PAIR_TTL_INITIAL, pairCode: regenCode() }
          : { pairTtl: s.pairTtl - 1 },
      );
    },

    setRoute: (route) => {
      set({ route });
    },

    setTheme: (theme) => {
      writePersistedTheme(theme);
      set({ theme });
    },

    toggleTheme: () => {
      const next: Theme = get().theme === "light" ? "dark" : "light";
      writePersistedTheme(next);
      set({ theme: next });
    },

    setAttachSessionId: (sessionId) => {
      writePersistedAttachSessionId(sessionId);
      set({ attachSessionId: sessionId });
    },

    setAttachState: (state, error = null) => {
      set({ attachState: state, attachError: error });
    },

    triggerAttachReconnect: () => {
      set((s) => ({
        attachReconnectAttempt: s.attachReconnectAttempt + 1,
        attachState: "reconnecting",
        attachError: null,
      }));
    },

    pushAuthRequest: (req) => {
      set((s) => {
        // Drop duplicates by requestId — daemon won't re-emit but a
        // late frame replay (reconnect) could.
        const inFlight = s.pendingAuthRequest?.requestId === req.requestId;
        const queued = s.authRequestQueue.some(
          (r) => r.requestId === req.requestId,
        );
        if (inFlight || queued) return s;
        if (!s.pendingAuthRequest) {
          return { pendingAuthRequest: req };
        }
        return { authRequestQueue: [...s.authRequestQueue, req] };
      });
    },

    clearAuthRequest: () => {
      set((s) => {
        const [head, ...rest] = s.authRequestQueue;
        return {
          pendingAuthRequest: head ?? null,
          authRequestQueue: rest,
        };
      });
    },

    setReloading: (reason) => {
      // Reset any prior safety timer so the deadline is always
      // measured from the most recent setReloading() call.
      clearReloadSafetyTimer();
      set({
        reload: {
          active: true,
          reason,
          startedAt: Date.now(),
        },
      });
      reloadSafetyTimer = setTimeout(() => {
        reloadSafetyTimer = null;
        const cur = get();
        if (!cur.reload.active) return; // already cleared by a frame
        // Surface the stuck-state to devs without locking the UI —
        // the banner disappears and normal traffic resumes.
        // eslint-disable-next-line no-console
        console.warn(
          `[reload] safety timeout fired after ${RELOAD_SAFETY_TIMEOUT_MS}ms — auto-clearing (reason was "${cur.reload.reason ?? ""}")`,
        );
        set({
          reload: { active: false, reason: null, startedAt: null },
        });
      }, RELOAD_SAFETY_TIMEOUT_MS);
    },

    clearReloading: () => {
      clearReloadSafetyTimer();
      const cur = get();
      if (!cur.reload.active) return;
      set({ reload: { active: false, reason: null, startedAt: null } });
    },
  };
}

// -------- store --------

export const useTetherStore = create<Slice>()((set, get) => ({
  ...initialState(),
  ...makeActions(set, get),
}));

// Kick off the skills loader on module evaluation. Best-effort —
// failures keep the empty list so the UI just doesn't show skills,
// rather than crashing. Phase 9 swaps loadSkills() to a real Tauri
// command without changing this call site.
//
// Test-mode behavior: the `typeof window !== "undefined"` gate is a
// browser-vs-SSR check, NOT a test-vs-prod check — vitest's happy-dom
// runtime defines `window`, so the loader DOES run under vitest. Tests
// that want a deterministic skills list MUST override post-mount via
// `useTetherStore.setState({ skills: [...] })` or call `_setSkills` to
// race against (or after) the resolver — they cannot rely on the
// loader being skipped.
if (typeof window !== "undefined") {
  loadSkills()
    .then((skills) => {
      useTetherStore.getState()._setSkills(skills);
    })
    .catch(() => {
      // Phase 9 will surface the load failure via an error banner;
      // for v0.1 the UI just shows an empty skill list.
    });
}
