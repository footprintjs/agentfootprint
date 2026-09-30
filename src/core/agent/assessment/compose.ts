/**
 * assessment/compose — the answer's standing as ONE line for the person, under
 * its own opt-in arm (`.answerLayer({ standingLine: true })`).
 *
 * Pattern: Lens. A pure composer over the standing as data
 *          (`AnswerAssessmentData`, the projection the answer layer files on
 *          `turn_end` and on `agentfootprint.answer.assessed`) and the values
 *          a tool's rule assumed this turn (the same `AssumedLine`s the
 *          "Assumed" block prints — `arguments/serve.ts` · `assumedLinesFor`).
 *          One closed, versioned table of words; nothing here reads the run.
 * Role:    core/ layer leaf of the answer layer (honesty layer 4). Loaded only
 *          by the layer's stage (`assessment/stage.ts`), which is itself
 *          loaded through `import()` under the arm — a plain agent's graph
 *          never carries it.
 * Emits:   N/A.
 *
 * ## What the line may say
 *
 * The owner's five words, in precedence order — ask > not sure > known >
 * consistent > not assessed — each rendered from the fold's value and reasons
 * alone (`assessment/assess.ts` · `assessAnswer`), never from how sure the
 * model sounded. "Consistent with the run's record" is never "known" and never
 * "verified". A reason is named by what the record holds, in the past tense of
 * the run that holds it. The ONE place the line prints a value is an assumed
 * argument, and then only in the tool's own argument view (a value that view
 * hides is said to be hidden, never printed) — the "Assumed" block's rule, so
 * "the standing line owns the assumed sentence" whenever both arms are on:
 * one composer for one fact.
 *
 * ## What it never does
 *
 * It never edits the model's reply. The line is appended after it by the
 * final branch's one composer (`coverage/answer.ts` ·
 * `composeAnswerWithCoverage`), under the separator the limits block uses, and
 * only on a PROSE answer: a typed answer (`.outputSchema()`) is JSON, and the
 * builder refuses the line beside it — as it refuses the line beside
 * `.answerValidation()`, which judges exact bytes.
 */

import type { AnswerAssessment, AssessmentCheck, AssessmentReason } from './types.js';

/** Bumped whenever any word of the table below changes. */
export const STANDING_LINE_VERSION = 1;

/**
 * The line's first words, one per standing — the owner's words. They are
 * plain words a model can write too, so a reader of the answer text never
 * matches on them alone: the answer account finds the line by rebuilding the
 * WHOLE line from the run's record (`lib/answer-account/account.ts` ·
 * `readAnswer`, through `standingLineOf`).
 */
export const STANDING_LINE_OPENINGS: Readonly<Record<AnswerAssessment['standing'], string>> =
  Object.freeze({
    ask: 'Ask — ',
    'not-sure': 'Not sure — ',
    known: 'Known — ',
    consistent: "Consistent with the run's record — ",
    'not-assessed': 'Not assessed — ',
  });

/** The answer's standing as data — the projection filed on `turn_end` and on the event. */
export interface AnswerAssessmentData {
  readonly assessment: AnswerAssessment['assessment'];
  readonly standing: AnswerAssessment['standing'];
  readonly reasons: readonly AssessmentReason[];
  readonly checked: readonly {
    readonly layer: AnswerAssessment['checked'][number]['layer'];
    readonly check: AssessmentCheck;
    readonly ran: number;
    readonly of: number;
  }[];
}

/** One value a tool's rule assumed this turn — the "Assumed" block's line, as data. */
export interface StandingAssumedValue {
  readonly toolName: string;
  readonly argument: string;
  readonly value: string;
  readonly hidden: boolean;
}

/**
 * The projection of one fold — names, enums and counts only: the value, its
 * rendering, the reason KINDS and the checks that ran. No witness pointer, no
 * digest, no value.
 */
export function assessmentDataOf(a: AnswerAssessment): AnswerAssessmentData {
  return {
    assessment: a.assessment,
    standing: a.standing,
    reasons: a.reasons.map((r) => r.reason),
    checked: a.checked.map((c) => ({ layer: c.layer, check: c.check, ran: c.ran, of: c.of })),
  };
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const owns = (table: object, key: unknown): boolean =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);

const ASSESSMENTS: readonly AnswerAssessment['assessment'][] = [
  'known',
  'unrefuted',
  'unknown',
  'not-applicable',
];

// FOLD · the one reader of the standing as data off a RECORD (`turn_end.answerAssessment`)
// consumers read this and never re-derive it: lib/answer-account/account.ts · appendedStandingLine
/**
 * The standing as data read back off a record — `turn_end.answerAssessment`
 * as a recording holds it — or `undefined` unless every field is in this
 * version's vocabulary (a value, a standing with an opening, known reason
 * kinds, checks with counts). A fresh copy, field by field.
 */
export function assessmentDataFrom(value: unknown): AnswerAssessmentData | undefined {
  if (!isRecord(value)) return undefined;
  const { assessment, standing, reasons, checked } = value;
  if (!ASSESSMENTS.includes(assessment as AnswerAssessment['assessment'])) return undefined;
  if (!owns(STANDING_LINE_OPENINGS, standing)) return undefined;
  if (!Array.isArray(reasons)) return undefined;
  if (!reasons.every((r) => r === 'argument-assumed' || owns(REASON_WORDS, r))) return undefined;
  if (!Array.isArray(checked)) return undefined;
  const ran: AnswerAssessmentData['checked'][number][] = [];
  for (const c of checked as readonly unknown[]) {
    if (!isRecord(c) || !owns(CHECK_WORDS, c.check)) return undefined;
    const { layer, ran: count, of } = c;
    if (typeof layer !== 'number' || typeof count !== 'number' || typeof of !== 'number') {
      return undefined;
    }
    ran.push({
      layer: layer as AnswerAssessment['checked'][number]['layer'],
      check: c.check as AssessmentCheck,
      ran: count,
      of,
    });
  }
  return {
    assessment: assessment as AnswerAssessment['assessment'],
    standing: standing as AnswerAssessment['standing'],
    reasons: [...(reasons as readonly AssessmentReason[])],
    checked: ran,
  };
}

/**
 * Whether a before-tool rewrite with no declared origin fired
 * `argument-assumed` — the fold's witness that points at `middlewareDecisions`
 * rather than at a row. The line then names it once, without a value.
 */
export function rewrittenBehind(assessed: AnswerAssessment): boolean {
  return assessed.reasons.some(
    (r) =>
      r.reason === 'argument-assumed' &&
      r.witness.some((w) => w.kind === 'state' && w.key === 'middlewareDecisions'),
  );
}

/**
 * Where this turn's assumed values are read from: the ledger, the turn, and
 * the before-tool rewrites a row may have been superseded by — handed to the
 * "Assumed" block's own reader (`arguments/serve.ts` · `assumedLinesFor`),
 * which the caller loads: the answer layer's stage through `import()` (the
 * optional-family law), the answer account statically.
 */
export interface AssumedValuesSource {
  readonly ledger: readonly { readonly kind: string }[];
  readonly turn: number;
  readonly readDecisions: (() => readonly unknown[]) | undefined;
}

// FOLD · the one choice of what the line's assumed values are read from
// consumers read this and never re-derive it: assessment/stage.ts · assessAnswerStage (to compose
// the line), lib/answer-account/account.ts · appendedStandingLine (to find it again in the answer)
/**
 * The source of the line's assumed values in `record` (committed state) —
 * `undefined` when the line names none: no `argument-assumed` reason, no
 * turn, or no `argument` row. Rows that are not objects are passed over, so a
 * damaged record is read, never thrown on.
 */
export function assumedValuesSourceOf(
  reasons: readonly AssessmentReason[],
  record: Readonly<Record<string, unknown>>,
): AssumedValuesSource | undefined {
  if (!reasons.includes('argument-assumed')) return undefined;
  const turn = record.turnNumber;
  if (typeof turn !== 'number') return undefined;
  const rows: readonly unknown[] = Array.isArray(record.findingsLedger)
    ? record.findingsLedger
    : [];
  const ledger = rows.filter(
    (row): row is { readonly kind: string } => isRecord(row) && typeof row.kind === 'string',
  );
  if (!ledger.some((row) => row.kind === 'argument')) return undefined;
  const decisions = record.middlewareDecisions;
  return {
    ledger,
    turn,
    readDecisions: Array.isArray(decisions) ? () => decisions as readonly unknown[] : undefined,
  };
}

/**
 * How many reason clauses the line prints before it folds the rest into a
 * count. The assumed clauses are never counted and never cut: beside
 * `.limitsTravelWithTheAnswer()` the line REPLACES the "Assumed" block, which
 * prints every assumed value, so a cut there would drop a value the person
 * would otherwise have read. A fold's distinct reason kinds stay under the cap
 * on their own; it bounds a hand-built projection.
 */
const MAX_CLAUSES = 12;

const CHECK_WORDS: Readonly<Record<AssessmentCheck, string>> = {
  'argument-rules': 'argument rules',
  'argument-sources': 'argument sources',
  'tool-coverage': 'tool coverage',
  'result-shape': 'what came back',
  'result-period': 'the time each result covered',
  'names-and-numbers': 'names and numbers',
  'answer-checks': "the app's answer checks",
};

const REASON_WORDS: Readonly<Record<Exclude<AssessmentReason, 'argument-assumed'>, string>> = {
  asked: 'a question the run asked is still waiting for its answer',
  'argument-asked': 'the run asked you for values its calls need, and the answer has not come yet',
  'argument-unverified':
    'a value a call ran with came from the model, with no source on the record',
  'argument-read':
    'a value a call ran with was read into your words: the quoted words are on the record, the value is not in them',
  'value-contingent':
    'a value a call ran with was taken from a result the model itself had set aside',
  'coverage-gap': 'a tool said there is ground it did not check or cannot cover',
  'declared-absent': 'a tool said nothing matched',
  'empty-undeclared': 'a lookup came back empty without saying what it searched',
  'period-not-held': "a tool's data does not reach the time the question asked about",
  'period-partly-held': "a tool's data covers only part of the time the question asked about",
  'period-unknown': 'a tool could not say what time its data covers',
  'period-undeclared': 'a tool did not say what time its result covers',
  'period-differs-from-asked': 'a tool read a different stretch of time than the one asked about',
  'period-beyond-retention': 'the time asked about is older than a tool declares its source keeps',
  'sources-conflict': 'two results the answer stood on disagree',
  'value-unsupported': 'names or numbers in the answer appear in no tool result',
  'value-survived-revision':
    'names or numbers in the answer appear in no tool result, even after one revision',
  'derived-from-reading':
    "a time in the answer is the library's own spelling of your words, not something you said or a tool returned",
  'stopped-early': 'the run stopped before the model finished',
  'steps-unfinished': "the answer came before the skill's declared steps finished",
  'answer-check-failed': "the app's answer checks failed this answer",
  'check-unreachable': "the app's answer checks could not reach a verdict on this answer",
};

/** The clause for one assumed value — its value only in the tool's own view. */
function assumedClause(line: StandingAssumedValue): string {
  return line.hidden
    ? `${line.argument} was assumed by ${line.toolName}'s rule (its value is hidden by the tool's view), not given by you`
    : `${line.argument} = ${JSON.stringify(line.value)} was assumed by ${
        line.toolName
      }'s rule, not given by you`;
}

/** One clause per distinct (tool, argument, shown value), in the order the rows were filed. */
function assumedClauses(lines: readonly StandingAssumedValue[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = JSON.stringify([line.toolName, line.argument, line.hidden ? '' : line.value]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(assumedClause(line));
  }
  return out;
}

/** The "not sure" clauses, in the fold's reason order — every assumed one, the rest capped. */
function reasonClauses(
  data: AnswerAssessmentData,
  assumed: readonly StandingAssumedValue[],
  rewritten: boolean,
): string[] {
  const clauses: string[] = [];
  let counted = 0;
  let folded = 0;
  for (const reason of data.reasons) {
    if (reason === 'argument-assumed') {
      // Never cut (see MAX_CLAUSES): the line owns the assumed sentence.
      clauses.push(...assumedClauses(assumed));
      // A before-tool rewrite with no declared origin fires the same reason and
      // names no row the block would print: said once, without a value.
      if (rewritten || assumed.length === 0) {
        clauses.push(
          'a before-tool rule set a value a call ran with and did not say where it came from',
        );
      }
      continue;
    }
    if (counted < MAX_CLAUSES) {
      clauses.push(REASON_WORDS[reason]);
      counted += 1;
    } else {
      folded += 1;
    }
  }
  if (folded > 0) clauses.push(`… and ${folded} more (in the run record)`);
  return clauses;
}

// LENS · appended-answer · persistent-history
// reads: the standing as data (`assessmentDataOf` over the one fold) and this turn's assumed values
//        (`arguments/serve.ts` · `assumedLinesFor`, the "Assumed" block's own rows)
// law: may omit, never deny; says what the record holds, never that the answer is true.
/**
 * The standing line for one answer — `''` never: every standing has words.
 *
 * `assumed` is this turn's assumed values (empty unless the inputs layer filed
 * `default` rows); `rewritten` says a before-tool middleware rewrote a ruled
 * argument without declaring where the value came from (the fold's other
 * `argument-assumed` witness).
 *
 * @example
 * ```ts
 * standingLineOf(
 *   { assessment: 'unknown', standing: 'not-sure', reasons: ['argument-assumed'], checked: [] },
 *   [{ toolName: 'search_logs', argument: 'window', value: '2h', hidden: false }],
 *   false,
 * );
 * // 'Not sure — window = "2h" was assumed by search_logs\'s rule, not given by you.'
 * ```
 */
export function standingLineOf(
  data: AnswerAssessmentData,
  assumed: readonly StandingAssumedValue[],
  rewritten: boolean,
): string {
  const opening = STANDING_LINE_OPENINGS[data.standing];
  switch (data.standing) {
    case 'ask':
      return `${opening}the run stopped to ask a question before it could answer.`;
    case 'not-sure':
      return `${opening}${reasonClauses(data, assumed, rewritten).join('; ')}.`;
    case 'known':
      return `${opening}the app's answer checks passed this exact answer.`;
    case 'consistent': {
      const ran = data.checked.filter((c) => c.ran > 0).map((c) => CHECK_WORDS[c.check]);
      const names = [...new Set(ran)].join(' · ');
      return ran.length === 1
        ? `${opening}1 check ran and did not fire: ${names}. This is not a verification.`
        : `${opening}${ran.length} checks ran and none fired: ${names}. This is not a verification.`;
    }
    case 'not-assessed':
      return `${opening}no check applied to this answer.`;
  }
}
