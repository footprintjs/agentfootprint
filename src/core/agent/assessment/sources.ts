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
 */

import type { AssessmentPointer, AssessmentReason, AssessmentReasonSource } from './types.js';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** One call a witness row names: its id (when the row has one) and the tool name the row holds. */
interface CallRef {
  readonly id?: string;
  readonly name?: string;
}

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
 * does not still rests on both.
 */
function refsIn(list: unknown): CallRef[] {
  if (!Array.isArray(list)) return [];
  return list.map((entry: unknown) => {
    const id = isRecord(entry) ? str(entry.toolCallId) : undefined;
    return id === undefined ? {} : { id };
  });
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
 * this turn ran, and an entry that is not a tool name, is an ANONYMOUS
 * reference each: counted, never dropped beside the tools that matched.
 */
function callsOfCheck(check: unknown, read: SourceRead): CallRef[] {
  if (!isRecord(check) || !Array.isArray(check.tools)) return [];
  const names = [
    ...new Set(check.tools.flatMap((t: unknown) => (str(t) === undefined ? [] : [t as string]))),
  ];
  const malformed: CallRef[] = check.tools
    .filter((t: unknown) => str(t) === undefined)
    .map(() => ({}));
  const matched = names.flatMap((name): CallRef[] => {
    const calls = read.turnResults.filter((r) => r.toolName === name);
    return calls.length === 0
      ? [{ name }]
      : calls.map((r) => ({ ...(r.toolCallId !== undefined && { id: r.toolCallId }), name }));
  });
  return [...matched, ...malformed];
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

/** Every call id → its tool's registered name, as `history` holds it (a result, else the call). */
function toolNamesOf(state: Readonly<Record<string, unknown>>): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const history = Array.isArray(state.history) ? state.history : [];
  for (const m of history as readonly unknown[]) {
    if (!isRecord(m)) continue;
    const id = str(m.toolCallId);
    const name = str(m.toolName);
    if (m.role === 'tool' && id !== undefined && name !== undefined) names.set(id, name);
    if (!Array.isArray(m.toolCalls)) continue;
    for (const call of m.toolCalls as readonly unknown[]) {
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
  // call id beside entries that have one — counted once each, never merged.
  let anonymous = 0;
  for (const w of witness) {
    const refs = callsOfWitness(reason, w, read);
    if (refs.length === 0) anonymous += 1;
    for (const ref of refs) {
      if (ref.id === undefined) {
        anonymous += 1;
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
