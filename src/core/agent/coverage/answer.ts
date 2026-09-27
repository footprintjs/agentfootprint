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

import { mergeItems } from './items.js';
import type { Coverage, CoverageItem, DeclaredCoverage } from './types.js';

/** The block's opening line. Stable — tests and readers match on it. */
export const COVERAGE_BLOCK_HEADING = 'Coverage of this answer';

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
  const shown = items.slice(0, MAX_ENTRIES_PER_SECTION);
  const lines = shown.map((i) => `- ${i.what}${i.why !== undefined ? ` — ${i.why}` : ''}`);
  if (items.length > shown.length) {
    lines.push(`- … and ${items.length - shown.length} more (in the run record)`);
  }
  return `${label}:\n${lines.join('\n')}`;
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
 * Folded by the block's own rule — `mergeItems` over each list in declaration
 * order, duplicates dropped — so every entry is one the block would print and
 * none is added. It keeps EVERY entry: the block's cap (twelve per section,
 * then "… and N more") is a reading aid for prose, not a limit on the data.
 *
 * Fresh plain objects, copied field by field (`what`, `why`, and the
 * record-only `short` / `kind` when declared), never a reference into the rows
 * it was folded from — so the value can be committed, emitted and handed to a
 * caller as detached data. `undefined` when nothing was declared: the identity
 * case, the one every run whose tools declare nothing takes.
 */
export function coverageOfAnswer(declared: readonly DeclaredCoverage[]): Coverage | undefined {
  if (declared.length === 0) return undefined;
  const folded: Coverage = {
    checked: mergeItems(declared.map((d) => d.checked)).map(copyItem),
    notChecked: mergeItems(declared.map((d) => d.notChecked)).map(copyItem),
    cannotCover: mergeItems(declared.map((d) => d.cannotCover)).map(copyItem),
  };
  // The composer's second identity case, for the same reason: a hand-built row
  // that says nothing must not become a boundary that looks like one.
  const entries = folded.checked.length + folded.notChecked.length + folded.cannotCover.length;
  return entries > 0 ? folded : undefined;
}

/** A coverage value as detached plain data — the same three lists, every item copied. */
export function copyCoverage(value: Coverage): Coverage {
  return {
    checked: value.checked.map(copyItem),
    notChecked: value.notChecked.map(copyItem),
    cannotCover: value.cannotCover.map(copyItem),
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
 */
export function composeAnswerWithCoverage(
  answer: string,
  declared: readonly DeclaredCoverage[],
): string {
  if (declared.length === 0) return answer;
  const sections: string[] = [];
  for (const [key, label] of SECTIONS) {
    const items = mergeItems(declared.map((d) => d[key]));
    if (items.length > 0) sections.push(renderSection(label, items));
  }
  // Every declaration was empty in all three lists — impossible through the
  // two doors (both refuse a declaration that says nothing), but a hand-built
  // shape could arrive here, and appending an empty heading would be noise
  // pretending to be a boundary.
  if (sections.length === 0) return answer;
  const block =
    `${COVERAGE_BLOCK_HEADING} — declared by the tools that produced it, not by the model:` +
    `\n\n${sections.join('\n\n')}`;
  const body = answer.replace(/\s+$/, '');
  return body.length > 0 ? `${body}\n\n---\n\n${block}` : block;
}
