import type { CauseGraph, TraversalLimits, WalkLimits } from 'foottrace/cause';

/** A host-authorized graph for exactly this artifact bag, never a model-named storage location. */
export interface TraceCauseArtifacts {
  readonly graph: CauseGraph;
  /** Discovery references when the graph has no roots port. These are non-secret IDs, not payloads. */
  readonly nodeIds?: readonly string[];
}

/** Host-owned cause-query ceilings. Model arguments cannot select or override them. */
export interface TraceCauseOptions extends WalkLimits {
  /** Default: floor(80% of the total node/edge/call limits), at least one. Depth is unchanged. */
  readonly backward?: TraversalLimits;
  /** Omit to leave all remaining total work available to impact. */
  readonly impact?: TraversalLimits;
  /** Maximum served JSON characters. Oversize evidence is withheld with an explicit truncated gap. */
  readonly maxChars?: number;
}

/** The three public read-only questions, also available inside an opened child record. */
export type TraceCauseOperation = 'attention_list' | 'root_cause' | 'impact';

/** Model questions select evidence only; resource policy stays in TraceCauseOptions. */
export interface TraceCauseQuestion {
  readonly nodeId?: string;
  readonly nodeIds?: readonly string[];
}
