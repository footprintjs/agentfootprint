/**
 * assess — the answer's standing, folded from the committed record.
 *
 * Pattern: one pure Fold over the Trace. It reads COMMITTED rows only — the
 *          run's `sharedState` and, for a pause, the checkpoint's `pauseData` —
 *          and never an event, so the running agent and every later reader
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
 */

import { readAwaitingInput } from '../../inputRequest.js';
import { isSaidByPerson } from '../../../lib/saidByPerson.js';
import { readEmptiness, rowsAtProblem } from '../coverage/emptiness.js';
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

/** One tool result of this turn, where it sits in `history`. */
interface TurnResult {
  readonly index: number;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly content: unknown;
}

/** The results after the last message a person said — or all of them, said so, when none is. */
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
      content: m.content,
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

/** A typed ask still waiting at the end of the turn — read from the checkpoint, never an event. */
function pendingAsk(record: AssessmentRecord): boolean {
  const pauseData = isRecord(record.checkpoint) ? record.checkpoint.pauseData : undefined;
  try {
    return readAwaitingInput(pauseData) !== undefined;
  } catch {
    // A malformed stored ask is not an ask the record can read — never guessed at.
    return false;
  }
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

/** Every layer: a typed ask still waiting at the end of the turn. */
function readAsk(record: AssessmentRecord, g: Gathered): void {
  if (pendingAsk(record)) {
    fire(g, 'asked', { kind: 'checkpoint', path: '/pauseData/awaitingInput/requestId' });
  }
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
 * Layer 3, what came back: every result of the turn through the ONE emptiness
 * reader, handed the door its coverage rows are — a marker the run did not
 * recognize is data.
 */
function readTurnResults(
  results: readonly TurnResult[],
  coverage: readonly CoverageRow[],
  declarations: AssessmentDeclarations | undefined,
  g: Gathered,
): void {
  const rowsByCall = new Map<string, CoverageRow[]>();
  for (const row of coverage) {
    if (row.toolCallId === undefined) continue;
    rowsByCall.set(row.toolCallId, [...(rowsByCall.get(row.toolCallId) ?? []), row]);
  }
  const readable: AssessmentPointer[] = [];
  for (const result of results) {
    const rows = result.toolCallId !== undefined ? rowsByCall.get(result.toolCallId) ?? [] : [];
    const door = {
      absent: rows.some((c) => c.kind === 'absence'),
      bounded: rows.some((c) => c.kind === 'ledger'),
    };
    const rowsAt =
      result.toolName !== undefined ? declarations?.tools?.[result.toolName]?.rowsAt : undefined;
    const reading = readEmptiness(result.content, {
      door,
      ...(rowsAt !== undefined && { rowsAt }),
    });
    const at = historyPointer(result);
    if (reading.emptiness !== 'unknown') readable.push(at);
    // An empty rowset inside a declared boundary; an absence row already fired for itself.
    if (reading.emptiness === 'declared-absent' && !door.absent) fire(g, 'declared-absent', at);
    if (reading.emptiness === 'undeclared-empty' && rows.length === 0) {
      fire(g, 'empty-undeclared', at);
    }
  }
  if (results.length > 0) {
    g.checked.push({
      layer: 3,
      check: 'result-shape',
      ran: readable.length,
      of: results.length,
      witness: readable,
    });
  }
}

/**
 * The calls of this turn: every result's call and every coverage row's call.
 * A row or a result that names no call is counted on its own — never merged
 * into another call. Files the `tool-coverage` check and returns the ids.
 */
function readTurnCalls(
  results: readonly TurnResult[],
  coverage: readonly CoverageRow[],
  g: Gathered,
): ReadonlySet<string> {
  const calls = new Set<string>();
  for (const r of results) if (r.toolCallId !== undefined) calls.add(r.toolCallId);
  for (const c of coverage) if (c.toolCallId !== undefined) calls.add(c.toolCallId);
  const declared = new Set(coverage.flatMap((c) => (c.toolCallId ? [c.toolCallId] : [])));
  const unjoinedRows = coverage.filter((c) => c.toolCallId === undefined).length;
  const unnamedResults = results.filter((r) => r.toolCallId === undefined).length;
  const of = calls.size + unjoinedRows + unnamedResults;
  if (of > 0) {
    g.checked.push({
      layer: 3,
      check: 'tool-coverage',
      ran: declared.size + unjoinedRows,
      of,
      witness: coverage.map((c) => statePointer('coverageDeclared', c.index, 'kind')),
    });
  }
  return calls;
}

/** Layer 3, the model's readings: a conflict row that names a call of THIS turn. */
function readConflicts(
  state: Readonly<Record<string, unknown>>,
  calls: ReadonlySet<string>,
  g: Gathered,
): void {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'conflict' || !Array.isArray(row.witnesses)) return;
    const ofThisTurn = row.witnesses.some(
      (w: unknown) => isRecord(w) && typeof w.toolCallId === 'string' && calls.has(w.toolCallId),
    );
    if (ofThisTurn) fire(g, 'sources-conflict', statePointer('findingsLedger', index, 'kind'));
  });
}

/** Layer 4, the answer's own rows: the evidence gate's flag, a cut-short turn, the app's checks. */
function readAnswerRows(state: Readonly<Record<string, unknown>>, g: Gathered): void {
  const unsupported = state.unsupportedValues;
  if (isRecord(unsupported)) {
    const at = statePointer('unsupportedValues', 'candidates');
    fire(g, unsupported.revised === true ? 'value-survived-revision' : 'value-unsupported', at);
    g.checked.push({ layer: 4, check: 'names-and-numbers', ran: 1, of: 1, witness: [at] });
  }
  if (isRecord(state.stoppedEarly)) {
    fire(g, 'stopped-early', statePointer('stoppedEarly', 'iteration'));
  }
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
 * @param record        a recording (`recordRun`), `{ snapshot }`, and/or
 *                      `{ checkpoint }` — pass a paused run's checkpoint so a
 *                      typed ask still waiting is read.
 * @param declarations  what the APP declares (the answer account's object): the
 *                      fold reads `tools[name].rowsAt`, where an object result
 *                      keeps its rows.
 * @throws TypeError only on a caller error (a record that is not an object, a
 *                   malformed `rowsAt`); a record it cannot read yields
 *                   `not-applicable`, never a throw.
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
  const state = stateOf(record);
  const g: Gathered = { fired: new Map(), checked: [] };
  const history = Array.isArray(state.history) ? (state.history as readonly unknown[]) : [];
  const { results, from } = turnResults(history);
  const coverage = coverageRows(state);

  readAsk(record, g);
  readCoverageRows(coverage, g);
  const calls = readTurnCalls(results, coverage, g);
  readTurnResults(results, coverage, declarations, g);
  readConflicts(state, calls, g);
  readAnswerRows(state, g);

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
