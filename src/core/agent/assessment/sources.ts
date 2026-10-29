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
 *   over-report, it never hides (the fold's rule for "rests on").
 *
 * A row that names no call, a call whose tool's name the record does not
 * hold, and every entry of a list (a conflict's readings, a contingent value's
 * carriers, an answer check's tools) that names no call — beside the entries
 * that do — is COUNTED in `unnamed`, never dropped and never guessed. Only a
 * known call id is said once.
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
  readonly count?: number;
}

/** The entries of a list past the bound, as one counted anonymous reference — or none. */
const unreadRefs = (list: OwnList): CallRef[] => (list.unread > 0 ? [{ count: list.unread }] : []);

/** What the projection reads: the committed state, and this turn's results (for a tool-name join). */
export interface SourceRead {
  readonly state: Readonly<Record<string, unknown>>;
  readonly turnResults: readonly { readonly toolCallId?: string; readonly toolName?: string }[];
}

/** The row an RFC 6901 pointer's first segment indexes, in an array-valued key. */
function rowAt(state: Readonly<Record<string, unknown>>, key: string, path: string): unknown {
  const rows = state[key];
  const index = Number(path.split('/')[1]);
  return Array.isArray(rows) && Number.isInteger(index) ? rows[index] : undefined;
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
    const id = isRecord(entry) ? str(entry.toolCallId) : undefined;
    return id === undefined ? {} : { id };
  });
  return [...refs, ...unreadRefs(list)];
}

/** The calls one committed row names, read for `reason`. */
function callsOfRow(reason: AssessmentReason, row: unknown): CallRef[] {
  if (!isRecord(row)) return [];
  if (row.kind === 'conflict') return refsIn(row.witnesses);
  if (row.kind === 'contingent') return refsIn(row.carriers);
  if (reason === 'value-contingent' && row.kind === 'argument') {
    const result = str(row.result);
    return result === undefined ? [] : [{ id: result }];
  }
  const id = str(row.toolCallId);
  const name = str(row.toolName);
  return id === undefined && name === undefined
    ? []
    : [{ ...(id !== undefined && { id }), ...(name !== undefined && { name }) }];
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
      : calls.map((r) => ({ ...(r.toolCallId !== undefined && { id: r.toolCallId }), name }));
  });
  return [...matched, ...malformed, ...unreadRefs(list)];
}

/** The calls one witness names. */
function callsOfWitness(
  reason: AssessmentReason,
  w: AssessmentPointer,
  read: SourceRead,
): CallRef[] {
  if (w.kind === 'history') {
    const message = Array.isArray(read.state.history) ? read.state.history[w.index] : undefined;
    const name = isRecord(message) ? str(message.toolName) : undefined;
    return w.toolCallId === undefined && name === undefined
      ? []
      : [
          {
            ...(w.toolCallId !== undefined && { id: w.toolCallId }),
            ...(name !== undefined && { name }),
          },
        ];
  }
  if (w.key === 'answerValidation') {
    // `/checks/<index>` — the check row the reason fired on.
    const [, list, at] = w.path.split('/');
    const report = read.state.answerValidation;
    const checks = isRecord(report) && list === 'checks' ? report.checks : undefined;
    return Array.isArray(checks) ? callsOfCheck(checks[Number(at)], read) : [];
  }
  return callsOfRow(reason, rowAt(read.state, w.key, w.path));
}

/**
 * Every call id → its tool's registered name, as `history` holds it (a result,
 * else the call). `history` is read by index over its own length — never
 * through its iterator, like every reader of it in the fold — and a request's
 * `toolCalls` through `rowList`.
 */
function toolNamesOf(state: Readonly<Record<string, unknown>>): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const history: readonly unknown[] = Array.isArray(state.history) ? state.history : [];
  for (let index = 0; index < history.length; index++) {
    const m = history[index];
    if (!isRecord(m)) continue;
    const id = str(m.toolCallId);
    const name = str(m.toolName);
    if (m.role === 'tool' && id !== undefined && name !== undefined) names.set(id, name);
    for (const call of rowList(m.toolCalls)?.entries ?? []) {
      const callId = isRecord(call) ? str(call.id) : undefined;
      const callName = isRecord(call) ? str(call.name) : undefined;
      if (callId !== undefined && callName !== undefined && !names.has(callId)) {
        names.set(callId, callName);
      }
    }
  }
  return names;
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
  let names: ReadonlyMap<string, string> | undefined;
  const nameOf = (id: string): string | undefined => (names ??= toolNamesOf(read.state)).get(id);
  const calls: { toolCallId: string; toolName: string }[] = [];
  const listed = new Set<string>();
  // A call the record names by id but not by tool — counted once per id.
  const nameless = new Set<string>();
  // A reference that names no call — a row that names none, or a list entry with no
  // call id beside entries that have one — counted once each, never merged (the
  // entries of a list past the bound, `count` of them).
  let anonymous = 0;
  for (const w of witness) {
    const refs = callsOfWitness(reason, w, read);
    if (refs.length === 0) anonymous += 1;
    for (const ref of refs) {
      if (ref.id === undefined) {
        anonymous += ref.count ?? 1;
        continue;
      }
      if (listed.has(ref.id) || nameless.has(ref.id)) continue;
      const toolName = ref.name ?? nameOf(ref.id);
      if (toolName === undefined) {
        nameless.add(ref.id);
        continue;
      }
      listed.add(ref.id);
      calls.push({ toolCallId: ref.id, toolName });
    }
  }
  const unnamed = nameless.size + anonymous;
  return { kind: 'calls', calls, ...(unnamed > 0 && { unnamed }) };
}
