import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { SourceEvidenceIndex } from '../../../artifacts/sourceEvidence/types.js';
import { sourceEvidenceIndex } from '../../../artifacts/sourceEvidence/guards.js';

/** One bounded continuation projection, shared by seed and pre-seed metadata reads. */
export function boundedSourceEvidenceIndex(
  input: SourceEvidenceIndex | undefined,
  maximum: number,
): SourceEvidenceIndex {
  const prior =
    input === undefined
      ? { version: 1 as const, refs: [], omitted: 0 }
      : sourceEvidenceIndex(input);
  const refs = prior.refs.slice(0, maximum),
    dropped = prior.refs.length - refs.length;
  if (prior.omitted > Number.MAX_SAFE_INTEGER - dropped)
    throw new TypeError('Source evidence omission counter overflow.');
  return { version: 1, refs, omitted: prior.omitted + dropped };
}

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
    scope.sourceEvidence = boundedSourceEvidenceIndex(inherited, deps.sourceEvidenceMaxReceipts);
  }
}
