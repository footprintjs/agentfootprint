import type { AgentState } from '../../types.js';
import type { FoldedSpan } from '../../window/types.js';
import type { FindingsLedger } from '../../findings/types.js';
import type { EvidenceRecoveryCheckpoint } from '../../../runCheckpoint.js';

/** Both checkpoint doors keep the repair budget separately from conversation text. */
export function evidenceRecoveryOf(
  state?: Partial<AgentState>,
): EvidenceRecoveryCheckpoint | undefined {
  if (state?.evidenceRevisionSpent !== true) return undefined;
  const pending = state.evidenceRecovery;
  return {
    revisionSpent: true,
    ...(pending !== undefined &&
      state.evidenceRecoveryUsed !== true && {
        pending: {
          instruction: pending.instruction,
          ...(pending.conclusion !== undefined && { conclusion: pending.conclusion }),
        },
      }),
  };
}

/**
 * The folded spans this run has committed, cloned on the way out.
 *
 * One reader for both carriers — `checkpoint()` and the crash checkpoint
 * `RunCheckpointError` carries — so a conversation cannot keep its spans on
 * one path and silently lose them on the other. The clone is the same
 * promise `checkpoint()` makes about history: a persistence layer never gets
 * a reference into the live heap.
 *
 * @internal
 */
export function foldedSpansOf(state?: Partial<AgentState>): readonly FoldedSpan[] | undefined {
  const spans = state?.foldedSpans;
  if (spans === undefined || spans.length === 0) return undefined;
  return structuredClone(spans) as readonly FoldedSpan[];
}

/**
 * The findings ledger for a checkpoint (9.101.0) — `foldedSpansOf`'s twin:
 * one reader for `checkpoint()` and the crash carrier, `undefined` when the
 * run recorded no rows (so the key stays absent), and a detached copy
 * otherwise, never a reference into the live heap.
 *
 * @internal
 */
export function findingsLedgerOf(state?: Partial<AgentState>): FindingsLedger | undefined {
  const ledger = state?.findingsLedger;
  if (ledger === undefined || ledger.length === 0) return undefined;
  return structuredClone(ledger) as FindingsLedger;
}
