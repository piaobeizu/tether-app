// Initial mock state for the tether app store. Extracted verbatim
// (with TypeScript typing) from the prototype's store.jsx.
//
// Replaced by real daemon-supplied state in Phases 5+ (connection
// state machine, real chat envelopes, real DAG events, real workspace
// list from `tether spawn` registry).

import type {
  ChatMessage,
  Connection,
  DagState,
  FormValues,
  Skill,
  Workspace,
} from "./types";

export const initialWorkspaces: Record<string, Workspace> = {
  "tether-app": {
    name: "tether-app",
    status: "live",
    skills: 3,
    files: [
      "src/blocks/dag.tsx",
      "src/blocks/form.tsx",
      "src/blocks/candidates.tsx",
      "src/blocks/media.tsx",
      "src/chat/",
      "src/store/",
      "tests/",
      "README.md",
    ],
    dirty: ["src/blocks/media.tsx"],
  },
  "tether-doc": {
    name: "tether-doc",
    status: "idle",
    skills: 0,
    files: ["wiki/specs/", "wiki/api/", "README.md"],
    dirty: [],
  },
  "tether-daemon": {
    name: "tether-daemon",
    status: "live",
    skills: 1,
    files: ["cmd/daemon/", "internal/transport/", "go.mod"],
    dirty: [],
  },
  "spec-archive": {
    name: "spec-archive",
    status: "idle",
    skills: 0,
    files: ["2026-04/", "2026-03/", "INDEX.md"],
    dirty: [],
  },
};

export const initialConnection: Connection = {
  state: "live",
  latency: 14,
  attempt: 0,
};

export const initialDag: DagState = {
  nodes: [
    { id: "n1", label: "scan repo", status: "done", ms: 1240 },
    { id: "n2", label: "parse spec", status: "done", ms: 860 },
    { id: "n3", label: "generate stubs", status: "done", ms: 3120 },
    { id: "n4", label: "write tests", status: "running", ms: null },
    { id: "n5", label: "run vitest", status: "queued", ms: null },
    { id: "n6", label: "report", status: "queued", ms: null },
  ],
  paused: false,
  elapsedMs: 94_000,
};

export const initialChat: ChatMessage[] = [
  {
    id: "c1",
    from: "user",
    t: "14:18",
    text:
      "the fenced block renderer is duplicated across mobile chat and desktop chat. extract a shared renderer that takes a layout prop?",
  },
  {
    id: "c2",
    from: "ai",
    t: "14:18",
    text:
      "Looked at `src/blocks/` — confirmed the duplication. I'll propose a single `renderBlock(block, layout)` dispatch.",
    block: "candidates",
  },
  {
    id: "c3",
    from: "user",
    t: "14:19",
    text: "go with the modular split. start the refactor task.",
  },
  {
    id: "c4",
    from: "ai",
    t: "14:19",
    text: "Configuring the task. Confirm scope and I'll begin:",
    block: "form",
  },
  {
    id: "c5",
    from: "ai",
    t: "14:21",
    text: "Refactor in flight — watching `vitest` next.",
    block: "dag",
  },
  {
    id: "c6",
    from: "ai",
    t: "14:23",
    text: "I attached an architecture sketch:",
    block: "media",
  },
];

export const initialForm: FormValues = {
  name: "extract-block-renderer",
  scope: "src/components/blocks",
  strategy: "compose",
  dryRun: true,
};

export const initialSkills: Skill[] = [
  {
    name: "refactor.code",
    v: "0.4.2",
    on: true,
    desc: "DAG-driven code restructuring",
  },
  {
    name: "spec.write",
    v: "0.2.1",
    on: true,
    desc: "spec writeup with structured form",
  },
  {
    name: "triage.issues",
    v: "0.1.0",
    on: true,
    update: "→ 0.2.0",
    desc: "candidate issue surfacer",
  },
  {
    name: "diff.review",
    v: "0.3.0",
    on: false,
    desc: "interactive diff review",
  },
  {
    name: "research.synth",
    v: "0.1.5",
    on: true,
    desc: "media-heavy research synthesis",
  },
];
