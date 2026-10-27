import type { StageSnapshot } from 'footprintjs/advanced';
import type { TraceCauseArtifacts } from './causeTypes.js';
import type { TraceToolpackArtifacts } from './types.js';
import { storedCauseAssessment } from './storedCauseBinding.js';

/** The same three questions can read a graph directly or project a native snapshot. */
export type CauseContext =
  | { readonly kind: 'graph'; readonly cause: TraceCauseArtifacts }
  | {
      readonly kind: 'snapshot';
      readonly artifacts: TraceToolpackArtifacts;
      readonly nodes: ReadonlyMap<string, StageSnapshot>;
    };

/** A saved assessment belongs only to graph-only serving, never a mixed snapshot bag. */
export function causeContextAssessment(context: CauseContext) {
  try {
    const assessed = storedCauseAssessment(
      context.kind === 'graph' ? context.cause : context.artifacts.cause,
    );
    return context.kind === 'snapshot' && assessed.kind !== 'none'
      ? { kind: 'invalid' as const }
      : assessed;
  } catch {
    return { kind: 'invalid' as const };
  }
}
