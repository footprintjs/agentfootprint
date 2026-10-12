/** Internal evidence-binding ports. No public configuration or recorded row. */
import type { Assertion } from '../assertion/types.js';
import type { ClaimLedgerRow } from '../unsupported-claim/check.js';
import type { Coverage } from '../../core/agent/coverage/types.js';
import type { DeclaredPeriod } from '../../core/agent/coverage/period.js';
import type { ToolSemantics } from '../../lib/semantics/types.js';

export interface ScopeDimension {
  readonly name: string;
  readonly argumentPath: readonly string[];
  /** An explicitly authored tool default; never inferred from a schema. */
  readonly default?: unknown;
  /** Author-owned normalization, coupled to the declaration version. */
  readonly normalize?: (value: unknown) => unknown;
}

export interface ScopeDeclaration {
  readonly id: string;
  readonly version: string;
  readonly dimensions: readonly ScopeDimension[];
  /** Dimension holding the executed absolute { from, to } read interval. */
  readonly periodDimension?: string;
}

export interface ResultIdentity {
  /** Trusted unique recording namespace, retained by a later replay adapter. */
  readonly namespace: string;
  readonly runId: string;
  /** Runtime reserves this before awaiting dispatch; provider IDs are separate. */
  readonly ordinal: number;
}

export const BINDING_REASONS = Object.freeze([
  'invalid-claim',
  'unknown-rule',
  'invalid-rule',
  'missing-result',
  'ambiguous-result',
  'foreign-result',
  'incomplete-result',
  'withheld-evidence',
  'unassociated-result',
  'invalid-evidence',
  'missing-scope',
  'scope-mismatch',
  'scope-version-mismatch',
  'missing-fact',
  'ambiguous-fact',
  'unasserted-value',
  'coverage-undeclared',
  'coverage-partial',
  'coverage-unknown',
  'coverage-stale',
] as const);
export type BindingReason = (typeof BINDING_REASONS)[number];

export interface CapturedDispatch {
  readonly identity: ResultIdentity;
  readonly id: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly scopeDeclaration: { readonly id: string; readonly version: string };
  readonly scope?: Readonly<Record<string, unknown>>;
  readonly periodDimension?: string;
  readonly unavailable?: BindingReason;
}

export interface EvidenceBoundary {
  readonly scope: Readonly<Record<string, unknown>>;
  readonly coverage: Coverage;
  readonly period?: DeclaredPeriod;
}

export interface ResultEvidence extends CapturedDispatch {
  /** No raw result, arguments or facts survive an unavailable association. */
  readonly facts?: readonly ClaimLedgerRow[];
  readonly coverage?: Coverage;
  readonly period?: DeclaredPeriod;
}

/** Private return-time copy, captured before awaiting result governance. */
export interface ReturnedEvidence {
  readonly resultId: string;
  readonly semantics?: ToolSemantics;
  readonly unavailable?: 'invalid-evidence';
}

export interface EvidenceSnapshot {
  readonly version: 1;
  readonly namespace: string;
  /** Runtime-owned verified lineage; never supplied by a model declaration. */
  readonly runIds: readonly string[];
  readonly results: readonly ResultEvidence[];
}

export interface ClaimBindingRule {
  readonly id: string;
  readonly version: string;
  readonly toolName: string;
  readonly scopeDeclaration: ScopeDeclaration;
  readonly fact: {
    readonly entity: string | { readonly scopeDimension: string };
    readonly field: string;
  };
  /** Completeness must be explicitly checked by the author, never from prose. */
  readonly coverage?: (boundary: EvidenceBoundary) => 'complete' | 'partial' | 'unknown' | 'stale';
}

export type ClaimBinding =
  | { readonly kind: 'unverified'; readonly reason: BindingReason }
  | {
      /** Binding means eligible comparator inputs, not agreement or a badge. */
      readonly kind: 'bound';
      readonly resultId: string;
      readonly rule: { readonly id: string; readonly version: string };
      readonly scope: Readonly<Record<string, unknown>>;
      readonly coverage: Coverage;
      readonly period?: DeclaredPeriod;
      readonly evidence: Assertion;
      readonly claim: Assertion;
    };
