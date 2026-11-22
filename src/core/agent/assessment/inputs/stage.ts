import { waitingArgumentIteration, type ArgumentRowRead } from '../argumentRows.js';
import { fire, type Gathered } from '../gathered.js';
import { callPlacement, type CallPlaces } from '../gather/calls.js';
import { statePointer } from '../pointer.js';
import { isRecord } from '../recordValues.js';
import { rewritesByOccurrence } from '../rewrittenArguments.js';
import { rowList } from '../sources.js';
import type { standingAdmission } from '../standingAdmission.js';
import type { AssessmentPointer } from '../types.js';

/**
 * Layer 2, the inputs layer's verdicts. For each ruled argument of this
 * turn's calls, the value the call RAN with decides:
 *
 * - rewritten by a before-tool middleware AFTER the layer checked it — the
 *   rewrite is what ran: ASSUMED unless the middleware declared the value the
 *   person's or the app's (`allow(args, why, { from })`); a middleware default
 *   never earns more standing than the same default declared as `assume`;
 * - otherwise the layer's row: `default` fires `argument-assumed`; `model` on a
 *   ruled argument, or a failed declared-source check on ANY argument (the
 *   model misstated the record), fires `argument-unverified`; `said` with
 *   `reading` (the model's reading of the person's words) fires
 *   `argument-read`; `result` with `setAside` (a result the model set aside)
 *   fires `value-contingent`.
 *
 * A traced source — `said` via the quote or a declared phrase, `answered`,
 * `result`, `app` — fires nothing, and SUPPORTS nothing: a membership pass
 * only keeps a reason from firing, so no row here ever makes an answer
 * "known". Files the `argument-rules` check when the layer filed any verdict
 * this turn, and the `argument-sources` check when the declared-sources check
 * judged any.
 */
function readArgumentVerdicts(
  state: Readonly<Record<string, unknown>>,
  rows: readonly ArgumentRowRead[],
  resolve: CallPlaces['resolve'],
  g: Gathered,
): void {
  rows = rows.filter((row) => !row.withheld);
  if (rows.length === 0) return;
  // The before-tool rewrites (`middlewareDecisions` · `changedKeys`) — the ONE reading the
  // answer's "Assumed" block takes too (`middleware/rewrites.ts` · `argumentRewritesOf`).
  const rewrites = rewritesByOccurrence(state.middlewareDecisions, resolve);
  const witness: AssessmentPointer[] = [];
  for (const row of rows) {
    const at = statePointer('findingsLedger', row.index, 'argument');
    witness.push(at);
    const rewrite =
      row.historyIndex === undefined
        ? undefined
        : rewrites.get(row.historyIndex)?.get(row.argument);
    if (rewrite !== undefined) {
      if (rewrite.origin !== 'person' && rewrite.origin !== 'app') {
        fire(
          g,
          'argument-assumed',
          statePointer('middlewareDecisions', rewrite.index, 'changedKeys'),
        );
      }
      continue;
    }
    if (row.source === 'default') fire(g, 'argument-assumed', at);
    else if ((row.source === 'model' && row.ruled) || row.failed) {
      fire(g, 'argument-unverified', at);
    } else if (row.reading) fire(g, 'argument-read', at);
    else if (row.setAside) fire(g, 'value-contingent', at);
  }
  g.checked.push({
    layer: 2,
    check: 'argument-rules',
    ran: rows.length,
    of: rows.length,
    witness,
  });
  // The declared-sources check (either door: `.inputsLayer` or `.findings`) — the rows it
  // judged carry `claimed`; `uncheckable` is a check that reached no verdict.
  const judged = rows.filter((r) => r.sourced !== undefined);
  if (judged.length > 0) {
    const reached = judged.filter((r) => r.sourced === 'verdict');
    g.checked.push({
      layer: 2,
      check: 'argument-sources',
      ran: reached.length,
      of: judged.length,
      witness: reached.map((r) => statePointer('findingsLedger', r.index, 'claimed')),
    });
  }
}

/**
 * Where THIS turn's rows begin on the ledger, as far as the ledger itself can
 * show it: the first row stamped with this turn, or — unstamped — the first
 * that resolves to a call of this turn. A row cannot name a call before the call
 * exists, and the one writer appends in order, so every row from there on was
 * filed this turn. `-1` when no row establishes the turn.
 */
function firstRowOfTurn(ledger: readonly unknown[], places: CallPlaces, turn: number): number {
  return ledger.findIndex((row) => {
    if (!isRecord(row)) return false;
    if (typeof row.turn === 'number') return row.turn === turn;
    const current = (ref: unknown) => callPlacement(ref, places) === 'current';
    return (
      current(row) ||
      current(row.declaredOn) ||
      [row.carriers, row.witnesses].some((list) => rowList(list)?.entries.some(current))
    );
  });
}

/**
 * Layer 2, the contingent law's rows: a value a call of this turn — or the
 * answer — used that only results the model itself set aside carried
 * (`findings/contingent.ts`, filed under `.findings()` beside the evidence
 * gate). A row the one writer stamped with its `turn` is this turn's only when
 * the stamp says so; an unstamped row declared on a call is this turn's when
 * the call is. An unstamped row declared on the ANSWER names no call of its
 * own, and the ledger crosses turns on a continued conversation: on a first
 * turn (or a record with no `turnNumber`) it is this turn's; on a later turn
 * only when it follows — or is — a row the ledger shows to be this turn's
 * (`firstRowOfTurn`). Otherwise the record cannot say which turn filed it,
 * and it is not read: an earlier turn's answer must never make this one "not
 * sure". The rows of an agent that arms the inputs layer carry their turn.
 */
export function readContingentRows(
  state: Readonly<Record<string, unknown>>,
  places: CallPlaces,
  g: Gathered,
): void {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const since = turn !== undefined && turn > 1 ? firstRowOfTurn(ledger, places, turn) : 0;
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'contingent') return;
    if (typeof row.turn === 'number' && turn !== undefined) {
      if (row.turn !== turn) return;
    } else if (row.declaredOn !== 'answer') {
      if (callPlacement(row.declaredOn, places) !== 'current') return;
    } else if (since < 0 || index < since) {
      return;
    }
    fire(
      g,
      'value-contingent',
      statePointer('findingsLedger', index, row.declaredOn === 'answer' ? 'declaredOn' : 'value'),
    );
  });
}

/**
 * Layer 2, the inputs layer's own ask: the turn ENDED with the batch ask still
 * waiting on the person — read from the committed state the ask leaves
 * (`AgentState.argumentAsk`, whose `waiting` is written before the pause and
 * cleared when the answer settles it), never from the pause event or the
 * checkpoint's `pauseData`. The witnesses are that marker and this turn's
 * current `asked` rows — the values the answer waits on. Nothing in the batch
 * has run. An ask that settled (answered, or refused after three answers that
 * did not fit) leaves no marker and fires nothing here.
 */
export function readArgumentAsk(
  state: Readonly<Record<string, unknown>>,
  rows: readonly ArgumentRowRead[],
  g: Gathered,
): void {
  const ask = state.argumentAsk;
  if (!isRecord(ask) || !isRecord(ask.waiting)) return;
  fire(g, 'argument-asked', statePointer('argumentAsk', 'waiting', 'requestId'));
  for (const row of rows) {
    if (row.asked) fire(g, 'argument-asked', statePointer('findingsLedger', row.index, 'asked'));
  }
}

type ArgumentAdmission = Pick<
  ReturnType<typeof standingAdmission>,
  'keyed' | 'entered' | 'entryIncomplete'
>;

/** Record the admitted input verdicts and return the same argument rows for period checks. */
export function readInputs(
  state: Readonly<Record<string, unknown>>,
  argumentVerdicts: readonly ArgumentRowRead[],
  resolveCurrent: CallPlaces['resolve'],
  admission: ArgumentAdmission,
  g: Gathered,
): readonly ArgumentRowRead[] {
  const enteredArguments = argumentVerdicts.filter(
    (row) =>
      !(admission.keyed && row.occurrenceKey === undefined) &&
      admission.entered(row.historyIndex, row.occurrenceKey),
  );
  readArgumentVerdicts(state, enteredArguments, resolveCurrent, g);
  if (waitingArgumentIteration(state) === undefined) {
    const entered = new Set(enteredArguments.map((row) => row.index));
    // A keyless ambiguous observation cannot establish a call. Say the
    // check was unavailable instead of treating a missing reason as clearance.
    for (const row of argumentVerdicts) {
      if (
        (row.historyIndex !== undefined && !(admission.keyed && row.occurrenceKey === undefined)) ||
        (row.occurrenceKey !== undefined && !admission.entryIncomplete) ||
        entered.has(row.index) ||
        row.asked ||
        row.withheld ||
        (!row.failed && !row.ruled)
      )
        continue;
      fire(g, 'check-unreachable', statePointer('findingsLedger', row.index, 'argument'));
    }
  }
  return enteredArguments;
}
