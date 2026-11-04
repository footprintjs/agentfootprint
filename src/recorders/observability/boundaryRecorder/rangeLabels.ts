import type { ContextSlot } from '../../../events/types.js';
import type { DomainSubflowEvent, DomainRunEvent, DomainCompositionEvent } from './domainEvents.js';

/**
 * Stripped projection used as the LABEL for the commit-range index.
 * Intentionally OMITS `payload` (security panel review YELLOW #1):
 * `boundaryIndex.enclosing()` queries should not bypass redaction by
 * exposing raw scope payloads through the range index. Consumers
 * needing payload can join on `runtimeStageId` with the full event
 * stream via `getEvents()` (which IS subject to redaction policy).
 */
export interface BoundaryRangeLabel {
  readonly type: 'subflow.entry' | 'run.entry' | 'composition.start';
  readonly runtimeStageId: string;
  readonly subflowPath: readonly string[];
  readonly depth: number;
  readonly ts: number;
  /** Set on subflow entries; undefined on the synthetic run-root entry. */
  readonly subflowId?: string;
  readonly localSubflowId?: string;
  readonly subflowName?: string;
  readonly description?: string;
  readonly primitiveKind?: string;
  readonly slotKind?: ContextSlot;
  readonly isAgentInternal?: boolean;
  /** Composition primitive (Parallel/Sequence/Loop/Conditional) when the
   *  range was opened by a `composition.start` event. */
  readonly compositionKind?: 'Parallel' | 'Sequence' | 'Loop' | 'Conditional';
  readonly compositionName?: string;
}

function toBoundaryLabel(e: DomainSubflowEvent | DomainRunEvent): BoundaryRangeLabel {
  if (e.type === 'subflow.entry') {
    return {
      type: 'subflow.entry',
      runtimeStageId: e.runtimeStageId,
      subflowPath: e.subflowPath,
      depth: e.depth,
      ts: e.ts,
      subflowId: e.subflowId,
      localSubflowId: e.localSubflowId,
      subflowName: e.subflowName,
      ...(e.description !== undefined ? { description: e.description } : {}),
      ...(e.primitiveKind !== undefined ? { primitiveKind: e.primitiveKind } : {}),
      ...(e.slotKind !== undefined ? { slotKind: e.slotKind } : {}),
      isAgentInternal: e.isAgentInternal,
    };
  }
  return {
    type: 'run.entry',
    runtimeStageId: e.runtimeStageId,
    subflowPath: e.subflowPath,
    depth: e.depth,
    ts: e.ts,
  };
}

/** Build a BoundaryRangeLabel for the open side of a composition pair. */
function toCompositionBoundaryLabel(e: DomainCompositionEvent): BoundaryRangeLabel {
  return {
    type: 'composition.start',
    runtimeStageId: e.runtimeStageId,
    subflowPath: e.subflowPath,
    depth: e.depth,
    ts: e.ts,
    compositionKind: e.kind,
    compositionName: e.name,
  };
}

export { toBoundaryLabel, toCompositionBoundaryLabel };
