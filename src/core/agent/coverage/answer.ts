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
import type { CoverageItem, DeclaredCoverage } from './types.js';

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
