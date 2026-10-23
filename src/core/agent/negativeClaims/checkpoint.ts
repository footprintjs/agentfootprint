/** Private operational carrier admission. The host authenticates checkpoint
 * storage; structural validation never turns caller-supplied JSON into proof. */
import { copyJson, ownData } from '../../../lib/boundedJson.js';
import { readResultIdentity } from '../../../integrity/claim-binding/capture.js';
import {
  readVerificationState,
  type ClaimVerificationState,
} from '../findings/verificationState.js';
import type { NegativeRuntimeState } from './capture.js';

export interface NegativeCheckpoint {
  readonly negativeClaimState: NegativeRuntimeState;
  readonly resultIdentities?: ClaimVerificationState;
}
export function negativeCheckpointOf(container: unknown): NegativeCheckpoint | undefined {
  const data = ownData(container);
  if (!Object.hasOwn(data, 'negativeClaimState')) return undefined;
  const raw = copyJson(data.negativeClaimState, 2_000_000, false) as NegativeRuntimeState;
  if (
    !raw ||
    raw.version !== 1 ||
    !Number.isSafeInteger(raw.turn) ||
    raw.turn < 1 ||
    typeof raw.complete !== 'boolean' ||
    !Array.isArray(raw.calls) ||
    raw.calls.length > 1000 ||
    !Array.isArray(raw.pending) ||
    !raw.tools ||
    typeof raw.tools !== 'object'
  )
    throw new TypeError('Invalid negative-claims checkpoint.');
  const identities =
    data.resultIdentities === undefined
      ? undefined
      : readVerificationState(data.resultIdentities, 0);
  const seen = new Set<string>();
  for (const call of raw.calls) {
    const id = readResultIdentity(call.resultId);
    if (
      identities === undefined ||
      id.namespace !== identities.evidence.namespace ||
      !identities.evidence.runIds.includes(id.runId) ||
      id.ordinal >= identities.nextResultOrdinal ||
      seen.has(call.resultId) ||
      !Number.isSafeInteger(call.turn) ||
      call.turn < 1 ||
      call.turn > raw.turn ||
      !Number.isSafeInteger(call.batch) ||
      typeof call.dispatched !== 'boolean' ||
      typeof call.trustedContext !== 'boolean' ||
      !['ok', 'error', 'not-run'].includes(call.outcome) ||
      typeof call.toolName !== 'string' ||
      call.arguments === null ||
      typeof call.arguments !== 'object'
    )
      throw new TypeError('Invalid negative-claims attempt lineage.');
    if (
      call.row !== undefined &&
      (call.row.resultId !== call.resultId ||
        call.row.handle !== `r${id.ordinal}` ||
        call.row.toolName !== call.toolName ||
        !Array.isArray(call.row.checked) ||
        !Array.isArray(call.row.gaps))
    )
      throw new TypeError('Invalid negative-claims coverage binding.');
    seen.add(call.resultId);
  }
  if (
    raw.pending.some((id) => typeof id !== 'string' || !seen.has(id)) ||
    new Set(raw.pending).size !== raw.pending.length
  )
    throw new TypeError('Invalid pending negative-claims attempts.');
  if (raw.pausedResultId !== undefined && !raw.pending.includes(raw.pausedResultId))
    throw new TypeError('Invalid paused negative-claims attempt.');
  if (
    !Array.isArray(raw.overclaims) ||
    raw.overclaims.length > 1000 ||
    raw.overclaims.some(
      (row) =>
        !row ||
        typeof row.tool !== 'string' ||
        row.code !== 'refusal-asserts-absence' ||
        !Number.isSafeInteger(row.turn) ||
        row.turn < 1 ||
        row.turn > raw.turn,
    )
  )
    throw new TypeError('Invalid negative-claims declaration diagnostics.');
  return {
    negativeClaimState: raw,
    ...(identities === undefined ? {} : { resultIdentities: identities }),
  };
}
