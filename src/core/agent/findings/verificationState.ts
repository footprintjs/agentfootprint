/**
 * Private, immutable evidence carrier for the explicit findings verifier.
 * Role: reservation and bounded retention; no schema, events or Agent wiring.
 * The checkpoint owner authenticates provenance and supplies the ledger's
 * largest claim ordinal. Shape validation alone never authorizes a record.
 */
import {
  appendEvidenceSnapshot,
  readEvidenceSnapshot,
} from '../../../integrity/claim-binding/admit.js';
import { resultIdentityOf } from '../../../integrity/claim-binding/capture.js';
import { BINDING_LIMITS, boundedText } from '../../../integrity/claim-binding/scope.js';
import type {
  EvidenceSnapshot,
  ResultEvidence,
  ResultIdentity,
} from '../../../integrity/claim-binding/types.js';
import { ownData } from '../../../lib/boundedJson.js';
import { claimIdentityOf } from './verificationRow.js';

export interface ClaimVerificationState {
  readonly version: 1;
  readonly evidence: EvidenceSnapshot;
  readonly nextResultOrdinal: number;
  readonly nextClaimOrdinal: number;
  /** Sticky refusal: older receipts remain; later evidence is not substituted. */
  readonly limited?: true;
}

const positiveOrdinal = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/**
 * Read only after the checkpoint's owner/namespace authority is established.
 * The caller MUST derive largestClaimOrdinal from its validated claim rows;
 * this carrier does not contain those rows and cannot infer their maximum.
 * Stage commits clone changed state. At entry, admit the tracked raw value
 * and publish this detached carrier before the batch; subsequent raw reads
 * can reuse its immutable evidence. A live scope proxy is not that identity.
 */
export function readVerificationState(
  raw: unknown,
  largestClaimOrdinal: number,
): ClaimVerificationState {
  const source = ownData(raw, [
    'version',
    'evidence',
    'nextResultOrdinal',
    'nextClaimOrdinal',
    'limited',
  ]);
  if (
    source.version !== 1 ||
    !positiveOrdinal(source.nextResultOrdinal) ||
    !positiveOrdinal(source.nextClaimOrdinal) ||
    !Number.isSafeInteger(largestClaimOrdinal) ||
    largestClaimOrdinal < 0 ||
    source.nextClaimOrdinal <= largestClaimOrdinal ||
    (Object.hasOwn(source, 'limited') && source.limited !== true)
  )
    throw new Error('Invalid findings verification carrier.');
  const evidence = readEvidenceSnapshot(source.evidence);
  if (evidence.runIds.length === 0)
    throw new Error('Verification carrier requires its recorded run lineage.');
  const ordinals = new Set<number>();
  for (const result of evidence.results) {
    if (
      result.identity.namespace !== evidence.namespace ||
      !evidence.runIds.includes(result.identity.runId) ||
      result.identity.ordinal >= source.nextResultOrdinal ||
      ordinals.has(result.identity.ordinal)
    )
      throw new Error('Invalid verification receipt lineage or ordinal.');
    ordinals.add(result.identity.ordinal);
  }
  return Object.freeze({
    version: 1,
    evidence,
    nextResultOrdinal: source.nextResultOrdinal,
    nextClaimOrdinal: source.nextClaimOrdinal,
    ...(source.limited === true && { limited: true as const }),
  });
}

/** Called only when opted in. No randomness is consumed at module load. */
export function createVerificationState(
  runId: string,
  namespaceSource: () => string = () => globalThis.crypto.randomUUID(),
): ClaimVerificationState {
  const namespace = namespaceSource();
  if (!boundedText(runId) || !boundedText(namespace))
    throw new Error('Invalid verification recording identity.');
  return readVerificationState(
    {
      version: 1,
      evidence: { version: 1, namespace, runIds: [runId], results: [] },
      nextResultOrdinal: 1,
      nextClaimOrdinal: 1,
    },
    0,
  );
}

const limited = (state: ClaimVerificationState): ClaimVerificationState =>
  state.limited === true ? state : Object.freeze({ ...state, limited: true });

/** A resume keeps its namespace/counters, including when a process reuses runId. */
export function continueVerificationState(
  state: ClaimVerificationState,
  runId: string,
): ClaimVerificationState {
  if (!boundedText(runId)) throw new Error('Invalid verification run identity.');
  if (state.evidence.runIds.includes(runId)) return state;
  if (state.evidence.runIds.length >= BINDING_LIMITS.results)
    throw new Error('Verification run lineage capacity exhausted.');
  try {
    const evidence = readEvidenceSnapshot({
      ...state.evidence,
      runIds: [...state.evidence.runIds, runId],
    });
    return Object.freeze({ ...state, evidence });
  } catch {
    // Identity cannot be reserved for an unrecorded run. The input is an
    // admitted carrier; adding one bounded run can exceed only its budget.
    // Refuse this continuation rather than evicting old lineage or evidence.
    throw new Error('Verification run lineage capacity exhausted.');
  }
}

/** Publish the returned state before awaiting execution, even if it later fails. */
export function reserveResultIdentity(
  state: ClaimVerificationState,
  runId: string,
): {
  readonly state: ClaimVerificationState;
  readonly identity: ResultIdentity;
  readonly id: string;
} {
  state = continueVerificationState(state, runId);
  const ordinal = state.nextResultOrdinal;
  if (!positiveOrdinal(ordinal) || ordinal === Number.MAX_SAFE_INTEGER)
    throw new Error('Verification result identity capacity exhausted.');
  const identity = Object.freeze({ namespace: state.evidence.namespace, runId, ordinal });
  return Object.freeze({
    state: Object.freeze({ ...state, nextResultOrdinal: ordinal + 1 }),
    identity,
    id: resultIdentityOf(identity),
  });
}

/** One occurrence, not a text key. The caller publishes state before evaluation. */
export function reserveClaimIdentity(
  state: ClaimVerificationState,
  runId: string,
): { readonly state: ClaimVerificationState; readonly ordinal: number; readonly id: string } {
  state = continueVerificationState(state, runId);
  const ordinal = state.nextClaimOrdinal;
  if (!positiveOrdinal(ordinal) || ordinal === Number.MAX_SAFE_INTEGER)
    throw new Error('Verification claim identity capacity exhausted.');
  return Object.freeze({
    state: Object.freeze({ ...state, nextClaimOrdinal: ordinal + 1 }),
    ordinal,
    id: claimIdentityOf({ namespace: state.evidence.namespace, runId, ordinal }),
  });
}

/**
 * Retain only a finalized, previously reserved receipt. Capacity refusal is
 * sticky and never replaces an earlier result; the writer reports the limit.
 */
export function retainVerificationEvidence(
  state: ClaimVerificationState,
  receipt: ResultEvidence,
): ClaimVerificationState {
  if (state.limited === true) return state;
  const singleton = readEvidenceSnapshot({ ...state.evidence, results: [receipt] });
  const admitted = singleton.results[0];
  if (
    admitted.identity.namespace !== state.evidence.namespace ||
    !state.evidence.runIds.includes(admitted.identity.runId) ||
    admitted.identity.ordinal >= state.nextResultOrdinal ||
    state.evidence.results.some((prior) => prior.identity.ordinal === admitted.identity.ordinal)
  )
    throw new Error('Verification receipt was not uniquely reserved in this recording.');
  if (state.evidence.results.length >= BINDING_LIMITS.results) return limited(state);
  try {
    const evidence = appendEvidenceSnapshot(state.evidence, singleton);
    return Object.freeze({ ...state, evidence });
  } catch {
    // Both the carrier and individual receipt were already admitted. Their
    // combined bytes exceed the snapshot cap; preserve the earlier snapshot.
    return limited(state);
  }
}
