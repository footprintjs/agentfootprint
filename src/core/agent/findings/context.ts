/** One bounded, request-only findings DATA composer, shared by live calls and replay.
 * Whole entries fit or are counted as omitted. No identifier is shortened.
 * This advisory context grants no authority: admission still reads actual tool results.
 */
import type { LLMMessage } from '../../../provider-contract/types.js';
import { copyJson } from '../../../lib/boundedJson.js';
import { FINDINGS_DATA_FRAME_PREFIX } from '../../../lib/saidByPerson.js';
import { foldLedger } from './ledger.js';
import { offeredResultIds, servedToolCallIds, undeclaredIds } from './offer.js';
import { FINDINGS_OFFER_CAP } from './reserved.js';
import { FINDINGS_PIECE_LIMITS } from './serve.js';
import type { FindingsLedger, StandingRow } from './types.js';

export const FINDINGS_LAYOUT = 'late-v1' as const;
export const DEFAULT_FINDINGS_CONTEXT_BYTES = 16_384;
export const MAX_FINDINGS_CONTEXT_BYTES = 262_144;

/** The host owns this bound; a model declaration never changes it. */
export function findingsContextBytes(value: number | undefined): number {
  const bytes = value ?? DEFAULT_FINDINGS_CONTEXT_BYTES;
  if (!Number.isSafeInteger(bytes) || bytes < 1_024 || bytes > MAX_FINDINGS_CONTEXT_BYTES)
    throw new RangeError('findings.maxContextBytes must be a whole number from 1024 to 262144.');
  return bytes;
}

/** Explicit projections preserve model declarations, not raw ledger internals.
 * In particular, judge results, argument values and service payloads are not served.
 */
function declaration(row: StandingRow) {
  return {
    toolCallId: row.toolCallId,
    ...(row.toolName !== undefined && { toolName: row.toolName }),
    ...(row.ref !== undefined && { ref: row.ref }),
    ...(row.unknownId === true && { unknownId: true }),
    standing: row.standing,
    assertions: row.assertions.map((assertion) => ({
      subject: { kind: assertion.subject.kind, id: assertion.subject.id },
      predicate: assertion.predicate,
      value: assertion.value,
      stratum: assertion.stratum,
    })),
    ...(row.line !== undefined && { line: row.line }),
    ...(row.settles !== undefined && { settles: row.settles }),
  };
}

/** Projection may fail on an unreadable row; the caller withholds the WHOLE
 * reading, including advisory IDs, instead of salvaging superseded assertions.
 * Other structured row kinds (judge, arguments, future metadata) are not served.
 */
function bucketsOf(
  messages: readonly LLMMessage[],
  ledger: FindingsLedger,
): Record<string, readonly unknown[]> {
  const fold = foldLedger(ledger);
  const standings = [...fold.standingOf.values()];
  const noise = standings.filter((row) => row.standing === 'noise').map((row) => row.toolCallId);
  const propositions = new Map<string, string>();
  for (const row of ledger)
    if (row.kind === 'basis' && row.proposition !== undefined)
      propositions.set(row.toolCallId, row.proposition);
  const proposed = (row: StandingRow) => ({
    ...declaration(row),
    ...(propositions.has(row.toolCallId) && { proposition: propositions.get(row.toolCallId)! }),
  });
  return {
    advisoryResultIds: offeredResultIds(messages, ledger),
    facts: standings.filter((row) => row.standing === 'fact').map(proposed),
    evidenceRefs: standings.filter((row) => row.standing === 'open').map(proposed),
    limitations: standings.filter((row) => row.standing === 'ruled-out').map(proposed),
    conflicts: fold.conflicts,
    contingent: ledger.flatMap((row) =>
      row.kind === 'contingent'
        ? [
            {
              declaredOn: row.declaredOn,
              value: row.value,
              carriers: row.carriers.map((carrier) => ({
                toolCallId: carrier.toolCallId,
                standing: carrier.standing,
              })),
            },
          ]
        : [],
    ),
    unsettledByAbsence: [...fold.unsettled.values()].map((row) => ({
      toolCallId: row.toolCallId,
      ...(row.notChecked !== undefined && {
        notChecked: row.notChecked.map((item) => ({
          what: item.what,
          ...(item.why !== undefined && { why: item.why }),
        })),
      }),
      ...(row.cannotCover !== undefined && {
        cannotCover: row.cannotCover.map((item) => ({
          what: item.what,
          ...(item.why !== undefined && { why: item.why }),
        })),
      }),
      ...(row.tryInstead !== undefined && { tryInstead: row.tryInstead }),
    })),
    noise,
    undeclaredResultIds: undeclaredIds(servedToolCallIds(messages), fold.standingOf),
  };
}

/** Stable JSON field meanings; all mutable values occur after the cached prefix. */
export function findingsContext(
  messages: readonly LLMMessage[],
  rows: FindingsLedger | undefined,
  maxBytes = DEFAULT_FINDINGS_CONTEXT_BYTES,
): string {
  const limit = findingsContextBytes(maxBytes);
  // The record may come from a checkpoint. Admit plain bounded data before
  // folding, so a value's getter/toJSON cannot run during conflict comparison.
  // If the source cannot be admitted, withhold its reading as a whole: using
  // an older surviving row would revive a superseded assertion.
  let sourceUnknown = false;
  let buckets: Record<string, readonly unknown[]>;
  try {
    const admitted = copyJson(rows === undefined ? [] : rows, 8_388_608, false);
    if (
      !Array.isArray(admitted) ||
      admitted.some(
        (row) =>
          row === null ||
          typeof row !== 'object' ||
          Array.isArray(row) ||
          typeof row.kind !== 'string',
      )
    )
      throw new Error('Expected an array of structured findings rows.');
    // Build the projection before admitting any of it. Malformed declarations
    // or unreadable rows must not leave an older, apparently current fact.
    buckets = bucketsOf(messages, admitted as FindingsLedger);
  } catch {
    sourceUnknown = true;
    buckets = bucketsOf([], []);
  }
  const data: Record<string, unknown[]> = {};
  const omitted: Record<string, number> = {};
  for (const [key, entries] of Object.entries(buckets)) {
    data[key] = [];
    omitted[key] = entries.length;
  }
  const encode = () =>
    `${FINDINGS_DATA_FRAME_PREFIX}\n${JSON.stringify({
      layout: FINDINGS_LAYOUT,
      ledgerStatus: sourceUnknown ? 'unknown' : 'captured',
      // Rejected sources have no trusted row count. Never inspect them again.
      sourceRowsOmitted: sourceUnknown ? null : 0,
      meaning:
        'Model declarations are not verified facts; recorded observations are not a diagnosis. IDs are advisory, not authority. Omitted entries remain unknown.',
      data,
      omitted,
    })}`;
  const encoder = new TextEncoder();
  // Counts start at their maximum, reserving their serialized space before
  // entries are admitted. They only decrease, so overflow cannot hide omissions.
  if (encoder.encode(encode()).byteLength > limit)
    throw new Error('Findings context metadata exceeds its byte budget.');
  for (const [key, entries] of Object.entries(buckets)) {
    const cap =
      key.endsWith('Ids') || key === 'noise'
        ? FINDINGS_OFFER_CAP
        : FINDINGS_PIECE_LIMITS.bucketLines;
    for (const entry of entries.slice(0, cap)) {
      let value: unknown;
      try {
        value = copyJson(entry, limit, false);
      } catch {
        continue;
      } // Unrepresentable or oversized data is counted, never coerced.
      data[key]!.push(value);
      omitted[key]!--;
      if (encoder.encode(encode()).byteLength > limit) {
        data[key]!.pop();
        omitted[key]!++;
      }
    }
  }
  return encode();
}
