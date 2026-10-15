/**
 * Strict saved claim-verification protocol. Role: validate and detach a recorded
 * check, never reconstruct evidence or rerun its checker. Storage authenticity
 * and caller authorization are the surrounding checkpoint owner's responsibility.
 */
import { copyJson, ownData } from '../../../lib/boundedJson.js';
import { canonicalJson } from '../../../lib/canonicalJson.js';
import {
  decodePresentIdentityField,
  encodeIdentityField,
} from '../../../memory/identity/encode.js';
import { comparableValueOf, participates } from '../../../integrity/assertion/types.js';
import { BINDING_LIMITS, boundedText } from '../../../integrity/claim-binding/scope.js';
import type { ResultIdentity } from '../../../integrity/claim-binding/types.js';
import { validateCoverage } from '../../../integrity/claim-binding/admit.js';
import { readResultIdentity } from '../../../integrity/claim-binding/capture.js';
import { periodProblem } from '../../../semantics/coverage/period.js';
import { STANDING_VALUES } from './types.js';
import { VERIFICATION_UNVERIFIED_REASONS, type ClaimVerificationRow } from './verificationTypes.js';

/** Reuse receipt bounds; declared values have the compact binding-request cap. */
export const VERIFICATION_LIMITS = Object.freeze({
  rowBytes: BINDING_LIMITS.resultBytes,
  valueBytes: BINDING_LIMITS.scopeBytes,
  identityText: BINDING_LIMITS.resultIdText + 'claim-verification'.length - 'claim-result'.length,
});

/** A runtime-reserved claim occurrence cannot collide with a result occurrence. */
export function claimIdentityOf(raw: ResultIdentity): string {
  const identity = ownData(raw, ['namespace', 'runId', 'ordinal']);
  if (
    !boundedText(identity.namespace) ||
    !boundedText(identity.runId) ||
    typeof identity.ordinal !== 'number' ||
    !Number.isSafeInteger(identity.ordinal) ||
    identity.ordinal < 1
  )
    throw new TypeError('Invalid runtime claim identity.');
  return `claim-verification/${encodeIdentityField(identity.namespace)}/${encodeIdentityField(
    identity.runId,
  )}/${identity.ordinal}`;
}

/** Canonical claim tuple reader, shared with checkpoint lineage/counter checks. */
export function readClaimIdentity(value: unknown): ResultIdentity {
  if (typeof value !== 'string' || value.length > VERIFICATION_LIMITS.identityText)
    throw new TypeError('Invalid saved claim identity.');
  const parts = value.split('/');
  if (parts.length !== 4 || parts[0] !== 'claim-verification')
    throw new TypeError('Invalid saved claim identity.');
  const identity = {
    namespace: decodePresentIdentityField(parts[1]),
    runId: decodePresentIdentityField(parts[2]),
    ordinal: Number(parts[3]),
  };
  if (value !== claimIdentityOf(identity))
    throw new TypeError('Noncanonical saved claim identity.');
  return Object.freeze(identity);
}

function integer(value: unknown, minimum: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function eligibleAssertion(raw: unknown): Record<string, unknown> {
  const assertion = ownData(raw, ['subject', 'predicate', 'value', 'stratum', 'provenance']);
  const subject = ownData(assertion.subject, ['kind', 'id']);
  const comparable = comparableValueOf(assertion.value);
  if (
    subject.kind !== 'entity' ||
    !boundedText(subject.id) ||
    !boundedText(assertion.predicate) ||
    assertion.stratum !== 'asserted' ||
    typeof assertion.provenance !== 'string' ||
    !Object.hasOwn(assertion, 'value') ||
    !participates(assertion.value) ||
    comparable === null ||
    comparable === undefined ||
    comparable === 'unknown'
  )
    throw new TypeError('Invalid eligible assertion.');
  return assertion;
}

function validateResolved(row: Record<string, unknown>, claimIdentity: ResultIdentity): void {
  const resolved = ownData(row.resolved, [
    'resultId',
    'rule',
    'scope',
    'coverage',
    'period',
    'evidence',
    'claim',
  ]);
  const rule = ownData(resolved.rule, ['id', 'version']);
  const scope = ownData(copyJson(resolved.scope, BINDING_LIMITS.scopeBytes, true));
  const resultIdentity = readResultIdentity(resolved.resultId);
  if (
    resultIdentity.namespace !== claimIdentity.namespace ||
    resolved.resultId !== row.declaredResult ||
    !boundedText(rule.id) ||
    rule.id !== row.declaredRule ||
    !boundedText(rule.version) ||
    Object.keys(scope).length === 0 ||
    Object.keys(scope).length > BINDING_LIMITS.dimensions ||
    !Object.keys(scope).every(boundedText)
  )
    throw new TypeError('Invalid verification association.');
  validateCoverage(resolved.coverage);
  if (Object.hasOwn(resolved, 'period') && periodProblem(resolved.period, 'camel') !== undefined)
    throw new TypeError('Invalid verification period.');
  const evidence = eligibleAssertion(resolved.evidence);
  const claim = eligibleAssertion(resolved.claim);
  if (
    canonicalJson(evidence.subject) !== canonicalJson(claim.subject) ||
    evidence.predicate !== claim.predicate ||
    evidence.provenance !== `result ${resolved.resultId}` ||
    claim.provenance !== `rule ${rule.id}` ||
    canonicalJson(claim.value) !== canonicalJson(row.declaredValue)
  )
    throw new TypeError('Invalid verification pair association.');
}

/** Validate the recorded protocol without evaluating whether its value agrees. */
export function readClaimVerificationRow(raw: unknown): ClaimVerificationRow {
  const detached = copyJson(raw, VERIFICATION_LIMITS.rowBytes, true);
  const row = ownData(detached, [
    'kind',
    'claimId',
    'declaredOn',
    'standing',
    'iteration',
    'turn',
    'checker',
    'declaredResult',
    'declaredRule',
    'declaredValue',
    'outcome',
    'reason',
    'resolved',
  ]);
  const checker = ownData(row.checker, ['id', 'version']);
  const claimIdentity = readClaimIdentity(row.claimId);
  if (
    row.kind !== 'claim-verification' ||
    typeof row.standing !== 'string' ||
    !(STANDING_VALUES as readonly string[]).includes(row.standing) ||
    !integer(row.iteration, 0) ||
    (Object.hasOwn(row, 'turn') && !integer(row.turn, 1)) ||
    checker.id !== 'claim-pair' ||
    checker.version !== 1 ||
    !Object.hasOwn(row, 'declaredValue') ||
    (Object.hasOwn(row, 'declaredResult') &&
      (typeof row.declaredResult !== 'string' ||
        row.declaredResult.length > BINDING_LIMITS.resultIdText)) ||
    (Object.hasOwn(row, 'declaredRule') && !boundedText(row.declaredRule))
  )
    throw new TypeError('Invalid claim-verification row.');
  copyJson(row.declaredValue, VERIFICATION_LIMITS.valueBytes, true);
  if (row.declaredOn !== 'answer') {
    const at = ownData(row.declaredOn, ['toolCallId']);
    if (!boundedText(at.toolCallId)) throw new TypeError('Invalid claim declaration location.');
  }
  if (row.outcome === 'unverified') {
    if (
      typeof row.reason !== 'string' ||
      !(VERIFICATION_UNVERIFIED_REASONS as readonly string[]).includes(row.reason) ||
      Object.hasOwn(row, 'resolved') ||
      (row.standing === 'noise' && row.reason !== 'ineligible-noise') ||
      (row.reason === 'ineligible-noise' && row.standing !== 'noise') ||
      (row.reason === 'missing-check' && Object.hasOwn(row, 'declaredRule')) ||
      (!['missing-check', 'malformed-check', 'ineligible-noise'].includes(row.reason) &&
        (!Object.hasOwn(row, 'declaredRule') ||
          (row.reason !== 'missing-result' && !Object.hasOwn(row, 'declaredResult'))))
    )
      throw new TypeError('Invalid unverified claim row.');
  } else {
    if (
      row.standing === 'noise' ||
      !(
        (row.outcome === 'supported' &&
          (row.reason === 'no-conflict' || row.reason === 'numeric-leniency')) ||
        (row.outcome === 'contradicted' && row.reason === 'conflict')
      )
    )
      throw new TypeError('Invalid compared claim row.');
    validateResolved(row, claimIdentity);
  }
  return detached as ClaimVerificationRow;
}

/** Non-throwing checkpoint union guard; admission uses the same strict reader. */
export function isClaimVerificationRow(raw: unknown): raw is ClaimVerificationRow {
  try {
    readClaimVerificationRow(raw);
    return true;
  } catch {
    return false;
  }
}
