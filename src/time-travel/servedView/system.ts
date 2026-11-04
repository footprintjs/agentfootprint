import type { InjectionRecord } from '../../recorders/core/types.js';
import type { findingsLedgerPiece } from '../../core/agent/findings/serve.js';
import type { ontologyPiece } from '../../ontology/serve.js';
import { contributingPieces } from '../../core/agent/composeRequest.js';
import { evidenceRecoveryPiece } from '../../core/agent/evidence/recovery.js';
import type { EpochLocation } from '../epochs.js';
import type { ServedPiece } from '../servedView.js';
import { readAtCall } from './recordReads.js';

type RecoveryPiece = ReturnType<typeof evidenceRecoveryPiece>;
type OntologyPiece = ReturnType<typeof ontologyPiece>;
type FindingsPiece = ReturnType<typeof findingsLedgerPiece>;
type ComposedPiece =
  | InjectionRecord
  | Exclude<RecoveryPiece | OntologyPiece | FindingsPiece, undefined>;

/** Read the initial system pieces before the conversation and findings. */
export function systemInputs(
  location: EpochLocation,
  served: boolean,
): readonly [injections: InjectionRecord[], iteration: number, recovery: RecoveryPiece] {
  // ── the system prompt ──────────────────────────────────────────────────
  // The pieces are committed; the joined string never is. Same function the
  // stage used, over the records as the stage read them.
  const injections = (readAtCall(location, 'systemPromptInjections', served) ??
    []) as InjectionRecord[];
  const iteration = readAtCall(location, 'iteration', served) as number;
  const recovery = evidenceRecoveryPiece(
    readAtCall(location, 'evidenceRecovery', served) as Parameters<typeof evidenceRecoveryPiece>[0],
    readAtCall(location, 'evidenceRecoveryUsed', served) as boolean | undefined,
    iteration,
  );
  return [injections, iteration, recovery];
}

/** Project the ordered system pieces; text is joined only at final assembly. */
export function systemPieces(
  injections: InjectionRecord[],
  recovery: RecoveryPiece,
  ontology: OntologyPiece | undefined,
  findings: FindingsPiece,
): readonly [composedPieces: ComposedPiece[], pieces: ServedPiece[]] {
  // ── the system prompt, joined ──────────────────────────────────────────
  // Injections, then the recovery piece, then the ontology piece, then the
  // findings piece — the fixed order the stage joins in. Every request-only
  // piece is joined, never committed as an injection.
  const composedPieces =
    recovery === undefined && ontology === undefined && findings === undefined
      ? injections
      : [
          ...injections,
          ...(recovery === undefined ? [] : [recovery]),
          ...(ontology === undefined ? [] : [ontology]),
          ...(findings === undefined ? [] : [findings]),
        ];
  const pieces: ServedPiece[] = contributingPieces(composedPieces).map((record) => ({
    text: record.rawContent,
    slot: record.slot,
    source: record.source,
  }));
  return [composedPieces, pieces];
}
