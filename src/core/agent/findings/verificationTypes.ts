/**
 * Internal typed-finding protocol: model declarations and library checks stay
 * separate. A supported row concerns only its resolved rule and executed scope;
 * it is not verification of arbitrary prose or an entire answer.
 * Role: plain data shared by the pure writer and the strict saved-row reader.
 */
import { BINDING_REASONS } from '../../../integrity/claim-binding/types.js';
import type { ClaimBinding } from '../../../integrity/claim-binding/types.js';
import type { ClaimPairEvaluation } from '../../../integrity/unsupported-claim/evaluate.js';
import type { DeclaredOn, Standing } from './types.js';

export const VERIFICATION_UNVERIFIED_REASONS = Object.freeze([
  ...BINDING_REASONS,
  'missing-check',
  'malformed-check',
  'ineligible-noise',
  'assertion-mismatch',
  'retention-limit',
  'evidence-unavailable',
  'claim-nonparticipating',
  'doubt-against-value',
  'both-doubt',
] as const);

export type ClaimVerificationUnverifiedReason = (typeof VERIFICATION_UNVERIFIED_REASONS)[number];
export type ClaimVerificationReason = ClaimVerificationUnverifiedReason | ClaimPairEvaluation;

/** The model may cite a rule, never provide scope or resolved evidence. */
export interface FindingClaimRequest {
  readonly value: unknown;
  readonly check?: { readonly rule: string };
}

/** A legacy full assertion adds identity, not authority to choose evidence. */
export interface FullFindingClaimRequest extends FindingClaimRequest {
  readonly subject: { readonly kind: string; readonly id: string };
  readonly predicate: string;
}

export type ClaimVerificationAssociation = Omit<Extract<ClaimBinding, { kind: 'bound' }>, 'kind'>;

interface ClaimVerificationBase {
  readonly kind: 'claim-verification';
  /** Runtime-reserved declaration occurrence, not a provider tool id. */
  readonly claimId: string;
  readonly declaredOn: DeclaredOn;
  readonly standing: Standing;
  readonly iteration: number;
  readonly turn?: number;
  readonly checker: { readonly id: 'claim-pair'; readonly version: 1 };
  readonly declaredResult?: string;
  readonly declaredRule?: string;
  /** The literal bounded JSON declaration, never replaced by a resolved value. */
  readonly declaredValue: unknown;
}

export type ClaimVerificationRow = ClaimVerificationBase &
  (
    | {
        readonly outcome: 'supported';
        readonly reason: 'no-conflict' | 'numeric-leniency';
        readonly resolved: ClaimVerificationAssociation;
      }
    | {
        readonly outcome: 'contradicted';
        readonly reason: 'conflict';
        readonly resolved: ClaimVerificationAssociation;
      }
    | {
        readonly outcome: 'unverified';
        readonly reason: ClaimVerificationUnverifiedReason;
        readonly resolved?: never;
      }
  );
