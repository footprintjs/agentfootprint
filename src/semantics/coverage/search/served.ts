/**
 * search/served — what the MODEL reads for `absent({ checked: 'declared' })`
 * once the funnel has composed it.
 *
 * Pattern: one pure projection.
 * Role:    semantics/ layer, pure.
 * Emits:   N/A.
 *
 * The typed fields and the one static note — no new sentence. `checked`
 * becomes the composed items (each `what` plus its typed fields); the gaps
 * the model can act on ride `not_checked` / `cannot_cover` as plain items;
 * `complete` says whether the tool's declaration lets this call stand for the
 * whole population, filters and period in effect. Two record-only marks never
 * reach the model: the `said` words (a checker's vocabulary) and `quote` (a
 * statement writer's instruction). The result is an ordinary absence: every
 * reader that predates `search` — the recognizer, the evidence corpus, the
 * emptiness reader — reads it as one.
 */

import type { ComposedItem } from '../composedCoverage.js';
import type {
  CoveredResult,
  CoverageItem,
  DeclaredCoveredResult,
  DeclaredToolAbsence,
  ToolAbsence,
} from '../types.js';

/** One composed item as the model reads it. */
export function servedItem(item: ComposedItem): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => key !== 'said' && key !== 'quote'),
  );
}

/** The two plain lists composition writes beside `checked`. */
interface PlainLists {
  readonly notChecked: readonly CoverageItem[];
  readonly cannotCover: readonly CoverageItem[];
}

/** One declaring object with `checked` composed in place, keys in the minted order. */
function composedIn(
  holder: Readonly<Record<string, unknown>>,
  checked: readonly ComposedItem[],
  lists: PlainLists,
  complete: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(holder)) {
    if (key === 'not_checked' || key === 'cannot_cover' || key === 'complete') continue;
    if (key !== 'checked') {
      out[key] = value;
      continue;
    }
    out.checked = checked.map(servedItem);
    if (lists.notChecked.length > 0) out.not_checked = lists.notChecked.map((i) => ({ ...i }));
    if (lists.cannotCover.length > 0) out.cannot_cover = lists.cannotCover.map((i) => ({ ...i }));
    out.complete = complete;
  }
  return out;
}

/** The composed ledger — `coverage(rows, { checked: 'declared' })` — with its result untouched. */
export function servedLedger(
  ledger: DeclaredCoveredResult,
  checked: readonly ComposedItem[],
  lists: PlainLists,
  complete: boolean,
): CoveredResult {
  return {
    ...ledger,
    af_coverage: composedIn(ledger.af_coverage, checked, lists, complete),
  } as unknown as CoveredResult;
}

/** The composed absence, keys in the order the tool minted them. */
export function servedAbsence(
  absence: DeclaredToolAbsence,
  checked: readonly ComposedItem[],
  lists: PlainLists,
  complete: boolean,
): ToolAbsence {
  return composedIn(absence, checked, lists, complete) as unknown as ToolAbsence;
}
