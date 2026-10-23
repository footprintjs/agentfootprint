/**
 * search/served — what the MODEL reads for `checked: 'declared'` once the
 * funnel has composed it.
 *
 * Pattern: one pure projection.
 * Role:    semantics/ layer, pure.
 * Emits:   N/A.
 *
 * The typed fields and one static note — no new sentence. `checked` becomes
 * the composed items (each `what` plus its typed fields); the gaps the model
 * can act on ride `not_checked` / `cannot_cover` as plain items. Kept OFF what
 * the model reads, and on the record only:
 *
 *   • `complete` — a bare `true` beside "nothing found" invites "that's all
 *     there is"; the claim checker reads it from the row;
 *   • the `said` words (a checker's vocabulary) and `quote` (a statement
 *     writer's mark);
 *   • a long list's values — a 500-id population is served as ONE item, its
 *     count and the first {@link LIST_SHOWN} values quoted, so an empty
 *     result never costs the model a 50 KB message. The row keeps every value.
 *
 * An absence is served {@link ABSENCE_NOTE_COMPOSED}, not `ABSENCE_NOTE`: the
 * latter says "nothing was substituted for what was asked", which a declared
 * default — or an argument-unsent gap served beside it — contradicts. The
 * result is an ordinary absence (or ledger): every reader that predates
 * `search` reads it as one.
 */

import { ABSENCE_NOTE_COMPOSED } from '../absent.js';
import type { ComposedItem } from '../composedCoverage.js';
import type {
  CoveredResult,
  CoverageItem,
  DeclaredCoveredResult,
  DeclaredToolAbsence,
  ToolAbsence,
} from '../types.js';
import { valueText } from './facets.js';

/** A list longer than this is served as one item: its count and the first few values. */
export const LIST_SERVED_WHOLE = 5;
/** How many values of a collapsed list are shown. */
export const LIST_SHOWN = 3;
/** The longest one shown value, in characters (then `…`). */
const SHOWN_CHARS = 64;

/** One value as quoted data — one line, no backtick, capped. */
function quoted(value: unknown): string {
  const text = valueText(value)
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/`/g, "'")
    .trim();
  const points = Array.from(text);
  return `\`${points.length > SHOWN_CHARS ? `${points.slice(0, SHOWN_CHARS).join('')}…` : text}\``;
}

/** `<argument>: N values, first 3: `a`, `b`, `c`` — the collapsed item's words. */
function collapsedWhat(argument: string, values: readonly unknown[]): string {
  const shown = values.slice(0, LIST_SHOWN).map(quoted).join(', ');
  return `${argument}: ${values.length} values, first ${LIST_SHOWN}: ${shown}`;
}

/** One composed item as the model reads it — the record-only marks removed. */
export function servedItem(item: ComposedItem): Record<string, unknown> {
  if (Array.isArray(item.value) && item.value.length > LIST_SERVED_WHOLE) {
    return {
      what: collapsedWhat(item.argument ?? item.facet, item.value),
      facet: item.facet,
      ...(item.argument !== undefined && { argument: item.argument }),
      from: item.from,
      count: item.value.length,
    };
  }
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => key !== 'said' && key !== 'quote'),
  );
}

/**
 * The composed items as the model reads them: a run of more than
 * {@link LIST_SERVED_WHOLE} population items from one argument (a list sent)
 * becomes one item with its count.
 */
export function servedItems(items: readonly ComposedItem[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < items.length; ) {
    const head = items[i] as ComposedItem;
    let j = i + 1;
    while (
      j < items.length &&
      head.facet === 'population' &&
      head.argument !== undefined &&
      (items[j] as ComposedItem).argument === head.argument &&
      (items[j] as ComposedItem).facet === 'population' &&
      (items[j] as ComposedItem).from === head.from
    ) {
      j += 1;
    }
    const run = items.slice(i, j);
    if (run.length > LIST_SERVED_WHOLE) {
      out.push({
        what: collapsedWhat(
          head.argument as string,
          run.map((r) => r.value),
        ),
        facet: head.facet,
        argument: head.argument,
        from: head.from,
        count: run.length,
      });
    } else {
      out.push(...run.map(servedItem));
    }
    i = j;
  }
  return out;
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
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(holder)) {
    if (key === 'not_checked' || key === 'cannot_cover' || key === 'complete') continue;
    if (key !== 'checked') {
      out[key] = value;
      continue;
    }
    out.checked = servedItems(checked);
    if (lists.notChecked.length > 0) out.not_checked = lists.notChecked.map((i) => ({ ...i }));
    if (lists.cannotCover.length > 0) out.cannot_cover = lists.cannotCover.map((i) => ({ ...i }));
  }
  return out;
}

/** The composed ledger — `coverage(rows, { checked: 'declared' })` — with its result untouched. */
export function servedLedger(
  ledger: DeclaredCoveredResult,
  checked: readonly ComposedItem[],
  lists: PlainLists,
): CoveredResult {
  return {
    ...ledger,
    af_coverage: composedIn(ledger.af_coverage, checked, lists),
  } as unknown as CoveredResult;
}

/** The composed absence, keys in the order the tool minted them, with the composed note. */
export function servedAbsence(
  absence: DeclaredToolAbsence,
  checked: readonly ComposedItem[],
  lists: PlainLists,
): ToolAbsence {
  return {
    ...composedIn(absence, checked, lists),
    note: ABSENCE_NOTE_COMPOSED,
  } as unknown as ToolAbsence;
}
