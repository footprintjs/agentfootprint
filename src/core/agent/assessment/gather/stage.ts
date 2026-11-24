import { isPlaceholder } from '../../../../redaction/marker.js';
import { historyCallResolver, readHistoryCalls } from '../../recordedCalls.js';
import { argumentRows } from '../argumentRows.js';
import { coverageRows } from '../coverageRows.js';
import { ENTRY_EVIDENCE_COMPLETE_KEY, ENTRY_EVIDENCE_KEY } from '../entryEvidence.js';
import { fire, type Gathered } from '../gathered.js';
import { statePointer } from '../pointer.js';
import { callIndexOf } from '../recordValues.js';
import { deliveredResults } from '../resultDispositions.js';
import { readResults } from '../resultEvidence.js';
import { standingAdmission } from '../standingAdmission.js';
import { turnResults } from '../turnResults.js';
import type { PreparedWarning, WarningContext } from '../warningContext.js';

/**
 * `state` as the fold may read it. A key the record keeps out (an agent's
 * `redact` left its placeholder there) reads as ABSENT — the fold never takes
 * the placeholder for a value (a `pausedToolCallId` of `'REDACTED'` is not a
 * pause) — and every such key the fold asks for is noted in `asked`, so
 * `assessAnswer` can refuse to give a verdict over it. A record with no
 * placeholder is handed through untouched.
 */
function keptOutGuard(state: Readonly<Record<string, unknown>>): {
  readonly state: Readonly<Record<string, unknown>>;
  readonly asked: ReadonlySet<string>;
} {
  const keptOut = new Set(Object.keys(state).filter((key) => isPlaceholder(state[key])));
  const asked = new Set<string>();
  if (keptOut.size === 0) return { state, asked };
  // A plain copy without the kept-out keys: a served snapshot may be frozen,
  // and a proxy may not answer `undefined` for a frozen key that holds a value.
  const held = Object.fromEntries(Object.entries(state).filter(([key]) => !keptOut.has(key)));
  const note = (key: string | symbol): void => {
    if (typeof key === 'string' && keptOut.has(key)) asked.add(key);
  };
  const guarded = new Proxy(held, {
    get: (target, key, receiver) => (note(key), Reflect.get(target, key, receiver)),
    has: (target, key) => (note(key), Reflect.has(target, key)),
  });
  return { state: guarded, asked };
}

/**
 * Every layer: the turn ENDED in a pause still waiting for a person — read from
 * the committed state the pause leaves (`AgentState.pausedToolCallId`: the
 * paused call, written by every pause the dispatch loop raises, cleared to `''`
 * by every resume), never from the pause event or the checkpoint's
 * `pauseData`. Every kind is the one `asked` reason: a typed input
 * (`requestInput`), a question (`askHuman` / `pauseHere`), a consent gate (a
 * tool's `checkIn`, a middleware's `ask`) and a credential consent all wait on
 * a person's reply, and the answer does not exist until it comes.
 */
export function readPause(state: Readonly<Record<string, unknown>>, g: Gathered): void {
  const paused = state.pausedToolCallId;
  if (typeof paused === 'string' && paused.length > 0) {
    fire(g, 'asked', statePointer('pausedToolCallId'));
  }
}

/** The prepared facts and one private accumulator for this fold. */
export function prepareWarning(
  recorded: Readonly<Record<string, unknown>>,
  served: boolean,
  declarationAddresses?: ReadonlyMap<number, number>,
  legacyEvents?: unknown,
): PreparedWarning {
  const { state, asked } = served
    ? keptOutGuard(recorded)
    : { state: recorded, asked: new Set<string>() };
  const history = Array.isArray(state.history) ? (state.history as readonly unknown[]) : [];
  const historyCalls = readHistoryCalls(history);
  const { results: recordedResults, from, begins } = turnResults(history, historyCalls);
  const current = historyCalls.filter((call) => call.index > begins);
  const resolveCurrent = historyCallResolver(current);
  const argumentVerdicts = argumentRows(state, current, history, begins);
  const admission = standingAdmission(
    state,
    historyCalls,
    current,
    argumentVerdicts,
    declarationAddresses,
    history,
    legacyEvents,
  );
  const g: Gathered = { admit: admission.admit, fired: new Map(), checked: [] };
  if (admission.entryIncomplete)
    fire(
      g,
      'check-unreachable',
      admission.legacyEntry
        ? statePointer(ENTRY_EVIDENCE_KEY, 'complete')
        : statePointer(ENTRY_EVIDENCE_COMPLETE_KEY),
    );
  if (admission.settlements?.complete === false)
    fire(g, 'check-unreachable', statePointer('settledToolCallsComplete'));
  const { results, periods } = deliveredResults(recordedResults, admission.dispositions);
  return {
    state,
    recorded,
    admission,
    g,
    results,
    periods,
    history,
    current,
    historyCalls,
    from,
    begins,
    asked,
    resolveCurrent,
    argumentVerdicts,
  };
}

/** Prepare coverage after the chart files withholding and legacy period witnesses. */
export function gatherWarning(
  prepared: PreparedWarning,
  declarationAddresses?: ReadonlyMap<number, number>,
): WarningContext {
  const { state, admission, results, history, historyCalls, begins, resolveCurrent } = prepared;
  const places = { history, resolve: historyCallResolver(historyCalls), begins };
  const coverage = coverageRows(
    state.coverageDeclared,
    (row) => callIndexOf(row, resolveCurrent),
    declarationAddresses,
    admission.nativeResult,
  );
  const reads = readResults(
    results.filter((result) => admission.returned(result.index)),
    coverage,
  );

  // A throw kept a declared check from running. Count the opportunity
  // without admitting its error notice as a result or as a witness.
  const resultOpportunities =
    reads.length + results.filter((result) => admission.threw(result.index)).length;
  return { ...prepared, places, coverage, reads, resultOpportunities };
}
