/**
 * One admission boundary for the verifier's private checkpoint carrier.
 * Role: join validated observation identities to retained lineage/counters,
 * never reconstruct evidence, evaluate a claim or authenticate storage.
 * Historical observations without a carrier are readable but supply no grant.
 */
import { ownData } from '../../../lib/boundedJson.js';
import { canonicalJson } from '../../../lib/canonicalJson.js';
import { readResultIdentity } from '../../../integrity/claim-binding/capture.js';
import { ownConfigArray } from '../../../integrity/claim-binding/scope.js';
import { readClaimIdentity, readClaimVerificationRow } from './verificationRow.js';
import { readVerificationState, type ClaimVerificationState } from './verificationState.js';
import type { ClaimVerificationRow } from './verificationTypes.js';

/** Classify stored rows as data, using the same strict new-row reader on both paths. */
function verificationRowsOf(raw: unknown): readonly ClaimVerificationRow[] {
  // The legacy optional ledger treats undefined as absence. The NEW evidence
  // carrier has no such exception: its own present-only reader stays strict.
  const rows = ownConfigArray(raw === undefined ? [] : raw, Number.MAX_SAFE_INTEGER);
  const observations: ClaimVerificationRow[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row))
      throw new TypeError('Invalid findings verification ledger.');
    const kind = Object.getOwnPropertyDescriptor(row, 'kind');
    if (kind === undefined || !('value' in kind))
      throw new TypeError('Invalid findings verification row kind.');
    if (kind.value === 'claim-verification') observations.push(readClaimVerificationRow(row));
  }
  return observations;
}

/** Read a present carrier beside its ledger; the checkpoint owner authenticates origin. */
export function readVerificationCheckpoint(
  raw: unknown,
  ledger: readonly unknown[],
): ClaimVerificationState {
  const admitted = readVerificationState(raw, 0);
  let largestClaimOrdinal = 0;
  const seen = new Set<number>();
  // Reuse the dense own-data array owner, not the saved value's iterator.
  // No new ledger length cap: older ledger rows retain their existing budget.
  for (const observation of verificationRowsOf(ledger)) {
    const identity = readClaimIdentity(observation.claimId);
    if (
      identity.namespace !== admitted.evidence.namespace ||
      !admitted.evidence.runIds.includes(identity.runId) ||
      seen.has(identity.ordinal)
    )
      throw new TypeError('Invalid findings verification claim lineage.');
    seen.add(identity.ordinal);
    largestClaimOrdinal = Math.max(largestClaimOrdinal, identity.ordinal);
    if (observation.outcome !== 'unverified') {
      const resolved = observation.resolved;
      const result = readResultIdentity(resolved.resultId);
      if (
        result.namespace !== admitted.evidence.namespace ||
        !admitted.evidence.runIds.includes(result.runId) ||
        result.ordinal >= admitted.nextResultOrdinal
      )
        throw new TypeError('Invalid findings verification result lineage.');
      const receipt = admitted.evidence.results.find((item) => item.id === resolved.resultId);
      const facts = receipt?.facts?.filter(
        (fact) =>
          fact.entity === resolved.evidence.subject.id &&
          fact.field === resolved.evidence.predicate,
      );
      if (
        receipt === undefined ||
        receipt.unavailable !== undefined ||
        canonicalJson(receipt.scope) !== canonicalJson(resolved.scope) ||
        canonicalJson(receipt.coverage) !== canonicalJson(resolved.coverage) ||
        canonicalJson(receipt.period) !== canonicalJson(resolved.period) ||
        facts?.length !== 1 ||
        canonicalJson(facts[0].value) !== canonicalJson(resolved.evidence.value)
      )
        throw new TypeError('Recorded comparison does not name its retained receipt.');
    }
  }
  return readVerificationState(admitted, largestClaimOrdinal);
}

/**
 * Shared by conversation-history and full pause boundaries. Presence is strict:
 * undefined, inherited fields and accessors are not absence or live evidence.
 */
export function verificationCheckpointOf(container: unknown): ClaimVerificationState | undefined {
  if (container === null || typeof container !== 'object' || Array.isArray(container))
    throw new TypeError('Invalid findings verification checkpoint container.');
  const descriptor = Object.getOwnPropertyDescriptor(container, 'claimVerification');
  if (descriptor === undefined) {
    if ('claimVerification' in container)
      throw new TypeError('Inherited findings verification state is not a checkpoint.');
    return undefined;
  }
  if (!('value' in descriptor))
    throw new TypeError('Findings verification state must be stored data.');
  const source = ownData(container);
  const ledger = ownConfigArray(
    source.findingsLedger === undefined ? [] : source.findingsLedger,
    Number.MAX_SAFE_INTEGER,
  );
  return readVerificationCheckpoint(descriptor.value, ledger);
}

/** Never silently discard a previously opted-in verifier on newest-version resume. */
export function requireVerificationOnResume(
  container: unknown,
  enabled: boolean,
): ClaimVerificationState | undefined {
  const state = verificationCheckpointOf(container);
  if (state === undefined && container !== null && typeof container === 'object') {
    const ledgerDescriptor = Object.getOwnPropertyDescriptor(container, 'findingsLedger');
    if (ledgerDescriptor === undefined && 'findingsLedger' in container)
      throw new TypeError('Findings verification ledger must be own stored data.');
    if (ledgerDescriptor !== undefined && !('value' in ledgerDescriptor))
      throw new TypeError('Findings verification ledger must be stored data.');
    if (verificationRowsOf(ledgerDescriptor?.value).length > 0)
      throw new TypeError(
        'This saved run has findings verification observations but no retained evidence ' +
          'carrier. It is readable history, not a resumable verification checkpoint.',
      );
  }
  if (state !== undefined && !enabled)
    throw new TypeError(
      'This saved run carries findings verification evidence. Continue it with findings ' +
        'verification enabled; disabling it would silently discard saved checks.',
    );
  return state;
}
