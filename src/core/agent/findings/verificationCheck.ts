/**
 * Pure opt-in findings adapter. Role: bind one literal declaration to an exact
 * authorized result, then ask the shared evaluator; return a row for the EXISTING
 * findings writer. No ledger, evidence discovery, callbacks on restore or I/O.
 */
import { copyJson, ownData } from '../../../lib/boundedJson.js';
import { bindClaim } from '../../../integrity/claim-binding/bindEvidence.js';
import { boundedText } from '../../../integrity/claim-binding/scope.js';
import type {
  ClaimBindingRule,
  EvidenceSnapshot,
  ResultIdentity,
} from '../../../integrity/claim-binding/types.js';
import { evaluateClaimPair } from '../../../integrity/unsupported-claim/evaluate.js';
import type { DeclaredOn, Standing } from './types.js';
import type {
  ClaimVerificationRow,
  ClaimVerificationUnverifiedReason,
} from './verificationTypes.js';
import {
  claimIdentityOf,
  readClaimVerificationRow,
  VERIFICATION_LIMITS,
} from './verificationRow.js';

export interface FindingClaimCheckInput {
  readonly identity: ResultIdentity;
  readonly declaredOn: DeclaredOn;
  readonly standing: Standing;
  readonly iteration: number;
  readonly turn?: number;
  readonly request: unknown;
  /** Exact parent result reference, never selected by searching answer text. */
  readonly parentResult?: string;
  readonly snapshot: EvidenceSnapshot;
  readonly rules: readonly ClaimBindingRule[];
  readonly intendedScope?: unknown;
  readonly retentionLimited?: boolean;
}

/**
 * Invalid/missing JSON value throws explicitly: replacing it with null would
 * misrecord the declaration. A malformed optional check is a recorded refusal.
 * `supported` is possible only after bindClaim establishes an eligible pair;
 * the standalone evaluator's no-conflict result is never sufficient.
 */
export function checkFindingClaim(input: FindingClaimCheckInput): ClaimVerificationRow {
  const request = ownData(input.request);
  if (!Object.hasOwn(request, 'value')) throw new TypeError('Finding claim has no declared value.');
  const declaredValue = copyJson(request.value, VERIFICATION_LIMITS.valueBytes, true);
  let declaredRule: string | undefined;
  let checkProblem: 'missing-check' | 'malformed-check' | undefined;
  if (!Object.hasOwn(request, 'check')) checkProblem = 'missing-check';
  else {
    try {
      const check = ownData(request.check);
      if (boundedText(check.rule)) declaredRule = check.rule;
      if (Object.keys(check).some((key) => key !== 'rule') || declaredRule === undefined)
        checkProblem = 'malformed-check';
    } catch {
      checkProblem = 'malformed-check';
    }
  }
  if (Object.keys(request).some((key) => !['value', 'check', 'subject', 'predicate'].includes(key)))
    checkProblem = 'malformed-check';

  const base = {
    kind: 'claim-verification' as const,
    claimId: claimIdentityOf(input.identity),
    declaredOn: input.declaredOn,
    standing: input.standing,
    iteration: input.iteration,
    ...(input.turn !== undefined && { turn: input.turn }),
    checker: { id: 'claim-pair' as const, version: 1 as const },
    ...(input.parentResult !== undefined && { declaredResult: input.parentResult }),
    ...(declaredRule !== undefined && { declaredRule }),
    declaredValue,
  };
  const unverified = (reason: ClaimVerificationUnverifiedReason): ClaimVerificationRow =>
    readClaimVerificationRow({ ...base, outcome: 'unverified', reason });
  if (input.standing === 'noise') return unverified('ineligible-noise');
  if (checkProblem !== undefined) return unverified(checkProblem);
  if (input.parentResult === undefined) return unverified('missing-result');
  const bound = bindClaim(
    { result: input.parentResult, value: declaredValue, rule: declaredRule },
    input.snapshot,
    input.rules,
    input.intendedScope,
  );
  if (bound.kind === 'unverified')
    return unverified(
      bound.reason === 'missing-result' && input.retentionLimited === true
        ? 'retention-limit'
        : bound.reason,
    );

  if (Object.hasOwn(request, 'subject') || Object.hasOwn(request, 'predicate')) {
    try {
      const subject = ownData(request.subject, ['kind', 'id']);
      if (
        subject.kind !== bound.claim.subject.kind ||
        subject.id !== bound.claim.subject.id ||
        request.predicate !== bound.claim.predicate
      )
        return unverified('assertion-mismatch');
    } catch {
      return unverified('assertion-mismatch');
    }
  }
  const reason = evaluateClaimPair(bound.evidence, bound.claim);
  if (reason !== 'no-conflict' && reason !== 'numeric-leniency' && reason !== 'conflict')
    return unverified(reason);
  const resolved = {
    resultId: bound.resultId,
    rule: bound.rule,
    scope: bound.scope,
    coverage: bound.coverage,
    ...(bound.period !== undefined && { period: bound.period }),
    evidence: bound.evidence,
    claim: bound.claim,
  };
  return readClaimVerificationRow({
    ...base,
    outcome: reason === 'conflict' ? 'contradicted' : 'supported',
    reason,
    resolved,
  });
}
