import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { SourceEvidenceIndex } from '../../../artifacts/sourceEvidence/types.js';
import { sourceEvidenceIndex } from '../../../artifacts/sourceEvidence/guards.js';

/** Restore only the owner's bounded source index; composition members start empty. */
export function seedSourceEvidence(
  scope: TypedScope<AgentState>,
  deps: {
    readonly sourceEvidenceMaxReceipts?: number;
    readonly consumePendingResumeSourceEvidence?: () => SourceEvidenceIndex | undefined;
  },
  mounted: boolean,
): void {
  if (deps.sourceEvidenceMaxReceipts !== undefined) {
    const inherited = mounted ? undefined : deps.consumePendingResumeSourceEvidence?.();
    const prior =
      inherited === undefined
        ? { version: 1 as const, refs: [], omitted: 0 }
        : sourceEvidenceIndex(inherited);
    const refs = prior.refs.slice(0, deps.sourceEvidenceMaxReceipts);
    const dropped = prior.refs.length - refs.length;
    if (prior.omitted > Number.MAX_SAFE_INTEGER - dropped)
      throw new TypeError('Source evidence omission counter overflow.');
    const omitted = prior.omitted + dropped;
    scope.sourceEvidence = { version: 1, refs, omitted };
  }
}
