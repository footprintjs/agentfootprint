import { comparableValueOf } from '../../../../../../integrity/assertion/types.js';
import { bindClaim } from '../../../../../../integrity/claim-binding/bindEvidence.js';
import { boundedText } from '../../../../../../integrity/claim-binding/scope.js';
import type {
  BindingReason,
  ClaimBindingRule,
  EvidenceSnapshot,
} from '../../../../../../integrity/claim-binding/types.js';
import { evaluateClaimPair } from '../../../../../../integrity/unsupported-claim/evaluate.js';
import { ownData } from '../../../../../../lib/boundedJson.js';

/** Authored from the answer span and host bindings before reading the citation. */
export interface CitationClaim {
  readonly ruleId: string;
  readonly entity: string;
  readonly field: string;
  readonly intendedScope: Readonly<Record<string, unknown>>;
  readonly value: unknown;
}

/** Evidence admitted through the accepted offer's exact body and result locator. */
export interface CitationEvidence {
  readonly resultId: string;
  readonly snapshot: EvidenceSnapshot;
  readonly rules: readonly ClaimBindingRule[];
}

type UnverifiedReason =
  | BindingReason
  | 'scope-unresolved'
  | 'offer-unavailable'
  | 'assertion-mismatch'
  | 'value-type-mismatch'
  | 'comparison-unavailable';

export type CitationClaimVerdict =
  | { readonly outcome: 'supported' }
  | { readonly outcome: 'contradicted' }
  | { readonly outcome: 'unverified'; readonly reason: UnverifiedReason };

const unverified = (reason: UnverifiedReason): CitationClaimVerdict => ({
  outcome: 'unverified',
  reason,
});

/** An eligible citation links evidence. Only an exact, scoped comparison supports its claim. */
export function checkCitationClaim(
  claim: CitationClaim | undefined,
  evidence: CitationEvidence | undefined,
): CitationClaimVerdict {
  let assertion: Record<string, unknown>;
  try {
    assertion = ownData(claim, ['ruleId', 'entity', 'field', 'intendedScope', 'value']);
  } catch {
    return unverified('scope-unresolved');
  }
  const intendedScope = assertion.intendedScope;
  if (
    !boundedText(assertion.entity) ||
    !boundedText(assertion.field) ||
    typeof intendedScope !== 'object' ||
    intendedScope === null
  ) {
    return unverified('scope-unresolved');
  }
  if (evidence === undefined) return unverified('offer-unavailable');

  const bound = bindClaim(
    { result: evidence.resultId, value: assertion.value, rule: assertion.ruleId },
    evidence.snapshot,
    evidence.rules,
    intendedScope,
  );
  if (bound.kind === 'unverified') return unverified(bound.reason);
  if (bound.claim.subject.id !== assertion.entity || bound.claim.predicate !== assertion.field) {
    return unverified('assertion-mismatch');
  }

  const actual = comparableValueOf(bound.evidence.value);
  const expected = comparableValueOf(bound.claim.value);
  if (typeof actual !== typeof expected || Array.isArray(actual) !== Array.isArray(expected)) {
    return unverified('value-type-mismatch');
  }
  const comparison = evaluateClaimPair(bound.evidence, bound.claim);
  if (comparison === 'no-conflict') return { outcome: 'supported' };
  if (comparison === 'conflict') return { outcome: 'contradicted' };
  return unverified('comparison-unavailable');
}
