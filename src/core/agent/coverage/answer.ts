/**
 * answer — how a ledger survives into the final answer.
 *
 * Pattern: composed by the FRAMEWORK, not requested from the model. Pure
 *          function of the run's declarations; the stage that calls it is a
 *          two-line wrapper (see `stages/prepareFinal.ts`).
 * Role:    core/ layer, pure.
 * Emits:   N/A.
 *
 * ## Why this is an append and not a check
 *
 * A ledger the model can drop is worthless, and every mechanism that ASKS the
 * model to carry it can be dropped: a note in the tool result is advice, a
 * system-prompt rule is advice, and a judge that reads the answer back and
 * asks "did it state its limits?" needs a second model to decide what
 * counts — which would put a language judgement in the one place this library
 * refuses to put one (see `evidence/README.md`: the guard may not need a
 * bigger model than the thing it guards).
 *
 * So the limits are APPENDED. The model does not write them, so the model
 * cannot drop them, and the mechanism is a string concatenation over data the
 * tools declared — deterministic, auditable, and cheap. It changes the bytes
 * of the answer, which is why it is opt-in
 * (`.limitsTravelWithTheAnswer()`): an agent that never asks for it is
 * byte-identical.
 *
 * ## Why a TYPED answer gets the same fold as data, never the block
 *
 * An answer with an output schema is JSON, and JSON followed by prose is not
 * JSON — appending the block made `runTyped()` throw on every answer that had
 * limits. So when an output schema is configured the answer string stays the
 * model's own, and the same fold travels BESIDE it: `coverageOfAnswer` below,
 * committed as `AgentState.answerCoverage`. The model still cannot drop it —
 * the framework composes it from what the tools declared — and a person reads
 * it wherever the app draws it, not wherever the prose happened to end.
 *
 * ## Why an absence contributes too
 *
 * `absent()` and `coverage()` make the same kind of statement about the same
 * run. A search that found nothing in the fcns database really did cover the
 * fcns database, and a search that could not reach the archive really is a
 * limit on the answer. Folding both into one block is the only way the reader
 * gets ONE boundary instead of a boundary per tool — and duplicates are
 * dropped, so five tools naming the same missing collector say it once.
 */

import { copyInProgressItem, IN_PROGRESS_SECTION_LABEL, inProgressLine } from './inProgress.js';
import { mergeItems } from './items.js';
import { copyPeriod, periodLine, type DeclaredPeriod } from './period.js';
import type { BoundPresentation } from '../../time/present.js';
import type { Coverage, CoverageItem, DeclaredCoverage, InProgressItem } from './types.js';

/**
 * One declaring call's period, as the answer's limits carry it (honesty step
 * 7b) — the tool, the call, and the period AS DECLARED: the data twin of one
 * `Period:` line.
 *
 * @inline
 */
export interface AnswerPeriod extends DeclaredPeriod {
  readonly toolName: string;
  readonly toolCallId?: string;
}

/**
 * One declaring call's in-progress items, as the answer's limits carry them —
 * the tool, the call, and what its read found still running, as declared: the
 * data twin of that call's lines under "In progress (outcome not known yet)".
 *
 * @inline
 */
export interface AnswerInProgress {
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly items: readonly InProgressItem[];
}

/**
 * A TYPED answer's limits, as data — the three coverage lists the prose block
 * would print, plus the values a tool's `assume` rule filled this turn (the
 * inputs layer, honesty layer 2), which the prose answer prints as its
 * "Assumed" block. The value of `AgentState.answerCoverage`,
 * `turn_end.answerCoverage` and `agent.answerCoverage()`.
 *
 * `assumed` is the SAME reading of the SAME rows the block prints
 * (`arguments/serve.ts` · `assumedLinesFor`): one entry per distinct (tool,
 * argument, value), in the order the rows were filed, a row a before-tool
 * rewrite superseded left out. `value` is the tool's own argument view —
 * `'REDACTED'`, with `hidden: true`, when that view hides the argument.
 * Present only when a value was assumed. `periods` (honesty step 7b) is the
 * data twin of the block's `Period:` lines, present only when a call declared one.
 */
export interface AnswerCoverage extends Coverage {
  /** The periods the calls declared (honesty step 7b) — one per declaring
   *  call, as declared; present only when one did. */
  readonly periods?: readonly AnswerPeriod[];
  /** What the calls found still running — its outcome not known yet — one
   *  entry per declaring call, as declared; present only when one did. Never a
   *  reason on the answer's standing: a label that travels with the limits. */
  readonly inProgress?: readonly AnswerInProgress[];
  readonly assumed?: readonly {
    readonly toolName: string;
    readonly argument: string;
    readonly value: string;
    readonly hidden: boolean;
  }[];
}

/** One assumed value as `AnswerCoverage` carries it. */
type AssumedValue = NonNullable<AnswerCoverage['assumed']>[number];

/**
 * THE FOLD both answer forms share: each section merged ONCE across the run's
 * declarations — declaration order, duplicates dropped (`mergeItems`). The
 * block renders these lists (capped for the reader) and the data copies them
 * (uncapped), so the two cannot disagree about which items the answer's limits
 * hold: one rule, one place, two callers.
 */
function foldSections(declared: readonly DeclaredCoverage[]): Coverage {
  return {
    checked: mergeItems(declared.map((d) => d.checked)),
    notChecked: mergeItems(declared.map((d) => d.notChecked)),
    cannotCover: mergeItems(declared.map((d) => d.cannotCover)),
  };
}

/** The block's opening line. Stable — tests and readers match on it. */
export const COVERAGE_BLOCK_HEADING = 'Coverage of this answer';

/**
 * The inputs layer's "Assumed" block's opening line (`arguments/serve.ts` ·
 * `assumedBlock` composes the block). Owned here, beside the limits block's
 * heading: this module's `composeAnswerWithCoverage` is the one composer of
 * the section the framework appends after an answer, and a reader of the
 * answer's text (`lib/answer-account/account.ts` · `readAnswer`) finds every
 * block of it through this one module. Stable — tests and readers match on it.
 */
export const ASSUMED_BLOCK_HEADING = "Assumed (a tool's rule, not your words):";

/**
 * Entries per section before the block folds. A boundary nobody reads is not
 * a boundary; the run record keeps every entry either way (the
 * `tools.coverage_declared` / `tools.absent` events), so folding costs
 * nothing but the reader's patience.
 */
const MAX_ENTRIES_PER_SECTION = 12;

const SECTIONS = [
  ['checked', 'Checked'],
  ['notChecked', 'Not checked'],
  ['cannotCover', 'Cannot cover'],
] as const;

function renderSection(label: string, items: readonly CoverageItem[]): string {
  return renderLines(
    label,
    items.map((i) => `${i.what}${i.why !== undefined ? ` — ${i.why}` : ''}`),
  );
}

/** One labelled section of `- line` bullets, folded after the cap like every section. */
function renderLines(label: string, texts: readonly string[]): string {
  const shown = texts.slice(0, MAX_ENTRIES_PER_SECTION);
  const lines = shown.map((text) => `- ${text}`);
  if (texts.length > shown.length) {
    lines.push(`- … and ${texts.length - shown.length} more (in the run record)`);
  }
  return `${label}:\n${lines.join('\n')}`;
}

/** The section heading the periods print under (honesty step 7b). Stable — readers match on it. */
export const PERIOD_SECTION_LABEL = 'Period';

/**
 * The periods the run's declarations carried, one per DECLARING call and
 * distinct period, in declaration order — a call whose `coverage()` and inner
 * `absent()` declared the same period says it once. Fresh plain objects.
 */
function periodsOf(declared: readonly DeclaredCoverage[]): AnswerPeriod[] {
  const out: AnswerPeriod[] = [];
  const seen = new Set<string>();
  for (const row of declared) {
    if (row.period === undefined) continue;
    const key = JSON.stringify([row.toolCallId ?? '', row.toolName, row.period]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      toolName: row.toolName,
      ...(row.toolCallId !== undefined && { toolCallId: row.toolCallId }),
      ...copyPeriod(row.period),
    });
  }
  return out;
}

/**
 * The in-progress items the run's declarations carried, one entry per
 * DECLARING call, in declaration order. Fresh plain objects.
 */
function inProgressOf(declared: readonly DeclaredCoverage[]): AnswerInProgress[] {
  const out: AnswerInProgress[] = [];
  for (const row of declared) {
    if (row.inProgress === undefined || row.inProgress.length === 0) continue;
    out.push({
      toolName: row.toolName,
      ...(row.toolCallId !== undefined && { toolCallId: row.toolCallId }),
      items: row.inProgress.map(copyInProgressItem),
    });
  }
  return out;
}

// reads: scope.coverageDeclared ← read by ../stages/answerCoverage.ts · withAnswerCoverage, on the Route decider's
//        terminal decision, and only when the answer is TYPED — the data twin of `composeAnswerWithCoverage`, below.
/**
 * The run's declarations folded into the ANSWER's coverage — the three lists
 * `composeAnswerWithCoverage` renders, as data.
 *
 * `.limitsTravelWithTheAnswer()` on a typed answer (`.outputSchema()`): the
 * answer string has to stay the model's JSON for `runTyped()` to parse it, so
 * the limits travel beside it instead of inside it — this value, committed as
 * `AgentState.answerCoverage`, projected onto `turn_end.answerCoverage` and
 * returned by `agent.answerCoverage()`.
 *
 * Folded by the block's own fold (`foldSections`, the one place each list is
 * merged — declaration order, duplicates dropped), so every entry is one the
 * block would print and none is added. It keeps EVERY entry: the block's cap
 * (twelve per section, then "… and N more") is a reading aid for prose, not a
 * limit on the data.
 *
 * Fresh plain objects, copied field by field (`what`, `why`, and the
 * record-only `short` / `kind` when declared), never a reference into the rows
 * it was folded from — so the value can be committed, emitted and handed to a
 * caller as detached data. `undefined` when nothing was declared: the identity
 * case, the one every run whose tools declare nothing takes.
 */
export function coverageOfAnswer(
  declared: readonly DeclaredCoverage[],
): AnswerCoverage | undefined {
  if (declared.length === 0) return undefined;
  // The periods the calls declared (honesty step 7b) — the data twin of the
  // block's `Period:` lines; the key only when one was declared, so a run whose
  // tools declared none commits the value it always did.
  const periods = periodsOf(declared);
  // What the calls found still running — the data twin of the block's
  // "In progress" lines; the key only when a call declared some.
  const inProgress = inProgressOf(declared);
  const sections = copyCoverage(foldSections(declared));
  const folded: AnswerCoverage = {
    ...sections,
    ...(periods.length > 0 && { periods }),
    ...(inProgress.length > 0 && { inProgress }),
  };
  // The composer's second identity case, for the same reason: a hand-built row
  // that says nothing must not become a boundary that looks like one.
  const entries =
    folded.checked.length +
    folded.notChecked.length +
    folded.cannotCover.length +
    periods.length +
    inProgress.length;
  return entries > 0 ? folded : undefined;
}

/**
 * A typed answer's limits as ONE value: the folded coverage (or three empty
 * lists) and the values assumed this turn, `assumed` present only when one
 * was. `undefined` when there is neither — the identity case, so a run whose
 * tools declared nothing and assumed nothing commits exactly the keys it
 * always did.
 */
export function answerCoverageOf(
  folded: AnswerCoverage | undefined,
  assumed: readonly AssumedValue[],
): AnswerCoverage | undefined {
  if (folded === undefined && assumed.length === 0) return undefined;
  const base = folded ?? { checked: [], notChecked: [], cannotCover: [] };
  return assumed.length > 0 ? { ...base, assumed: assumed.map(copyAssumed) } : base;
}

/** A coverage value as detached plain data — the same three lists, every item copied. */
export function copyCoverage(value: Coverage): Coverage {
  return {
    checked: value.checked.map(copyItem),
    notChecked: value.notChecked.map(copyItem),
    cannotCover: value.cannotCover.map(copyItem),
  };
}

/** A typed answer's limits as detached plain data — the lists and any assumed values, copied. */
export function copyAnswerCoverage(value: AnswerCoverage): AnswerCoverage {
  return {
    ...copyCoverage(value),
    ...(value.periods !== undefined && { periods: value.periods.map(copyAnswerPeriod) }),
    ...(value.inProgress !== undefined && {
      inProgress: value.inProgress.map((entry) => ({
        toolName: entry.toolName,
        ...(entry.toolCallId !== undefined && { toolCallId: entry.toolCallId }),
        items: entry.items.map(copyInProgressItem),
      })),
    }),
    ...(value.assumed !== undefined && { assumed: value.assumed.map(copyAssumed) }),
  };
}

/** One declared period as the answer carries it, as detached plain data. */
function copyAnswerPeriod(p: AnswerPeriod): AnswerPeriod {
  return {
    toolName: p.toolName,
    ...(p.toolCallId !== undefined && { toolCallId: p.toolCallId }),
    ...copyPeriod(p),
  };
}

/** One assumed value as detached plain data. */
function copyAssumed(line: AssumedValue): AssumedValue {
  return {
    toolName: line.toolName,
    argument: line.argument,
    value: line.value,
    hidden: line.hidden,
  };
}

/** One entry as detached plain data: the fields a coverage item declares, nothing else. */
function copyItem(item: CoverageItem): CoverageItem {
  return {
    what: item.what,
    ...(item.why !== undefined && { why: item.why }),
    ...(item.short !== undefined && { short: item.short }),
    ...(item.kind !== undefined && { kind: item.kind }),
  };
}

// LENS · injected-turn · persistent-history
// reads: scope.coverageDeclared ← read once by ../stages/prepareFinal.ts · captureTurnPayload — the ONE reader that COMPOSES from it,
//        folded and capped (a typed answer never reaches it: its data twin is `coverageOfAnswer`, above). Not the only read
//        of the key: ../stages/toolCalls.ts · declareCoverage reads it to append to it,
//        and ../findings/unsettled.ts · withUnsettledRows (9.113.0) reads one call's rows for their `kind` — the witness
//        that the tool returned an absence — and composes nothing from them (its row's words come from the served result).
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * Fold the run's declarations into one block and append it to the answer.
 *
 * Returns the answer UNCHANGED when nothing was declared — the identity case
 * matters, because it is the one every agent that never returns a coverage
 * shape takes.
 *
 * `standing` (the answer layer, honesty layer 4, under
 * `.answerLayer({ standingLine: true })`) is the answer's standing as one
 * already-composed line (`assessment/compose.ts` · `standingLineOf`); it opens
 * the section, and while it is on the caller passes no `assumed` block — the
 * line names the assumed values itself (one composer for one fact).
 *
 * `assumed` (the inputs layer, honesty layer 2) is a second, already-composed
 * block — the values a tool's `assume` rule filled this turn
 * (`arguments/serve.ts` · `assumedBlock`) — appended after the coverage block
 * under the same separator. With neither declarations nor an assumed block the
 * answer is unchanged, byte for byte.
 *
 * `presentation` (the time layer, only under `.time()`) is the run's clock
 * zone: each `Period:` line renders its instants there, the zone named
 * (`period.ts` · `periodLine`). Absent → the lines are the declared instants
 * verbatim, as they always were.
 */
export function composeAnswerWithCoverage(
  answer: string,
  declared: readonly DeclaredCoverage[],
  assumed = '',
  standing = '',
  presentation?: BoundPresentation,
): string {
  const blocks: string[] = [];
  // The answer layer's standing line (honesty layer 4, its own opt-in arm)
  // opens the section: it is the headline a person reads first. When it is
  // on, the caller passes no "Assumed" block — the line owns that sentence
  // (one composer for one fact).
  if (standing !== '') blocks.push(standing);
  const coverage = coverageBlock(declared, presentation);
  if (coverage !== '') blocks.push(coverage);
  if (assumed !== '') blocks.push(assumed);
  if (blocks.length === 0) return answer;
  const body = answer.replace(/\s+$/, '');
  const joined = blocks.join('\n\n');
  return body.length > 0 ? `${body}\n\n---\n\n${joined}` : joined;
}

/** The coverage block alone — `''` when the declarations say nothing. */
function coverageBlock(
  declared: readonly DeclaredCoverage[],
  presentation: BoundPresentation | undefined,
): string {
  if (declared.length === 0) return '';
  const folded = foldSections(declared);
  const sections: string[] = [];
  for (const [key, label] of SECTIONS) {
    const items = folded[key];
    if (items.length > 0) sections.push(renderSection(label, items));
  }
  // One `Period:` line per declaring call (honesty step 7b) — the period AS
  // THE TOOL DECLARED IT (`period.ts` · `periodLine`). No period declared →
  // no section, and the block is the bytes it always was.
  const periods = periodsOf(declared);
  if (periods.length > 0) {
    sections.push(
      renderLines(
        PERIOD_SECTION_LABEL,
        periods.map((p) => periodLine(p.toolName, p, presentation)),
      ),
    );
  }
  // What the calls found still running — one line per item, tool first, as
  // declared (`inProgress.ts` · `inProgressLine`). None declared → no section,
  // and the block is the bytes it always was.
  const inProgress = inProgressOf(declared);
  if (inProgress.length > 0) {
    sections.push(
      renderLines(
        IN_PROGRESS_SECTION_LABEL,
        inProgress.flatMap((entry) => entry.items.map((i) => inProgressLine(entry.toolName, i))),
      ),
    );
  }
  // Every declaration was empty in all three lists — impossible through the
  // two doors (both refuse a declaration that says nothing), but a hand-built
  // shape could arrive here, and appending an empty heading would be noise
  // pretending to be a boundary.
  if (sections.length === 0) return '';
  return (
    `${COVERAGE_BLOCK_HEADING} — declared by the tools that produced it, not by the model:` +
    `\n\n${sections.join('\n\n')}`
  );
}
