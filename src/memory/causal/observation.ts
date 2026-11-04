/** Evidence is limited to one captured component execution leg. */
import type { NativeRunOrigin } from 'footprintjs';
import type { DecisionRecord, ToolCallRecord } from './types.js';

export type EvidenceEntry =
  | { readonly kind: 'run' }
  | { readonly kind: 'resume'; readonly mode: 'same' | 'fresh' }
  | { readonly kind: 'mounted'; readonly nativeEntry: 'unavailable' };

export interface EvidenceCoverage {
  readonly scope: 'component-execution-leg';
  readonly runId: string;
  readonly entry: EvidenceEntry;
  readonly priorLegs: 'not-carried';
}

export interface SnapshotCoverage extends EvidenceCoverage {
  readonly source: Extract<NativeRunOrigin, { readonly kind: 'stage' }>;
}

export const EVIDENCE_CAUSES = [
  'observer-failed',
  'bounded-observation',
  'incomplete-tool-pairs',
  'duplicate-tool-start',
  'missing-usage',
] as const;

export type EvidenceCause = (typeof EVIDENCE_CAUSES)[number];
export const EVIDENCE_LIMITS = Object.freeze({
  decisions: 256,
  toolCalls: 256,
  pendingStarts: 256,
});

export interface ObservedEvidence<C extends EvidenceCoverage = EvidenceCoverage> {
  readonly coverage: C;
  readonly decisions: readonly DecisionRecord[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly observedIterationStarts: number;
  readonly lastObservedIteration?: number;
  readonly toolAccounting: {
    readonly unmatchedStarts: number;
    readonly unmatchedEnds: number;
    readonly duplicateStarts: number;
  };
  readonly usageAccounting: { readonly observedCalls: number; readonly missingUsage: number };
  readonly omittedObservations: {
    readonly decisions: number;
    readonly toolCalls: number;
    readonly pendingStarts: number;
  };
  readonly duration:
    | { readonly kind: 'measured'; readonly observationWindowMs: number }
    | { readonly kind: 'unavailable' };
  /** Observed input/output only; not the whole answer's cost or provider bill. */
  readonly tokenUsage: { readonly input: number; readonly output: number };
}

export type Observation<C extends EvidenceCoverage = EvidenceCoverage> =
  | (ObservedEvidence<C> & { readonly availability: 'observed' })
  | (ObservedEvidence<C> & {
      readonly availability: 'partial';
      readonly causes: readonly EvidenceCause[];
    })
  | {
      readonly availability: 'unavailable';
      readonly reason: 'not-configured' | 'observer-failed' | 'collector-failed';
    };

export type RunEvidence = Observation;
