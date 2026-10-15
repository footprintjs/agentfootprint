/**
 * Internal dispatch/return/delivery receipt boundary, not mounted in the Agent.
 * The eventual runtime adapter reserves a namespace/run/ordinal before await,
 * captures at actual execute, then finalizes against the authorized served value.
 */
import { decodePresentIdentityField, encodeIdentityField } from '../../memory/identity/encode.js';
import { copyJson } from '../../lib/boundedJson.js';
import { canonicalJson } from '../../lib/canonicalJson.js';
import {
  readSemantics,
  semanticsForModel,
  coverageOfSemantics,
  periodOfSemantics,
} from '../../semantics/envelope.js';
import { claimRowsOf } from '../unsupported-claim/ledger.js';
import { BINDING_LIMITS, boundedText, executedScope, scopeDeclarationOf } from './scope.js';
import type {
  CapturedDispatch,
  EvidenceSnapshot,
  ResultEvidence,
  ResultIdentity,
  ReturnedEvidence,
  ScopeDeclaration,
} from './types.js';

export function resultIdentityOf(identity: ResultIdentity): string {
  if (
    !boundedText(identity.namespace) ||
    !boundedText(identity.runId) ||
    !Number.isSafeInteger(identity.ordinal) ||
    identity.ordinal < 1
  )
    throw new Error('Invalid runtime result identity.');
  return `claim-result/${encodeIdentityField(identity.namespace)}/${encodeIdentityField(
    identity.runId,
  )}/${identity.ordinal}`;
}

/** Decode only canonical runtime result occurrences; no lookup or authority is inferred. */
export function readResultIdentity(raw: unknown): ResultIdentity {
  if (typeof raw !== 'string' || raw.length > BINDING_LIMITS.resultIdText)
    throw new TypeError('Invalid saved result identity.');
  const parts = raw.split('/');
  if (parts.length !== 4 || parts[0] !== 'claim-result')
    throw new TypeError('Invalid saved result identity.');
  const identity = Object.freeze({
    namespace: decodePresentIdentityField(parts[1]),
    runId: decodePresentIdentityField(parts[2]),
    ordinal: Number(parts[3]),
  });
  if (resultIdentityOf(identity) !== raw)
    throw new TypeError('Noncanonical saved result identity.');
  return identity;
}

/** Capture selected scope now; a later mutation of args cannot change it. */
export function captureDispatch(
  identity: ResultIdentity,
  tool: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
  executedArgs: unknown,
  declaration: ScopeDeclaration,
): CapturedDispatch {
  declaration = scopeDeclarationOf(declaration);
  const id = resultIdentityOf(identity);
  if (
    !boundedText(tool.toolName) ||
    !boundedText(tool.toolCallId) ||
    !Number.isSafeInteger(tool.iteration) ||
    tool.iteration < 0
  )
    throw new Error('Invalid tool identity.');
  const common = {
    identity: { ...identity },
    id,
    toolName: tool.toolName,
    toolCallId: tool.toolCallId,
    iteration: tool.iteration,
    scopeDeclaration: { id: declaration.id, version: declaration.version },
    ...(declaration.periodDimension !== undefined && {
      periodDimension: declaration.periodDimension,
    }),
  };
  try {
    return copyJson(
      { ...common, scope: executedScope(executedArgs, declaration) },
      BINDING_LIMITS.scopeBytes * 2,
      true,
    ) as CapturedDispatch;
  } catch {
    return copyJson(
      { ...common, unavailable: 'missing-scope' },
      BINDING_LIMITS.scopeBytes * 2,
      true,
    ) as CapturedDispatch;
  }
}

/** Preserve the returned reading before any async result rule can mutate it. */
export function captureReturnedEvidence(
  dispatch: CapturedDispatch,
  original: unknown,
): ReturnedEvidence {
  try {
    const semantics = readSemantics(copyJson(original, BINDING_LIMITS.resultBytes, true));
    if (semantics === undefined) throw new Error('No recognized evidence.');
    return Object.freeze({ resultId: dispatch.id, semantics });
  } catch {
    return Object.freeze({ resultId: dispatch.id, unavailable: 'invalid-evidence' });
  }
}

/**
 * returned is the return-time copy from that invocation. served is
 * the final model-facing payload AFTER all governance, placement and caps.
 * Visibility is a trusted adapter decision; equality alone grants no access.
 * Rewrites need a future explicit association, and are unavailable here.
 */
export function finalizeEvidence(
  dispatch: CapturedDispatch,
  returned: ReturnedEvidence,
  served: unknown,
  access: {
    readonly completed: boolean;
    readonly resultVisible: boolean;
    readonly scopeVisible: boolean;
  },
): ResultEvidence {
  const unavailable = (reason: ResultEvidence['unavailable']): ResultEvidence =>
    copyJson(
      {
        identity: dispatch.identity,
        id: dispatch.id,
        toolName: dispatch.toolName,
        toolCallId: dispatch.toolCallId,
        iteration: dispatch.iteration,
        scopeDeclaration: dispatch.scopeDeclaration,
        unavailable: reason,
      },
      BINDING_LIMITS.scopeBytes * 2,
      true,
    ) as ResultEvidence;
  if (dispatch.id !== resultIdentityOf(dispatch.identity)) return unavailable('invalid-evidence');
  if (access.completed !== true) return unavailable('incomplete-result');
  if (access.resultVisible !== true || access.scopeVisible !== true)
    return unavailable('withheld-evidence');
  if (dispatch.unavailable !== undefined) return unavailable(dispatch.unavailable);
  if (returned.resultId !== dispatch.id) return unavailable('unassociated-result');
  if (returned.unavailable !== undefined) return unavailable(returned.unavailable);
  try {
    const raw = copyJson(returned.semantics, BINDING_LIMITS.resultBytes, true);
    const semantics = readSemantics(raw);
    if (semantics === undefined) return unavailable('invalid-evidence');
    const model =
      typeof served === 'string'
        ? JSON.parse(served.length <= BINDING_LIMITS.resultBytes ? served : '')
        : served;
    const allowed = copyJson(model, BINDING_LIMITS.resultBytes, true);
    const projection = copyJson(semanticsForModel(semantics), BINDING_LIMITS.resultBytes, true);
    if (canonicalJson(allowed) !== canonicalJson(projection))
      return unavailable('unassociated-result');
    const period = periodOfSemantics(semantics);
    return copyJson(
      {
        ...dispatch,
        facts: claimRowsOf(semantics, {
          toolName: dispatch.toolName,
          toolCallId: dispatch.toolCallId,
          iteration: dispatch.iteration,
        }),
        ...((semantics.coverage !== undefined || period !== undefined) && {
          coverage: coverageOfSemantics(semantics),
        }),
        ...(period !== undefined && { period }),
      },
      BINDING_LIMITS.resultBytes,
      true,
    ) as ResultEvidence;
  } catch {
    return unavailable('invalid-evidence');
  }
}

/** Freeze the caller's completed evidence universe at the declaration moment. */
export function evidenceSnapshot(
  namespace: string,
  verifiedRunIds: readonly string[],
  results: readonly ResultEvidence[],
): EvidenceSnapshot {
  if (
    !boundedText(namespace) ||
    verifiedRunIds.length > BINDING_LIMITS.results ||
    !verifiedRunIds.every(boundedText) ||
    new Set(verifiedRunIds).size !== verifiedRunIds.length ||
    results.length > BINDING_LIMITS.results
  )
    throw new Error('Invalid evidence snapshot boundary.');
  return copyJson(
    { version: 1, namespace, runIds: verifiedRunIds, results },
    BINDING_LIMITS.snapshotBytes,
    true,
  ) as EvidenceSnapshot;
}
