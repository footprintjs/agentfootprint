/**
 * assess — the answer's standing, folded from the committed record.
 *
 * Pattern: one pure Fold over the Trace. It reads COMMITTED state only — the
 *          run's `sharedState` (the snapshot's, or a paused run's checkpoint's)
 *          — and never an event, so the running agent and every later reader
 *          fold the same bytes. No clock, network, model or randomness; the
 *          same inputs give the same bytes; it never writes into the run.
 * Role:    core/ layer, pure. The one owner of the answer's standing: the
 *          `/observe` door publishes it (`assessAnswer`), `Agent.assessment`
 *          reads the last run through it, and the answer account's "How sure"
 *          row renders it (`answer-account/facts/howSure.ts` ·
 *          `readHowSure`).
 * Emits:   N/A.
 *
 * ## The law
 *
 * The standing comes from what the record can check, never from how sure the
 * model sounds — and never "known" from silence. A reason that fires makes it
 * `unknown`; only a TIE check (a passed enforce `.answerValidation()` report for
 * these bytes) SUPPORTS `known`; checks that ran and fired nothing make it
 * `unrefuted` ("consistent with the record"); a record on which nothing could be
 * checked is `not-applicable` ("not assessed"). A membership pass — a value
 * found, a result that came back non-empty — keeps a reason from firing and
 * never supports anything.
 *
 * ## This turn only
 *
 * The turn begins after the last message a person said
 * (`lib/saidByPerson.ts` · `isSaidByPerson`, the one owner of that question): a
 * continued conversation carries earlier turns' results in `history`, and a
 * library frame (a correction, a nudge) is not a person's turn. The fold reads
 * the tool results after that message, every coverage row of the run
 * (`coverageDeclared` is never carried into a next turn), the conflict rows of
 * this turn — one that names one of those calls, or one stamped with this turn
 * whose readings the record does not all place in earlier turns
 * (`conflictOfThisTurn`; the ledger IS carried, so rows about earlier turns'
 * calls are left out), and the
 * answer's own rows (`unsupportedValues`,
 * `stoppedEarly`, `answerValidation`). "Rests on" is every call of the turn: it
 * may over-report, it never hides.
 *
 * ## How the turn ended
 *
 * Every pause leaves `pausedToolCallId` in committed state until resume, so
 * a snapshot, checkpoint or recording reads it as `ask`. Readers settle an
 * error before they fold: `Agent.assessment` returns `undefined` and the answer
 * account says the record shows no answer.
 */

import { callIndexOf, isRecord, str } from './recordValues.js';
import { recoveredCallOutcomes, turnResults } from './turnResults.js';
import { argumentRows, waitingArgumentIteration, type ArgumentRowRead } from './argumentRows.js';
import { rowsAtProblem } from '../emptiness.js';
import { issuedTicketsOf } from '../placedTickets.js';
import { historyCallResolver, readHistoryCalls, uniqueHistoryProposal } from '../recordedCalls.js';
import { readIntegrityRows } from './integrityReasons.js';
import { historyPointer, statePointer } from './pointer.js';
import { periodRows, PERIOD_REASONS, readPeriodVerdicts } from './periodRows.js';
import { retentionRefusalsOf } from '../../../time/retentionRefusals.js';
import { deliveredResults } from './resultDispositions.js';
import { witnessRows } from './answerWitnesses.js';
import { reasonEntry } from './reasons.js';
import { rowList } from './sources.js';
import { assessmentValueOf, readReasonDetails, type RetainedReasonState } from './reasonDetails.js';
import { readConflicts } from './conflicts.js';
import { rewritesByOccurrence } from './rewrittenArguments.js';
import { coverageRows } from './coverageRows.js';
import { fire, type Gathered } from './gathered.js';
import {
  readCallOutcomes,
  readCoverageRows,
  readResults,
  readTurnResults,
  readTurnCalls,
} from './resultEvidence.js';
import { standingAdmission } from './standingAdmission.js';
import { ENTRY_EVIDENCE_COMPLETE_KEY, ENTRY_EVIDENCE_KEY } from './entryEvidence.js';
import { placeSettledResults, readSettledResults } from './settledResults.js';
import type {
  AnswerAssessment,
  AssessmentDeclarations,
  AssessmentPointer,
  AssessmentReason,
  AssessmentRecord,
} from './types.js';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { isPlaceholder, servedUnderPolicy } from '../../../redaction/marker.js';

function fail(message: string): never {
  throw new TypeError(`assessAnswer: ${message}`);
}

/** A caller error throws; everything the RECORD holds is read, never refused. */
function checkInputs(record: unknown, declarations: unknown): void {
  if (!isRecord(record)) {
    fail('the record must be an object — a recording, { snapshot }, or { checkpoint }');
  }
  if (declarations === undefined) return;
  if (!isRecord(declarations)) fail('declarations must be an object');
  const tools = declarations.tools;
  if (tools === undefined) return;
  if (!isRecord(tools)) fail('declarations.tools must be an object keyed by tool name');
  for (const [tool, entry] of Object.entries(tools)) {
    if (!isRecord(entry)) fail(`declarations.tools.${tool} must be an object`);
    if (entry.rowsAt === undefined) continue;
    const problem = rowsAtProblem(entry.rowsAt);
    if (problem === 'empty') fail(`declarations.tools.${tool}.rowsAt must be a non-empty key`);
    if (problem === 'nested') {
      fail(`declarations.tools.${tool}.rowsAt must be a top-level key (no "/" or ".")`);
    }
  }
}

/** The committed state: the snapshot's, else the paused run's checkpoint's. */
function stateOf(record: AssessmentRecord): Readonly<Record<string, unknown>> {
  const fromSnapshot = isRecord(record.snapshot) ? record.snapshot.sharedState : undefined;
  if (isRecord(fromSnapshot)) return fromSnapshot;
  const fromCheckpoint = isRecord(record.checkpoint) ? record.checkpoint.sharedState : undefined;
  return isRecord(fromCheckpoint) ? fromCheckpoint : {};
}

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

type ResolveCall = ReturnType<typeof historyCallResolver>;

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
function readPause(state: Readonly<Record<string, unknown>>, g: Gathered): void {
  const paused = state.pausedToolCallId;
  if (typeof paused === 'string' && paused.length > 0) {
    fire(g, 'asked', statePointer('pausedToolCallId'));
  }
}

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
  resolve: ResolveCall,
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

interface CallPlaces {
  readonly history: readonly unknown[];
  readonly resolve: ResolveCall;
  readonly begins: number;
}

function callPlacement(ref: unknown, { history, resolve, begins }: CallPlaces) {
  if (!isRecord(ref)) return undefined;
  const id = str(ref.toolCallId);
  const occurrenceKey = readCallOccurrenceKey(ref);
  const resolved = resolve(id, str(ref.toolName), occurrenceKey);
  if (resolved.kind === 'matched') return resolved.call.index < begins ? 'earlier' : 'current';
  if (resolved.kind === 'missing' && id !== undefined && occurrenceKey === undefined) {
    const proposal = uniqueHistoryProposal(history, id);
    if (proposal !== undefined && proposal.index < begins) return 'earlier';
  }
  return undefined;
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
function readContingentRows(
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
function readArgumentAsk(
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

/**
 * Layer 4, the answer's own rows: the evidence gate's verdict (a flag —
 * `unsupportedValues` — or, while the answer layer is armed, its clean pass,
 * the `grounded` witness row), a cut-short turn, an answer given before its
 * declared steps finished (the `steps-unfinished` witness row), the app's
 * checks. A clean pass is a MEMBERSHIP pass — every value found somewhere in
 * the tools' results — so it files the check as having run and supports
 * nothing: "known" needs a tie check.
 */
function readAnswerRows(state: Readonly<Record<string, unknown>>, g: Gathered): void {
  const witnesses = witnessRows(state);
  const unsupported = state.unsupportedValues;
  if (isRecord(unsupported)) {
    const at = statePointer('unsupportedValues', 'candidates');
    fire(g, unsupported.revised === true ? 'value-survived-revision' : 'value-unsupported', at);
    g.checked.push({ layer: 4, check: 'names-and-numbers', ran: 1, of: 1, witness: [at] });
  } else {
    // The gate's clean pass on this turn's answer — the LAST one, the verdict
    // on the answer that stands (an earlier draft's verdict never reaches a
    // row: a draft sent back for revision files `evidenceUnsupported`, not a
    // witness, and the Route decider files a `steps-unfinished` row only once
    // its answer has stood every later judge). A pass that looked NOTHING up
    // (the answer stated no name or number, or every one was exempt) did not
    // apply: it is absent from `checked`, never a check that "ran" on an
    // answer it could not read.
    const grounded = witnesses.filter((w) => w.kind === 'grounded').at(-1);
    if (grounded !== undefined && (grounded.lookedUp ?? 0) > 0) {
      g.checked.push({
        layer: 4,
        check: 'names-and-numbers',
        ran: 1,
        of: 1,
        witness: [statePointer('findingsLedger', grounded.index, 'kind')],
      });
    }
  }
  if (isRecord(state.stoppedEarly)) {
    fire(g, 'stopped-early', statePointer('stoppedEarly', 'iteration'));
  }
  for (const w of witnesses) {
    if (w.kind !== 'grounded') fire(g, w.kind, statePointer('findingsLedger', w.index, 'kind'));
  }
  readTimeDerived(state, g);
  readScriptsShown(state, g);
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || (row.kind !== 'negative-claim' && row.kind !== 'negative-claim-note'))
      return;
    if (typeof state.turnNumber === 'number' && row.turn !== state.turnNumber) return;
    fire(g, 'negative-prose-unverified', statePointer('findingsLedger', index, 'kind'));
  });
  const report = state.answerValidation;
  if (!isRecord(report) || typeof report.status !== 'string') return;
  const at = statePointer('answerValidation', 'status');
  g.checked.push({ layer: 4, check: 'answer-checks', ran: 1, of: 1, witness: [at] });
  // By index over the list's own length — never its iterator or its own `entries`.
  const checks: readonly unknown[] = Array.isArray(report.checks) ? report.checks : [];
  for (let index = 0; index < checks.length; index++) {
    const check: unknown = Object.getOwnPropertyDescriptor(checks, String(index))?.value;
    if (!isRecord(check) || typeof check.id !== 'string') continue;
    if (!check.id.startsWith('agent:negative-claims:')) continue;
    if (check.disposition === 'checked-fail')
      fire(g, 'claim-exceeds-search', statePointer('answerValidation', 'checks', index));
    if (check.reason === 'declaration-overclaimed')
      fire(g, 'declaration-overclaimed', statePointer('answerValidation', 'checks', index));
  }
  if (report.status === 'failed') fire(g, 'answer-check-failed', at);
  if (report.status === 'unverified') fire(g, 'check-unreachable', at);
  // A failed report can also hold checks that could not reach a verdict — a
  // contradiction found beside unreachable rows, or beside a validator that
  // did not finish (`reason`): both are true, so both are said.
  else if (report.status === 'failed') {
    if (typeof report.unreachable === 'number' && report.unreachable > 0) {
      fire(g, 'check-unreachable', statePointer('answerValidation', 'unreachable'));
    } else if (typeof report.reason === 'string') {
      fire(g, 'check-unreachable', statePointer('answerValidation', 'reason'));
    }
  }
  const digest = str(report.candidateDigest);
  // The ONE tie check this version can read: a passed ENFORCE report that names its bytes.
  if (report.status === 'passed' && report.mode === 'enforce' && digest !== undefined) {
    g.support = { kind: 'answer-validation', reportDigest: digest };
  }
}

/**
 * The answer's time values the library itself spelled from a reading of this
 * turn (time design § 9.5, step T7): a `time-derived` row of this turn fires
 * `derived-from-reading` — folded like `argument-assumed`, "not sure" at most,
 * never "known". Filed only under `.time()` beside the evidence gate, so an
 * unarmed record holds none and this reads nothing. A record with no
 * `turnNumber` reads every such row (it may over-report; it never hides).
 */
function readTimeDerived(state: Readonly<Record<string, unknown>>, g: Gathered): void {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'time-derived') return;
    if (turn !== undefined && row.turn !== turn) return;
    fire(g, 'derived-from-reading', statePointer('findingsLedger', index, 'values'));
  });
}

/**
 * The script match's verdicts on the blocks THIS turn's answer showed
 * (`.namesAndNumbersFromEvidence({ code: 'match' })`, the `script-shown`
 * witness rows): each block reached a verdict, so the `script-match` check ran
 * on every one; an `unmatched` block fires `script-unmatched` — "not sure",
 * its own reason (a script can miss while every number in the answer is in a
 * result). A MATCHED block fires nothing and supports nothing: it says which
 * call submitted the program, never that a value is right. Filed only under
 * the arm while the answer layer is armed, so an unarmed record reads nothing.
 * A record with no `turnNumber` reads every such row (it may over-report; it
 * never hides).
 */
function readScriptsShown(state: Readonly<Record<string, unknown>>, g: Gathered): void {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const witness: AssessmentPointer[] = [];
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'script-shown') return;
    if (turn !== undefined && row.turn !== turn) return;
    const at = statePointer('findingsLedger', index, 'label');
    witness.push(at);
    if (row.label === 'unmatched') fire(g, 'script-unmatched', at);
  });
  if (witness.length === 0) return;
  g.checked.push({
    layer: 4,
    check: 'script-match',
    ran: witness.length,
    of: witness.length,
    witness,
  });
}

/**
 * Fold one answer's standing from its committed record.
 *
 * The record of a turn that ended in an ANSWER or in a PAUSE (a pause reads
 * `ask`, from the committed state the pause leaves — no checkpoint needed). A
 * turn that ended in an error has no answer, and its committed state does not
 * say so in this version: do not fold it (`agent.assessment()` returns
 * `undefined` for one; the answer account says the record shows no answer).
 *
 * @param record        a recording (`recordRun`), `{ snapshot }`, or a paused
 *                      run's `{ checkpoint }` — its `sharedState` is read when
 *                      no snapshot is given.
 * @param declarations  what the APP declares — any `AnswerAccountDeclarations`
 *                      is accepted as it is: the fold reads only
 *                      `tools[name].rowsAt`, where an object result keeps its
 *                      rows.
 * @throws TypeError only on a caller error (a record that is not an object, a
 *                   malformed `rowsAt`); a record it cannot read yields
 *                   `not-applicable`, never a throw.
 *
 * A REDACTED record (an agent's `redact`): when the fold would read a state key
 * the record keeps out, it gives no verdict — `standing: 'not-assessed'`, with
 * the keys it needed in `keptOut`. A verdict over the placeholder would read a
 * kept-out pause as a pause and a kept-out history as an empty one.
 *
 * @example
 * ```ts
 * import { assessAnswer, recordRun } from 'agentfootprint/observe';
 *
 * const recorder = recordRun(agent);
 * await agent.run({ message: 'Which ports on switch A are down?' });
 * const a = assessAnswer(recorder.toRecording());
 * a.standing; // 'not-sure'
 * a.reasons;  // [{ reason: 'empty-undeclared', layer: 3, witness: [...] }]
 * ```
 */
export function assessAnswer(
  record: AssessmentRecord,
  declarations?: AssessmentDeclarations,
): AnswerAssessment {
  checkInputs(record, declarations);
  // A placeholder is a kept-out value only in a snapshot served under a policy
  // (`redaction/marker.ts`); a checkpoint is never served.
  return foldState(
    stateOf(record),
    declarations,
    servedUnderPolicy(record.snapshot),
    undefined,
    undefined,
    record.events,
  );
}

/**
 * `assessAnswer` over a runner's LIVE snapshot (`Agent.assessment()`): the
 * state is the run's own heap, never served, so a placeholder string in it is
 * a value. The snapshot's `recorders` row says a policy covered the run — true
 * of its commit log, never of its live state — so it is not consulted here.
 *
 * @internal — `Agent · assessment`'s.
 */
export function assessLive(
  snapshot: unknown,
  declarations?: AssessmentDeclarations,
  retainedHistory?: (history: readonly unknown[]) => unknown,
  retainedReasonState?: RetainedReasonState,
): AnswerAssessment {
  checkInputs({ snapshot }, declarations);
  return foldState(
    stateOf({ snapshot }),
    declarations,
    false,
    retainedHistory,
    undefined,
    undefined,
    retainedReasonState ?? (() => undefined),
  );
}

/**
 * The one fold, over a committed state already in hand. `served`: the state
 * comes from a record served under a redaction policy, so a key holding the
 * placeholder is a value the record keeps out (`keptOutGuard`).
 *
 * @internal — `assessAnswer`'s, and the answer account's, which holds the
 *            state and the marker apart.
 */
export function foldState(
  recorded: Readonly<Record<string, unknown>>,
  declarations: AssessmentDeclarations | undefined,
  served: boolean,
  retainedHistory?: (history: readonly unknown[]) => unknown,
  declarationAddresses?: ReadonlyMap<number, number>,
  legacyEvents?: unknown,
  retain: RetainedReasonState = (_key, value) => value,
): AnswerAssessment {
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
  const nativeFacts = admission.nativeResult;
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
  // An occurrence witness would reveal how many results the host withheld.
  if (admission.withheldReturn) g.fired.set('result-withheld', []);
  for (const { result, verdict } of admission.settlements === undefined ? periods : []) {
    const reason = PERIOD_REASONS[verdict];
    if (reason !== undefined) fire(g, reason, historyPointer(result));
  }
  const places = { history, resolve: historyCallResolver(historyCalls), begins };
  const coverage = coverageRows(
    state.coverageDeclared,
    (row) => callIndexOf(row, resolveCurrent),
    declarationAddresses,
    nativeFacts,
  );
  const reads = readResults(
    results.filter((result) => admission.returned(result.index)),
    coverage,
  );

  // A throw kept a declared check from running. Count the opportunity
  // without admitting its error notice as a result or as a witness.
  const resultOpportunities =
    reads.length + results.filter((result) => admission.threw(result.index)).length;
  readPause(state, g);
  readArgumentAsk(state, argumentVerdicts, g);
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
  readCoverageRows(coverage, g);
  readTurnCalls(reads, coverage, resultOpportunities, g);
  readContingentRows(state, places, g);
  if (admission.settlements === undefined) {
    readCallOutcomes(results, recoveredCallOutcomes(results, history, begins, retainedHistory), g);
  } else {
    const placed = placeSettledResults(admission.settlements, results, current);
    const recovered = recoveredCallOutcomes(
      placed.retained,
      history,
      begins,
      retainedHistory,
      (index) => placed.byIndex.get(index)?.execution === 'returned',
    );
    readSettledResults(admission.settlements, placed, coverage, recovered, PERIOD_REASONS, g);
  }
  readTurnResults(
    reads,
    declarations,
    issuedTicketsOf(recorded.placedTickets),
    resultOpportunities,
    g,
    admission.settlements === undefined,
  );
  readPeriodVerdicts(
    periodRows(state, (row) => callIndexOf(row, resolveCurrent), nativeFacts),
    enteredArguments,
    g,
  );
  if (Array.isArray(state.findingsLedger)) {
    const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
    for (const { index } of retentionRefusalsOf(state.findingsLedger, turn)) {
      fire(g, 'period-beyond-retention', statePointer('findingsLedger', index, 'refused'));
    }
  }
  readConflicts(state, (ref) => callPlacement(ref, places), g, admission.legacyConflictCheck);
  readAnswerRows(state, g);
  const integrity = readIntegrityRows(state);
  for (const { reason, at } of integrity.fired) fire(g, reason, at);

  if (asked.size > 0) {
    return {
      assessment: 'not-applicable',
      standing: 'not-assessed',
      reasons: [],
      checked: [],
      turnFrom: from,
      keptOut: [...asked].sort(),
    };
  }
  const detail = readReasonDetails(
    g,
    current,
    coverage,
    state,
    admission.settlements?.byKey,
    retain,
  );
  const { assessment, reasons } = assessmentValueOf(
    g,
    {
      state,
      turnResults: results,
      historyCalls,
      turnBegins: begins,
      declarationAddresses,
      failureCategories: detail.failureByHistory,
    },
    detail,
  );
  return {
    assessment,
    standing: standingOf(assessment, reasons),
    reasons,
    ...(assessment === 'known' && g.support !== undefined && { support: g.support }),
    checked: g.checked,
    turnFrom: from,
    ...(integrity.notes.length > 0 && { notes: integrity.notes }),
  };
}

/** The owner's words for a value: ask > not sure > known > consistent > not assessed. */
function standingOf(
  assessment: AnswerAssessment['assessment'],
  reasons: readonly { readonly reason: AssessmentReason }[],
): AnswerAssessment['standing'] {
  switch (assessment) {
    case 'unknown':
      return reasons.some((r) => reasonEntry(r.reason).class === 'ask') ? 'ask' : 'not-sure';
    case 'known':
      return 'known';
    case 'unrefuted':
      return 'consistent';
    case 'not-applicable':
      return 'not-assessed';
  }
}
