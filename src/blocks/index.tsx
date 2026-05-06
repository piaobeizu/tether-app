// Re-exports + a typed dispatcher.
//
// `<FencedBlock kind="dag" layout="compact" onExpand={fn} />` is the
// single integration point downstream surfaces (chat / artifact pane)
// will consume — they don't need to know which 4×2 component is
// underneath.

import type { FencedBlockKind } from "@/store/types";
import { CandidatesCompact, CandidatesFull } from "./CandidatesBlock";
import { DagCompact, DagFull } from "./DagBlock";
import { FormCompact, FormFull } from "./FormBlock";
import { MediaCompact, MediaFull } from "./MediaBlock";

export {
  DagCompact,
  DagFull,
  FormCompact,
  FormFull,
  CandidatesCompact,
  CandidatesFull,
  MediaCompact,
  MediaFull,
};

export type FencedBlockLayout = "compact" | "full";

interface FencedBlockProps {
  kind: FencedBlockKind;
  layout: FencedBlockLayout;
  /** Compact-layout-only callback fired when the user clicks the "expand" affordance. */
  onExpand?: () => void;
}

const COMPACT = {
  dag: DagCompact,
  form: FormCompact,
  candidates: CandidatesCompact,
  media: MediaCompact,
} as const;

const FULL = {
  dag: DagFull,
  form: FormFull,
  candidates: CandidatesFull,
  media: MediaFull,
} as const;

export function FencedBlock({ kind, layout, onExpand }: FencedBlockProps) {
  if (layout === "compact") {
    const C = COMPACT[kind];
    return <C onExpand={onExpand} />;
  }
  const F = FULL[kind];
  return <F />;
}
