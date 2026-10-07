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
 *          row renders it (`lib/answer-account/facts/howSure.ts` ·
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
 * (`coverageDeclared` is never carried into a next turn), the conflict rows that
 * name one of those calls (the ledger IS carried, so rows about earlier turns'
 * calls are left out), and the answer's own rows (`unsupportedValues`,
 * `stoppedEarly`, `answerValidation`). "Rests on" is every call of the turn: it
 * may over-report, it never hides.
 *
 * ## How the turn ended
 *
 * A turn that ended in a PAUSE has no answer yet: a person's reply is what it
 * waits on. The fold reads that from the committed state every pause leaves —
 * `pausedToolCallId`, written by each pause the dispatch loop raises and
 * cleared by each resume — so a snapshot, a checkpoint and a saved recording
 * all say it, and every pause kind reads `ask`. A turn that ended in an ERROR
 * has no answer either, and no committed row says so in this version: the
 * readers settle that before they fold (`Agent.assessment` returns
 * `undefined`; the answer account says the record shows no answer).
 */

import { isSaidByPerson } from '../../../lib/saidByPerson.js';
import { toolBytesOf } from '../../../lib/toolBytes.js';
import {
  declaredByValue,
  readEmptiness,
  rowsAtProblem,
  type ValueDeclaration,
} from '../coverage/emptiness.js';
import { argumentRewritesOf } from '../middleware/rewrites.js';
import { REASONS, reasonEntry } from './reasons.js';
import type {
  AnswerAssessment,
  AssessmentDeclarations,
  AssessmentPointer,
  AssessmentReason,
  AssessmentRecord,
} from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

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

/** The placeholders a redacted record holds where a policy selected a value (footprintjs's, by tier). */
const KEPT_OUT: ReadonlySet<unknown> = new Set(['REDACTED', '[REDACTED]']);

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
  const keptOut = new Set(Object.keys(state).filter((key) => KEPT_OUT.has(state[key])));
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

/** One tool result of this turn, where it sits in `history`. */
interface TurnResult {
  readonly index: number;
  readonly toolCallId?: string;
  readonly toolName?: string;
  /**
   * The TOOL's own bytes — `content` cut at the tool-bytes boundary
   * (`lib/toolBytes.ts` · `toolBytesOf`). The inputs layer appends a note
   * after a filled call's result; read whole, the note breaks the parse and
   * the one emptiness reader returns `unknown`, which would hide
   * `empty-undeclared`, `declared-absent` and a listed gap on exactly the
   * calls that ran on a default nobody chose.
   */
  readonly content: unknown;
}

/**
 * The results after the last message a person said — or all of them, said so,
 * when none is — each read as the tool's own bytes.
 */
function turnResults(history: readonly unknown[]): {
  readonly results: readonly TurnResult[];
  readonly from: AnswerAssessment['turnFrom'];
} {
  let start = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (isRecord(m) && typeof m.content === 'string' && typeof m.role === 'string') {
      const said = isSaidByPerson({
        role: m.role,
        content: m.content,
        ...(m.injectedBy !== undefined && { injectedBy: m.injectedBy }),
      });
      if (said) {
        start = i;
        break;
      }
    }
  }
  const results: TurnResult[] = [];
  for (let i = start + 1; i < history.length; i++) {
    const m = history[i];
    if (!isRecord(m) || m.role !== 'tool') continue;
    const toolCallId = str(m.toolCallId);
    const toolName = str(m.toolName);
    results.push({
      index: i,
      ...(toolCallId !== undefined && { toolCallId }),
      ...(toolName !== undefined && { toolName }),
      content: toolBytesOf({ content: m.content, toolChars: m.toolChars }),
    });
  }
  return { results, from: start >= 0 ? 'person' : 'whole-history' };
}

/** One coverage row the run committed, as the fold reads it. */
interface CoverageRow {
  readonly index: number;
  readonly kind: 'absence' | 'ledger';
  readonly toolCallId?: string;
  readonly gap: boolean;
}

const listed = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

function coverageRows(state: Readonly<Record<string, unknown>>): readonly CoverageRow[] {
  const rows = state.coverageDeclared;
  if (!Array.isArray(rows)) return [];
  const out: CoverageRow[] = [];
  rows.forEach((row: unknown, index) => {
    if (!isRecord(row) || (row.kind !== 'absence' && row.kind !== 'ledger')) return;
    const toolCallId = str(row.toolCallId);
    out.push({
      index,
      kind: row.kind,
      ...(toolCallId !== undefined && { toolCallId }),
      gap: listed(row.notChecked) || listed(row.cannotCover),
    });
  });
  return out;
}

const statePointer = (key: string, ...path: readonly (string | number)[]): AssessmentPointer => ({
  kind: 'state',
  key,
  path: path.map((p) => `/${String(p).replace(/~/g, '~0').replace(/\//g, '~1')}`).join(''),
});

const historyPointer = (result: TurnResult): AssessmentPointer => ({
  kind: 'history',
  index: result.index,
  path: result.toolCallId !== undefined ? '/toolCallId' : '/role',
  ...(result.toolCallId !== undefined && { toolCallId: result.toolCallId }),
});

// ── the fold, as small steps over one accumulator ───────────────────────────

/** One check whose verdict the record holds. */
type CheckRan = AnswerAssessment['checked'][number];

/** What the steps gather as they read: the reasons with their rows, the checks that ran, the support. */
interface Gathered {
  readonly fired: Map<AssessmentReason, AssessmentPointer[]>;
  readonly checked: CheckRan[];
  support?: AnswerAssessment['support'];
}

function fire(g: Gathered, reason: AssessmentReason, witness: AssessmentPointer): void {
  const list = g.fired.get(reason) ?? [];
  list.push(witness);
  g.fired.set(reason, list);
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
function readPause(state: Readonly<Record<string, unknown>>, g: Gathered): void {
  const paused = state.pausedToolCallId;
  if (typeof paused === 'string' && paused.length > 0) {
    fire(g, 'asked', statePointer('pausedToolCallId'));
  }
}

/** One current `argument` row of this turn — the last per (call, argument). */
interface ArgumentRowRead {
  readonly index: number;
  readonly toolCallId: string;
  readonly argument: string;
  readonly source?: string;
  /** Set on a row that ASKED the person — no source yet. */
  readonly asked: boolean;
  readonly ruled: boolean;
  readonly failed: boolean;
  /** The declared-sources check judged it (`claimed` present) — and whether it reached a verdict. */
  readonly sourced?: 'verdict' | 'uncheckable';
  /** `said` + `reading`: the value is the model's reading of the person's words. */
  readonly reading: boolean;
  /** `result` + `setAside`: the value came from a result the model had set aside. */
  readonly setAside: boolean;
}

/**
 * This turn's CURRENT argument rows (honesty layer 2): the ledger's `argument`
 * rows whose `turn` is the run's `turnNumber` — the ledger crosses turns on a
 * continued conversation, and a row from an earlier turn is about a call this
 * answer does not rest on — keyed by call, then argument, the LAST row
 * winning. A record with no `turnNumber` reads every argument row (it may
 * over-report; it never hides).
 */
function argumentRows(state: Readonly<Record<string, unknown>>): readonly ArgumentRowRead[] {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const byCall = new Map<string, Map<string, ArgumentRowRead>>();
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'argument') return;
    if (turn !== undefined && row.turn !== turn) return;
    const toolCallId = str(row.toolCallId);
    const argument = str(row.argument);
    if (toolCallId === undefined || argument === undefined) return;
    const source = str(row.source);
    const read: ArgumentRowRead = {
      index,
      toolCallId,
      argument,
      ...(source !== undefined && { source }),
      asked: typeof row.asked === 'string' && source === undefined,
      ruled: row.rule !== undefined || row.period === true,
      failed: row.failed !== undefined,
      ...(typeof row.claimed === 'string' && {
        sourced: row.failed === 'uncheckable' ? ('uncheckable' as const) : ('verdict' as const),
      }),
      reading: source === 'said' && row.reading === true,
      setAside: source === 'result' && typeof row.setAside === 'string',
    };
    const forCall = byCall.get(toolCallId) ?? new Map<string, ArgumentRowRead>();
    forCall.set(argument, read);
    byCall.set(toolCallId, forCall);
  });
  return [...byCall.values()].flatMap((forCall) => [...forCall.values()]);
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
  g: Gathered,
): void {
  if (rows.length === 0) return;
  // The before-tool rewrites (`middlewareDecisions` · `changedKeys`) — the ONE reading the
  // answer's "Assumed" block takes too (`middleware/rewrites.ts` · `argumentRewritesOf`).
  const rewrites = argumentRewritesOf(state.middlewareDecisions);
  const witness: AssessmentPointer[] = [];
  for (const row of rows) {
    const at = statePointer('findingsLedger', row.index, 'argument');
    witness.push(at);
    const rewrite = rewrites.get(row.toolCallId)?.get(row.argument);
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

/** The call ids one ledger row names — its own, where it was declared, its carriers, its witnesses. */
function callsNamedBy(row: Readonly<Record<string, unknown>>): string[] {
  const named: string[] = [];
  const id = str(row.toolCallId);
  if (id !== undefined) named.push(id);
  const on = isRecord(row.declaredOn) ? str(row.declaredOn.toolCallId) : undefined;
  if (on !== undefined) named.push(on);
  for (const list of [row.carriers, row.witnesses]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list as readonly unknown[]) {
      const at = isRecord(entry) ? str(entry.toolCallId) : undefined;
      if (at !== undefined) named.push(at);
    }
  }
  return named;
}

/**
 * Where THIS turn's rows begin on the ledger, as far as the ledger itself can
 * show it: the first row stamped with this turn, or — unstamped — the first
 * that names a call of this turn. A row cannot name a call before the call
 * exists, and the one writer appends in order, so every row from there on was
 * filed this turn. `-1` when no row shows it — nothing on the ledger is shown
 * to be this turn's. A provider that reuses call ids across turns breaks the
 * first premise: an earlier turn's row naming the reused id is found first,
 * and the fold over-reports from there (named in the README, "Not covered").
 */
function firstRowOfTurn(
  ledger: readonly unknown[],
  calls: ReadonlySet<string>,
  turn: number,
): number {
  return ledger.findIndex((row) => {
    if (!isRecord(row)) return false;
    if (typeof row.turn === 'number') return row.turn === turn;
    return callsNamedBy(row).some((id) => calls.has(id));
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
  calls: ReadonlySet<string>,
  g: Gathered,
): void {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const since = turn !== undefined && turn > 1 ? firstRowOfTurn(ledger, calls, turn) : 0;
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'contingent') return;
    if (typeof row.turn === 'number' && turn !== undefined) {
      if (row.turn !== turn) return;
    } else if (row.declaredOn !== 'answer') {
      const on = isRecord(row.declaredOn) ? str(row.declaredOn.toolCallId) : undefined;
      if (on === undefined || !calls.has(on)) return;
    } else if (since < 0 || index < since) {
      return;
    }
    fire(g, 'value-contingent', statePointer('findingsLedger', index, 'value'));
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

/** One `period` row of this turn — one judged call. */
interface PeriodRowRead {
  readonly index: number;
  readonly toolCallId: string;
  readonly verdict: string;
  /** The argument the tool's `ToolPeriod` names — the join key to the call's argument row. */
  readonly argument?: string;
  /** The time layer's checks on the row (step T8) — filed only under `.time()`. */
  readonly differs: boolean;
  readonly beyondRetention: boolean;
}

/**
 * This turn's period verdicts (honesty layer 3): EVERY `period` row whose
 * `turn` is the run's `turnNumber`, in ledger order. A record with no
 * `turnNumber` reads every period row (it may over-report; it never hides).
 *
 * Never collapsed by call id. The layer files one row per judged call — each
 * batch judged once (`honesty/mounts.ts` · `batchToJudge`) — so a second row
 * under an id is ANOTHER call: a provider's synthetic counter restarts with
 * each provider instance, so a resumed leg repeats the ids of the leg that
 * failed (whose rows ride the checkpoint, under the same turn), and a provider
 * may reuse an id across batches. "The last per call" would let a later
 * `covered` hide an earlier `not-held` the answer can still rest on.
 */
function periodRows(state: Readonly<Record<string, unknown>>): readonly PeriodRowRead[] {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const rows: PeriodRowRead[] = [];
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'period') return;
    if (turn !== undefined && row.turn !== turn) return;
    const toolCallId = str(row.toolCallId);
    const verdict = str(row.verdict);
    if (toolCallId === undefined || verdict === undefined) return;
    const argument = str(row.argument);
    rows.push({
      index,
      toolCallId,
      verdict,
      ...(argument !== undefined && { argument }),
      differs: isRecord(row.differs),
      beyondRetention: row.beyondRetention === true,
    });
  });
  return rows;
}

/** The reason each period verdict fires — `covered` fires none. */
const PERIOD_REASONS: Readonly<Record<string, AssessmentReason>> = {
  'not-held': 'period-not-held',
  'partly-held': 'period-partly-held',
  unknown: 'period-unknown',
  undeclared: 'period-undeclared',
};

/**
 * Layer 3, the results layer's verdicts: each period row of this turn — the
 * store did not hold the period the read asked for (`not-held`), held only
 * part of it (`partly-held`), could not say (`unknown`, adopted Q33: "not
 * sure" by default, on a non-empty result too), or the result said nothing
 * about its period though its tool declares a period argument (`undeclared`).
 * `covered` fires nothing — and supports nothing: a period the store held
 * keeps a reason from firing, never more.
 *
 * THE JOIN (results.md § 3.7): the inputs layer owns WHO chose the period
 * (the call's `argument` row for the argument its `ToolPeriod` names), this
 * layer owns WHAT the read covered. A period reason's witnesses are both rows
 * — joined by the call id and the argument name, and neither parses the
 * other's words — so a reader can say "the hour you asked about" or "the 2
 * hours the tool's rule assumed". Files the `result-period` check when the
 * layer filed any verdict this turn.
 */
function readPeriodVerdicts(
  rows: readonly PeriodRowRead[],
  argumentVerdicts: readonly ArgumentRowRead[],
  g: Gathered,
): void {
  if (rows.length === 0) return;
  const witness: AssessmentPointer[] = [];
  for (const row of rows) {
    const at = statePointer('findingsLedger', row.index, 'verdict');
    witness.push(at);
    const chosenBy = argumentVerdicts.find(
      (a) => a.toolCallId === row.toolCallId && a.argument === row.argument,
    );
    const fireJoined = (reason: AssessmentReason, pointer: AssessmentPointer): void => {
      fire(g, reason, pointer);
      if (row.argument !== undefined && chosenBy !== undefined) {
        fire(g, reason, statePointer('findingsLedger', chosenBy.index, 'argument'));
      }
    };
    // The time layer's result checks (step T8), under `.time()` only: the
    // read is not what was asked (TQ8 — `extra` alone too), or the window was
    // older than the source keeps.
    if (row.differs) {
      fireJoined('period-differs-from-asked', statePointer('findingsLedger', row.index, 'differs'));
    }
    if (row.beyondRetention) {
      fireJoined(
        'period-beyond-retention',
        statePointer('findingsLedger', row.index, 'beyondRetention'),
      );
    }
    const reason = PERIOD_REASONS[row.verdict];
    if (reason === undefined) continue;
    fireJoined(reason, at);
  }
  g.checked.push({ layer: 3, check: 'result-period', ran: rows.length, of: rows.length, witness });
}

/** Layer 3, the tools' own declarations: every absence and every declared gap. */
function readCoverageRows(coverage: readonly CoverageRow[], g: Gathered): void {
  for (const row of coverage) {
    const at = statePointer('coverageDeclared', row.index, 'kind');
    if (row.kind === 'absence') fire(g, 'declared-absent', at);
    if (row.gap) fire(g, 'coverage-gap', at);
  }
}

/**
 * One result of the turn, with what the record holds about its call: the
 * committed coverage rows, and — only when there are none — the envelope in
 * the result itself (`coverage/emptiness.ts` · `declaredByValue`).
 */
interface ResultRead {
  readonly result: TurnResult;
  readonly at: AssessmentPointer;
  readonly rows: readonly CoverageRow[];
  /**
   * The result's OWN envelope, read when its call has no committed row: the run
   * filed none (an envelope it never recognized, such as JSON text), or the row
   * was lost on the way here (a history restored by `resumeOnError` carries no
   * `coverageDeclared`; a trimmed recording drops it). Never read as silence.
   */
  readonly own?: ValueDeclaration;
}

function readResults(
  results: readonly TurnResult[],
  coverage: readonly CoverageRow[],
): readonly ResultRead[] {
  const rowsByCall = new Map<string, CoverageRow[]>();
  for (const row of coverage) {
    if (row.toolCallId === undefined) continue;
    rowsByCall.set(row.toolCallId, [...(rowsByCall.get(row.toolCallId) ?? []), row]);
  }
  return results.map((result) => {
    const rows = result.toolCallId !== undefined ? rowsByCall.get(result.toolCallId) ?? [] : [];
    const own = rows.length === 0 ? declaredByValue(result.content) : undefined;
    return { result, at: historyPointer(result), rows, ...(own !== undefined && { own }) };
  });
}

/**
 * Layer 3, what came back: every result of the turn through the ONE emptiness
 * reader. A call with committed coverage rows is read through the door those
 * rows are; a call with none is handed NO door, so the reader reads the
 * envelope in the bytes by the rule the run's recognizer files rows — and a gap
 * that envelope lists is a reason too.
 */
function readTurnResults(
  reads: readonly ResultRead[],
  declarations: AssessmentDeclarations | undefined,
  g: Gathered,
): void {
  const readable: AssessmentPointer[] = [];
  for (const { result, at, rows, own } of reads) {
    const absenceRow = rows.some((c) => c.kind === 'absence');
    const door =
      rows.length > 0
        ? { absent: absenceRow, bounded: rows.some((c) => c.kind === 'ledger') }
        : undefined;
    const rowsAt =
      result.toolName !== undefined ? declarations?.tools?.[result.toolName]?.rowsAt : undefined;
    const reading = readEmptiness(result.content, {
      ...(door !== undefined && { door }),
      ...(rowsAt !== undefined && { rowsAt }),
    });
    if (reading.emptiness !== 'unknown') readable.push(at);
    // An empty rowset inside a declared boundary, or an absence no row holds; an absence row fired for itself.
    if (reading.emptiness === 'declared-absent' && !absenceRow) fire(g, 'declared-absent', at);
    if (reading.emptiness === 'undeclared-empty' && rows.length === 0) {
      fire(g, 'empty-undeclared', at);
    }
    // A gap the result's own envelope lists, when no row holds it.
    if (own?.gap === true) fire(g, 'coverage-gap', at);
  }
  if (reads.length > 0) {
    g.checked.push({
      layer: 3,
      check: 'result-shape',
      ran: readable.length,
      of: reads.length,
      witness: readable,
    });
  }
}

/**
 * The calls of this turn: every result's call and every coverage row's call.
 * A row or a result that names no call is counted on its own — never merged
 * into another call. A call DECLARED what it covered when the record holds a
 * coverage row for it, or — with no row — its result's own envelope. Files the
 * `tool-coverage` check and returns the ids.
 */
function readTurnCalls(
  reads: readonly ResultRead[],
  coverage: readonly CoverageRow[],
  g: Gathered,
): ReadonlySet<string> {
  const calls = new Set<string>();
  for (const { result } of reads) if (result.toolCallId !== undefined) calls.add(result.toolCallId);
  for (const c of coverage) if (c.toolCallId !== undefined) calls.add(c.toolCallId);
  const declared = new Set(coverage.flatMap((c) => (c.toolCallId ? [c.toolCallId] : [])));
  const witness = coverage.map((c) => statePointer('coverageDeclared', c.index, 'kind'));
  let unnamedDeclared = 0;
  for (const { result, at, own } of reads) {
    if (own === undefined) continue;
    witness.push(at);
    if (result.toolCallId !== undefined) declared.add(result.toolCallId);
    else unnamedDeclared += 1;
  }
  const unjoinedRows = coverage.filter((c) => c.toolCallId === undefined).length;
  const unnamedResults = reads.filter((r) => r.result.toolCallId === undefined).length;
  const of = calls.size + unjoinedRows + unnamedResults;
  if (of > 0) {
    g.checked.push({
      layer: 3,
      check: 'tool-coverage',
      ran: declared.size + unjoinedRows + unnamedDeclared,
      of,
      witness,
    });
  }
  return calls;
}

/**
 * Layer 3, the model's readings: a conflict row that names a call of THIS turn.
 * A row the one writer stamped with its `turn` (the honesty layers' turn stamp,
 * filed while a layer is armed) is this turn's only when the stamp says so —
 * a provider that reuses call ids across turns no longer makes an earlier
 * turn's conflict read as this one's. An unstamped row keeps the call-id rule.
 */
function readConflicts(
  state: Readonly<Record<string, unknown>>,
  calls: ReadonlySet<string>,
  g: Gathered,
): void {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'conflict' || !Array.isArray(row.witnesses)) return;
    if (typeof row.turn === 'number' && turn !== undefined && row.turn !== turn) return;
    const ofThisTurn = row.witnesses.some(
      (w: unknown) => isRecord(w) && typeof w.toolCallId === 'string' && calls.has(w.toolCallId),
    );
    if (ofThisTurn) fire(g, 'sources-conflict', statePointer('findingsLedger', index, 'kind'));
  });
}

/** One answer-layer witness row of this turn, where it sits on the ledger. */
interface WitnessRead {
  readonly index: number;
  readonly kind: 'grounded' | 'steps-unfinished';
  /** On a `grounded` row: how many values the gate looked up in the tools' results. */
  readonly lookedUp?: number;
}

/**
 * This turn's witness rows (honesty layer 4, `assessment/witness.ts`): the
 * ledger's `grounded` and `steps-unfinished` rows whose `turn` is the run's
 * `turnNumber` — the ledger crosses turns on a continued conversation, and an
 * earlier turn's verdict is about an answer this fold is not reading. A record
 * with no `turnNumber` reads every witness row (it may over-report; it never
 * hides). Filed only while the answer layer is armed, so an unarmed record
 * holds none and this reads nothing.
 */
function witnessRows(state: Readonly<Record<string, unknown>>): readonly WitnessRead[] {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const out: WitnessRead[] = [];
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || (row.kind !== 'grounded' && row.kind !== 'steps-unfinished')) return;
    if (turn !== undefined && row.turn !== turn) return;
    out.push({
      index,
      kind: row.kind,
      ...(typeof row.lookedUp === 'number' && { lookedUp: row.lookedUp }),
    });
  });
  return out;
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
    if (w.kind === 'steps-unfinished') {
      fire(g, 'steps-unfinished', statePointer('findingsLedger', w.index, 'kind'));
    }
  }
  readTimeDerived(state, g);
  const report = state.answerValidation;
  if (!isRecord(report) || typeof report.status !== 'string') return;
  const at = statePointer('answerValidation', 'status');
  g.checked.push({ layer: 4, check: 'answer-checks', ran: 1, of: 1, witness: [at] });
  if (report.status === 'failed') fire(g, 'answer-check-failed', at);
  if (report.status === 'unverified') fire(g, 'check-unreachable', at);
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

/** The reasons in `REASONS` order, and the value by precedence: a reason > support > a check ran > nothing. */
function valueOf(g: Gathered): Pick<AnswerAssessment, 'assessment' | 'reasons'> {
  const reasons = REASONS.flatMap((entry) => {
    const witness = g.fired.get(entry.reason);
    if (witness === undefined) return [];
    return [
      { reason: entry.reason, ...(entry.layer !== undefined && { layer: entry.layer }), witness },
    ];
  });
  const assessment: AnswerAssessment['assessment'] =
    reasons.length > 0
      ? 'unknown'
      : g.support !== undefined
      ? 'known'
      : g.checked.some((c) => c.ran > 0)
      ? 'unrefuted'
      : 'not-applicable';
  return { assessment, reasons };
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
  const { state, asked } = keptOutGuard(stateOf(record));
  const g: Gathered = { fired: new Map(), checked: [] };
  const history = Array.isArray(state.history) ? (state.history as readonly unknown[]) : [];
  const { results, from } = turnResults(history);
  const coverage = coverageRows(state);

  const reads = readResults(results, coverage);

  readPause(state, g);
  const argumentVerdicts = argumentRows(state);
  readArgumentAsk(state, argumentVerdicts, g);
  readArgumentVerdicts(state, argumentVerdicts, g);
  readCoverageRows(coverage, g);
  const calls = readTurnCalls(reads, coverage, g);
  readContingentRows(state, calls, g);
  readTurnResults(reads, declarations, g);
  readPeriodVerdicts(periodRows(state), argumentVerdicts, g);
  readConflicts(state, calls, g);
  readAnswerRows(state, g);

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
  const { assessment, reasons } = valueOf(g);
  return {
    assessment,
    standing: standingOf(assessment, reasons),
    reasons,
    ...(assessment === 'known' && g.support !== undefined && { support: g.support }),
    checked: g.checked,
    turnFrom: from,
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
