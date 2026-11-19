import {
  callOccurrenceField,
  readCallOccurrenceKey,
  storedCallOccurrenceField,
} from '../../../lib/callOccurrence.js';
import { copyPeriod, type DeclaredPeriod } from '../../../semantics/coverage/period.js';
import { toolRanOf } from '../../../semantics/toolRan.js';
import {
  callRowOfCall,
  callWindowOfCall,
  clockOf,
  type CallWindowRow,
} from '../../../time/rows.js';
import type { CallPeriod, CallTime, RanCall, ResultsLayerState } from '../results/subflow.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * WHICH BATCH the loop head hands the results layer on this visit — the
 * iteration that dispatched it, or `undefined` when there is none to judge.
 *
 * `stamp` is the iteration ToolCalls wrote beside the batch it dispatched
 * (`AgentState.toolResultsIteration`, under the arm); `iteration` is the loop
 * head's. ToolCalls advances the iteration by exactly one and loops straight
 * here; every other way back — the schema re-ask, the step nudge, the evidence
 * recheck, the wrap-up — runs no tool, leaves the batch in place and advances
 * the iteration again. So the batch is new on this visit exactly when
 * `iteration === stamp + 1`: each batch judged ONCE per run.
 *
 * Never by call id. A provider's synthetic counter restarts with each provider
 * instance (`<prefix>-call-${++toolCallSeq}`), so a resumed leg repeats the ids
 * of the leg that failed — whose rows the conversation checkpoint carries — and
 * nothing stops a provider reusing an id across batches of one run. A stamp is
 * per run: no conversation checkpoint carries it, so a resumed leg starts with
 * none. Were the invariant above ever broken, a batch would be judged twice —
 * an over-report, never a hidden verdict.
 */
export function batchToJudge(iteration: number, stamp: unknown): number | undefined {
  return typeof stamp === 'number' && iteration === stamp + 1 ? stamp : undefined;
}

/**
 * What the loop head hands the results layer — the batch's identities, the
 * periods ITS results declared (the coverage rows of the batch's iteration, so
 * a call id an earlier batch also used cannot lend it a period), and the
 * stamps. Only on the first visit after ToolCalls ran the batch
 * (`batchToJudge`); every other visit is handed an empty batch and reads
 * nothing else, so the layer never reads a key the run has not written.
 */
export function resultsLayerInput(parent: Record<string, unknown>): ResultsLayerState {
  const batchIteration = batchToJudge(parent.iteration as number, parent.toolResultsIteration);
  if (batchIteration === undefined) return { calls: [] };
  const batch = (parent.toolResults as readonly unknown[] | undefined) ?? [];
  const calls: RanCall[] = [];
  for (const entry of batch) {
    if (
      !isRecord(entry) ||
      readCallOccurrenceKey(entry) === null ||
      toolRanOf(entry) === 'not-run' ||
      entry.threw === true
    )
      continue;
    if (typeof entry.toolCallId !== 'string' || typeof entry.toolName !== 'string') continue;
    calls.push({
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
      ...storedCallOccurrenceField(entry),
    });
  }
  if (calls.length === 0) return { calls };
  const legacyIds = new Set<string>();
  const idsByOccurrence = new Map<string, string>();
  for (const call of calls) {
    const key = readCallOccurrenceKey(call);
    if (key === undefined) legacyIds.add(call.toolCallId);
    else if (key !== null) idsByOccurrence.set(key, call.toolCallId);
  }
  const periods: CallPeriod[] = [];
  for (const row of (parent.coverageDeclared as readonly unknown[] | undefined) ?? []) {
    if (!isRecord(row) || row.iteration !== batchIteration || row.period === undefined) continue;
    if (typeof row.toolCallId !== 'string') continue;
    const key = readCallOccurrenceKey(row);
    if (key === null) continue;
    const matches =
      key === undefined
        ? legacyIds.has(row.toolCallId)
        : idsByOccurrence.get(key) === row.toolCallId;
    if (!matches) continue;
    periods.push({
      toolCallId: row.toolCallId,
      period: copyPeriod(row.period as DeclaredPeriod),
      ...storedCallOccurrenceField(row),
    });
  }
  const time = timeOfBatch(parent, calls);
  return {
    calls,
    batchIteration,
    turnNumber: parent.turnNumber as number,
    ...(periods.length > 0 && { periods }),
    ...time,
  };
}

/**
 * Under `.time()` (step T8): each call's time rows — its `call-window` row
 * and its `call` row's `drift` — and the turn's clock `now`, for the result
 * checks (`time/check.ts` · `periodTimeCheck`). Nothing when the turn has
 * no clock (an agent without `.time()`), so an unarmed run hands the layer the
 * input it always did. "This turn" is checked, not assumed: a ledger carried
 * forward (a checkpoint's `findingsLedger` from an agent that had `.time()`,
 * resumed and then run on by one that has not) holds an EARLIER turn's clock,
 * and that clock's `now` must not judge this turn's calls. Exported for that
 * test only.
 */
export function timeOfBatch(
  parent: Record<string, unknown>,
  calls: readonly RanCall[],
): Pick<ResultsLayerState, 'times' | 'now'> {
  const ledger = parent.findingsLedger as readonly unknown[] | undefined;
  const clock = clockOf(ledger);
  const turn = parent.turnNumber as number;
  if (clock === undefined || clock.turn !== turn) return {};
  const times: CallTime[] = [];
  for (const call of calls) {
    const key = readCallOccurrenceKey(call);
    const matches = (row: object) => key !== null && readCallOccurrenceKey(row) === key;
    const window = callWindowOfCall(ledger, call.toolCallId, turn, matches);
    const drift = callRowOfCall(ledger, call.toolCallId, turn, matches)?.drift;
    if (window === undefined && drift === undefined) {
      times.push({ toolCallId: call.toolCallId, ...callOccurrenceField(call.callOccurrenceKey) });
      continue;
    }
    times.push({
      toolCallId: call.toolCallId,
      ...callOccurrenceField(call.callOccurrenceKey),
      ...(window !== undefined && { window: windowForCheck(window) }),
      ...(drift !== undefined && { drift }),
    });
  }
  return { times, now: clock.now };
}

/** The fields of a `call-window` row the result checks read — plain data. */
function windowForCheck(row: CallWindowRow): NonNullable<CallTime['window']> {
  return {
    how: row.how,
    ...(row.form !== undefined && { form: row.form }),
    ...(row.asked !== undefined && { asked: { from: row.asked.from, to: row.asked.to } }),
    ...(row.person !== undefined && { person: row.person }),
    ...(row.sent !== undefined && { sent: { from: row.sent.from, to: row.sent.to } }),
    ...(row.trimmedByTool === true && { trimmedByTool: true as const }),
    ...(row.partlyBeyondRetention === true && { partlyBeyondRetention: true as const }),
    ...(row.refused !== undefined && { refused: row.refused }),
  };
}
