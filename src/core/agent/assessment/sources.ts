/**
 * assessment/sources — what each reason rests on
 * (`AnswerAssessment.reasons[].source`): specific calls, the answer itself, or
 * the run as a whole.
 *
 * Pattern: a projection inside the one Fold (`assess.ts` · `assessAnswer`).
 *          The KIND is declared per reason (`reasons.ts` · `REASONS`); for a
 *          `calls` reason this module reads the calls off the very rows the
 *          reason's witnesses point at — a history result carries its call id,
 *          a committed row names its call — and the call's tool name off the
 *          same row, or off the run's `history` for a row that names only an id.
 *          It reads the committed record only, and adds nothing to it.
 * Role:    core/ layer, pure. Asked once per fired reason by the fold; every
 *          reader takes the source from the fold — the answer layer's line
 *          (`compose.ts` · `standingLineOf`) and the answer account's "How
 *          sure" counts (`answer-account/facts/howSure.ts`) — and never
 *          re-derives it.
 * Emits:   N/A.
 *
 * ## Names and ids only
 *
 * A source holds call ids and registered tool names, never a value, an
 * argument or a result: the rows it reads hold more, and it copies two strings
 * out of each.
 *
 * ## Which calls a row names
 *
 * - a tool result in `history` — its own call;
 * - a coverage, argument, period or middleware row — its own call (the row's
 *   `toolCallId`, with the row's `toolName`);
 * - a conflict row — the calls of the readings that disagree (`witnesses`);
 * - a contingent row — the results the value came from (`carriers`), and an
 *   argument row behind `value-contingent` — the result it names (`result`):
 *   the reason is that a value came from results the model itself set aside;
 * - an answer check that names its tool and not its call
 *   (`declaration-overclaimed`, the report row's `tools` — kept by the one
 *   projection onto the report, `negativeClaims/delivery.ts` ·
 *   `reportWithNegatives`) — every call of that tool this turn: it may
 *   over-report, it never hides (the fold's rule for "rests on"). An
 *   integrity-finding row names its tools the same way.
 *
 * A row that names no call, a call whose tool's name the record does not
 * hold, and every entry of a list (a conflict's readings, a contingent value's
 * carriers, an answer check's tools) that names no call — beside the entries
 * that do — is COUNTED in `unnamed`, never dropped and never guessed. A
 * result is identified by its place in history, even when a provider id
 * recurs. A committed row may only be joined when it identifies a single
 * compatible occurrence. Unplaced evidence keeps its pointer independently
 * of the calls the record establishes.
 *
 * ## A list is read by index, never through its own code
 *
 * Every list on a row — a conflict's readings, a contingent value's carriers,
 * an answer check's tools, a request's `toolCalls` — is read through ONE
 * reader, `rowList` (`lib/boundedJson.ts` · `readOwnList`, the bounded-copy
 * convention as a reader): a plain array only, its own `length`, the own data
 * property at each index, at most `MAX_ROW_LIST_ENTRIES`. A record handed to
 * `assessAnswer` may be host-built, so a list can be sparse, carry its own
 * iterator or put a getter at an index: the iterator and the getter are never
 * called. A hole or a getter's entry names no call; the entries past the bound
 * are counted, never read; a value that is not a plain array is not trusted as
 * a list — one call the record cannot name. Each is counted in `unnamed`.
 */

import { readOwnList, type OwnList } from '../../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { recordedCallOutcome } from '../../../semantics/toolOutcome.js';
import {
  historyCallResolver,
  historyProposalForOccurrence,
  readHistoryCalls,
  uniqueHistoryProposal,
  unlandedCallKey,
  type HistoryCall,
} from '../recordedCalls.js';
import { resolveArgumentHistory, waitingArgumentIteration } from './argumentRows.js';
import { unfinishedCallStatus } from './recordValues.js';
import type { AssessmentPointer, AssessmentReason, AssessmentReasonSource } from './types.js';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** The most entries the fold reads off one list on a row; the rest are counted, never read. */
export const MAX_ROW_LIST_ENTRIES = 1_000;

/**
 * A list on a row, as the fold reads it — THE one reader, shared by the
 * projection here and the fold's placement (`assess.ts` · `conflictOfThisTurn`,
 * `callsNamedBy`): `readOwnList` at `MAX_ROW_LIST_ENTRIES`. `undefined` when
 * the value is not a plain array.
 */
export function rowList(value: unknown): OwnList | undefined {
  return readOwnList(value, MAX_ROW_LIST_ENTRIES);
}

/**
 * One call a witness row names: its id (when the row has one) and the tool
 * name the row holds. A reference with no id is ANONYMOUS — one call the record
 * cannot name, or `count` of them (the entries of a list past the bound).
 */
interface CallRef {
  readonly id?: string;
  readonly name?: string;
  readonly occurrenceKey?: string | null;
  readonly index?: number;
  readonly thisTurn?: true;
  readonly argumentRow?: true;
  readonly predispatch?: true;
  readonly unlandedKey?: string;
  readonly count?: number;
  readonly outcome?: NonNullable<ReturnType<typeof recordedCallOutcome>>;
  readonly reportedStatus?: NonNullable<ReturnType<typeof unfinishedCallStatus>>;
}

/** The entries of a list past the bound, as one counted anonymous reference — or none. */
const unreadRefs = (list: OwnList): CallRef[] => (list.unread > 0 ? [{ count: list.unread }] : []);

/** What the projection reads: the committed state, and this turn's results (for a tool-name join). */
export interface SourceRead {
  readonly state: Readonly<Record<string, unknown>>;
  readonly turnResults: readonly {
    readonly index: number;
    readonly toolCallId?: string;
    readonly toolName?: string;
  }[];
  readonly historyCalls?: readonly HistoryCall[];
  readonly turnBegins?: number;
  readonly declarationAddresses?: ReadonlyMap<number, number> | undefined;
}

const arrayEntry = (rows: unknown, index: number): unknown =>
  Array.isArray(rows) && Number.isSafeInteger(index) && index >= 0
    ? Object.getOwnPropertyDescriptor(rows, String(index))?.value
    : undefined;

/** The row an RFC 6901 pointer's first segment indexes, in an array-valued key. */
function rowAt(state: Readonly<Record<string, unknown>>, key: string, path: string): unknown {
  return arrayEntry(state[key], Number(path.split('/')[1]));
}

/**
 * One reference per entry of a list of `{ toolCallId }` entries, in order. An
 * entry that names no call is an ANONYMOUS reference — counted in `unnamed`,
 * never dropped: a conflict whose one reading names its call and whose other
 * does not still rests on both. A hole, a getter's entry and the entries past
 * the bound are such entries (`rowList`); a value that is not a plain array
 * gives no reference, which the caller counts as one call it cannot name.
 */
function refsIn(value: unknown): CallRef[] {
  const list = rowList(value);
  if (list === undefined) return [];
  const refs = list.entries.map((entry): CallRef => {
    if (!isRecord(entry)) return {};
    const id = str(Object.getOwnPropertyDescriptor(entry, 'toolCallId')?.value);
    const name = str(Object.getOwnPropertyDescriptor(entry, 'toolName')?.value);
    const occurrenceKey = readCallOccurrenceKey(entry);
    return id === undefined && occurrenceKey === undefined
      ? {}
      : {
          ...(id !== undefined && { id }),
          ...(name !== undefined && { name }),
          ...(occurrenceKey !== undefined && { occurrenceKey }),
        };
  });
  return [...refs, ...unreadRefs(list)];
}

/** The calls one committed row names, read for `reason`. */
function callsOfRow(reason: AssessmentReason, row: unknown, read: SourceRead): CallRef[] {
  if (!isRecord(row)) return [];
  if (row.kind === 'integrity-finding') return callsOfCheck(row, read);
  if (row.kind === 'conflict') return refsIn(row.witnesses);
  if (row.kind === 'contingent') return refsIn(row.carriers);
  if (reason === 'value-contingent' && row.kind === 'argument') {
    const result = str(row.result);
    return result === undefined ? [] : [{ id: result }];
  }
  const id = str(row.toolCallId);
  const name = str(row.toolName);
  const occurrenceKey = readCallOccurrenceKey(row);
  const waiting = row.kind === 'argument' ? waitingArgumentIteration(read.state) : undefined;
  return id === undefined && name === undefined && occurrenceKey === undefined
    ? []
    : [
        {
          ...(id !== undefined && { id }),
          ...(id !== undefined &&
            occurrenceKey === undefined && { unlandedKey: unlandedCallKey(row) }),
          ...(name !== undefined && { name }),
          ...(occurrenceKey !== undefined && { occurrenceKey }),
          thisTurn: true,
          ...(row.kind === 'argument' && { argumentRow: true }),
          ...(waiting !== undefined && row.iteration === waiting && { predispatch: true }),
        },
      ];
}

/**
 * An answer check that names the TOOLS it is about (`tools`) and no call —
 * every call of each named tool among this turn's results. A tool no call of
 * this turn ran, and an entry that is not a tool name (a hole or a getter's
 * entry included, `rowList`), is an ANONYMOUS reference each: counted, never
 * dropped beside the tools that matched — and so are the entries past the bound.
 */
function callsOfCheck(check: unknown, read: SourceRead): CallRef[] {
  const list = isRecord(check) ? rowList(check.tools) : undefined;
  if (list === undefined) return [];
  const tools = list.entries;
  const names = [...new Set(tools.flatMap((t) => (str(t) === undefined ? [] : [t as string])))];
  const malformed: CallRef[] = tools.filter((t) => str(t) === undefined).map(() => ({}));
  const matched = names.flatMap((name): CallRef[] => {
    const calls = read.turnResults.filter((r) => r.toolName === name);
    return calls.length === 0
      ? [{ name }]
      : calls.map((r) => ({
          index: r.index,
          ...(r.toolCallId !== undefined && { id: r.toolCallId }),
          name,
        }));
  });
  return [...matched, ...malformed, ...unreadRefs(list)];
}

/** The calls one witness names. */
function callsOfWitness(
  reason: AssessmentReason,
  w: AssessmentPointer,
  read: SourceRead,
  callAt: (index: number) => HistoryCall | undefined,
): CallRef[] {
  if (w.kind === 'history') {
    const call = callAt(w.index);
    if (call === undefined) return [];
    const outcome = reason === 'call-not-completed' ? recordedCallOutcome(call.message) : undefined;
    const reportedStatus =
      reason === 'work-not-finished' ? unfinishedCallStatus(call.message) : undefined;
    const id = str(call.providerId);
    const name =
      str(call.toolName) ??
      (outcome === undefined && reportedStatus === undefined
        ? str(call.proposal?.call.name)
        : undefined);
    return [
      {
        index: call.index,
        ...(id !== undefined && { id }),
        ...(name !== undefined && { name }),
        ...(outcome !== undefined && { outcome }),
        ...(reportedStatus !== undefined && { reportedStatus }),
      },
    ];
  }
  if (w.key === 'answerValidation') {
    // `/checks/<index>` — the check row the reason fired on.
    const [, list, at] = w.path.split('/');
    const report = read.state.answerValidation;
    const checks = isRecord(report) && list === 'checks' ? report.checks : undefined;
    return callsOfCheck(arrayEntry(checks, Number(at)), read);
  }
  const row = rowAt(read.state, w.key, w.path);
  const refs = callsOfRow(reason, row, read);
  const index =
    w.key === 'coverageDeclared' && isRecord(row) && readCallOccurrenceKey(row) === undefined
      ? read.declarationAddresses?.get(Number(w.path.split('/')[1]))
      : undefined;
  return index !== undefined ? refs.map((ref) => ({ ...ref, index })) : refs;
}

/**
 * What one fired reason rests on — its declared `kind`, and for `calls` the
 * calls its witnesses' rows name, each once, in witness order.
 *
 * @example
 * ```ts
 * reasonSourceOf('declared-absent', 'calls', [historyPointer], read);
 * // { kind: 'calls', calls: [{ toolCallId: 'c1', toolName: 'load_attachment' }] }
 * reasonSourceOf('stopped-early', 'run', [statePointer('stoppedEarly')], read);
 * // { kind: 'run' }
 * ```
 */
export function reasonSourceOf(
  reason: AssessmentReason,
  kind: AssessmentReasonSource['kind'],
  witness: readonly AssessmentPointer[],
  read: SourceRead,
): AssessmentReasonSource {
  if (kind !== 'calls') return { kind };
  const history: readonly unknown[] = Array.isArray(read.state.history) ? read.state.history : [];
  const occurrences = read.historyCalls ?? readHistoryCalls(history);
  const begins = read.turnBegins ?? -1;
  let byIndex: ReadonlyMap<number, HistoryCall> | undefined;
  const callAt = (index: number): HistoryCall | undefined =>
    (byIndex ??= new Map(occurrences.map((call) => [call.index, call]))).get(index);
  let whole: ReturnType<typeof historyCallResolver> | undefined;
  let current: ReturnType<typeof historyCallResolver> | undefined;
  let argument: ReturnType<typeof resolveArgumentHistory> | undefined;
  const currentCalls = () => occurrences.filter((call) => call.index > begins);
  const resolve = (ref: CallRef) => {
    if (ref.argumentRow) {
      return (argument ??= resolveArgumentHistory(read.state, currentCalls(), history, begins))(
        ref.id,
        ref.name,
        ref.occurrenceKey,
      );
    }
    return (
      ref.thisTurn && begins >= 0
        ? (current ??= historyCallResolver(currentCalls()))
        : (whole ??= historyCallResolver(occurrences))
    )(ref.id, ref.name, ref.occurrenceKey);
  };
  const calls: Extract<AssessmentReasonSource, { kind: 'calls' }>['calls'][number][] = [];
  const seen = new Set<number | string>();
  const unplaced: AssessmentPointer[] = [];
  let unnamed = 0;
  for (const w of witness) {
    const refs = callsOfWitness(reason, w, read, callAt);
    const declaration = w.kind === 'state' && w.key === 'coverageDeclared';
    if (declaration && refs.length === 0) {
      unplaced.push(w);
      continue;
    }
    if (refs.length === 0) unnamed += 1;
    for (const ref of refs) {
      const found =
        ref.index === undefined &&
        (ref.occurrenceKey !== undefined || ref.id !== undefined) &&
        (!ref.predispatch || ref.argumentRow)
          ? resolve(ref)
          : undefined;
      // The retained proposal can name an argument's call even when no
      // result is held. This establishes the call's identity only.
      const proposed =
        ref.argumentRow && typeof ref.occurrenceKey === 'string' && found?.kind === 'missing'
          ? historyProposalForOccurrence(history, ref.occurrenceKey)
          : undefined;
      const keyedProposal =
        proposed !== undefined && proposed.index > begins ? proposed : undefined;
      if (
        (ref.occurrenceKey !== undefined &&
          found?.kind !== 'matched' &&
          keyedProposal === undefined) ||
        (declaration && ref.index === undefined && found?.kind !== 'matched') ||
        (ref.thisTurn && found?.kind === 'ambiguous')
      ) {
        unplaced.push(w);
        continue;
      }
      if (found?.kind === 'ambiguous') {
        unnamed += 1;
        continue;
      }
      const call = !ref.predispatch && found?.kind === 'matched' ? found.call : undefined;
      const key =
        ref.index ??
        call?.index ??
        ref.occurrenceKey ??
        (ref.id === undefined
          ? undefined
          : ref.unlandedKey ?? unlandedCallKey({ toolCallId: ref.id }));
      if (key !== undefined) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const proposal =
        !ref.predispatch &&
        ref.occurrenceKey === undefined &&
        found?.kind === 'missing' &&
        ref.id !== undefined &&
        ref.name === undefined
          ? uniqueHistoryProposal(history, ref.id)
          : undefined;
      const toolName =
        ref.name ??
        str(call?.toolName) ??
        str(call?.proposal?.call.name) ??
        str(keyedProposal?.call.name) ??
        (proposal !== undefined && (!ref.thisTurn || proposal.index > begins)
          ? str(proposal.call.name)
          : undefined);
      const toolCallId =
        ref.id ??
        (ref.occurrenceKey !== undefined ? str(call?.providerId) : undefined) ??
        str(keyedProposal?.call.id);
      if (toolCallId === undefined || toolName === undefined) {
        unnamed += ref.count ?? 1;
        continue;
      }
      calls.push({
        toolCallId,
        toolName,
        ...(ref.outcome !== undefined && { outcome: ref.outcome }),
        ...(ref.reportedStatus !== undefined && { reportedStatus: ref.reportedStatus }),
      });
    }
  }
  return {
    kind: 'calls',
    calls,
    ...(unnamed > 0 && { unnamed }),
    ...(unplaced.length > 0 && { unplaced }),
  };
}

/** Why an existing unplaced witness can no longer be assigned a result. */
export function unplacedEvidenceKind(
  reason: AssessmentReason,
  witness: AssessmentPointer,
  state: Readonly<Record<string, unknown>>,
  resolve: ReturnType<typeof historyCallResolver>,
): 'legacy' | 'result-unavailable' | 'call-unreadable' {
  if (witness.kind !== 'state') return 'legacy';
  const row = rowAt(state, witness.key, witness.path);
  const refs = callsOfRow(reason, row, { state, turnResults: [] });
  const keys = refs.flatMap(({ occurrenceKey }) =>
    occurrenceKey === undefined ? [] : [occurrenceKey],
  );
  if (keys.length === 0) return 'legacy';
  const outcomes = keys.map((key) => resolve(undefined, undefined, key).kind);
  if (outcomes.includes('ambiguous')) return 'call-unreadable';
  return outcomes.includes('missing') ? 'result-unavailable' : 'call-unreadable';
}
