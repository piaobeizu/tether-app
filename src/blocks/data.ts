// Block-local mock data. The prototype keeps the candidate list at
// module scope of blocks.jsx (not in the store) since it's structurally
// content of the block, not application state. We follow the same
// split here.
//
// Phase 5+ replaces this with envelope-supplied content from the
// daemon; the block's prop type stays the same.

export interface Candidate {
  id: string;
  title: string;
  desc: string;
  tag: string;
}

export const sampleCandidates: readonly Candidate[] = [
  {
    id: "c1",
    title: "Co-locate parseContent with renderBlock",
    desc: "single file blocks/index.tsx; shared types",
    tag: "lean",
  },
  {
    id: "c2",
    title: "Split parser → renderer, share types module",
    desc: "blocks/parse.ts + blocks/render.tsx + types.ts",
    tag: "modular",
  },
  {
    id: "c3",
    title: "Plugin registry — each block self-registers",
    desc: "blocks/registry.ts; blocks/dag/index.tsx etc.",
    tag: "extensible",
  },
  {
    id: "c4",
    title: "Server-driven schema (block JSON over wire)",
    desc: "more complex; pays off w/ Variants",
    tag: "future-proof",
  },
  {
    id: "c5",
    title: "Inline everything in chat renderer",
    desc: "smallest LOC; duplicates between surfaces",
    tag: "fast",
  },
] as const;
