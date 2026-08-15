/**
 * coverage/items — normalizing and refusing coverage lists.
 *
 * Pattern: one validator, two doors (`absent()` and `coverage()`), so the two
 *          primitives cannot disagree about what a well-formed piece of
 *          ground looks like.
 * Role:    core/ layer, pure. Throws at the CALL SITE (the
 *          `resolveEvidenceGate` precedent): a malformed declaration is a
 *          mistake in the line the author just wrote, and the stack should
 *          say so — not fail on the first absence of the first incident.
 * Emits:   N/A.
 */

import type { CoverageInput, CoverageItem } from './types.js';

/** Section names, as the author spells them — used verbatim in refusals. */
export type CoverageSection = 'checked' | 'notChecked' | 'cannotCover';

const isPlainString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Normalize one author list into {@link CoverageItem}s, refusing anything a
 * reader could not act on.
 *
 * `requireWhy` is true only for `cannotCover`. The asymmetry is deliberate:
 * "we checked the fcns database" and "we did not check the archive" are
 * complete statements on their own, but "this tool can never see host-side
 * multipathing" is a claim about capability — and a permanent blind spot with
 * no reason attached cannot be acted on, escalated, or disproved. It is also
 * the one an operator is most likely to want to fix, so the reason is the
 * useful half.
 */
export function normalizeCoverageList(
  fn: string,
  section: CoverageSection,
  list: readonly CoverageInput[] | undefined,
  requireWhy: boolean,
): readonly CoverageItem[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    throw new Error(
      `${fn}: \`${section}\` must be an array of strings or { what, why } entries — to say ` +
        `nothing about it, omit the field (absent means "not declared", never "nothing there").`,
    );
  }
  const items: CoverageItem[] = [];
  list.forEach((raw, i) => {
    const at = `${section}[${i}]`;
    if (isPlainString(raw)) {
      if (requireWhy) {
        throw new Error(
          `${fn}: ${at} is '${raw.trim()}' with no reason. Every \`cannotCover\` entry needs a ` +
            `\`why\` — a blind spot this tool can NEVER see is a claim about what it is, and a ` +
            `reader cannot act on, escalate or disprove a claim with no reason. Write ` +
            `{ what: '${raw.trim()}', why: '…' }, or move it to \`notChecked\` if a wider ` +
            `call could reach it.`,
        );
      }
      items.push({ what: raw.trim() });
      return;
    }
    if (typeof raw !== 'object' || raw === null || !isPlainString((raw as CoverageItem).what)) {
      throw new Error(
        `${fn}: ${at} names no ground. Each entry is either a non-empty string or ` +
          `{ what, why } — what a reader has to know is WHICH source, window or population ` +
          `this is about.`,
      );
    }
    const item = raw as CoverageItem;
    const why = item.why;
    if (why !== undefined && !isPlainString(why)) {
      throw new Error(
        `${fn}: ${at} ('${item.what.trim()}') has a \`why\` that says nothing. Give it a ` +
          `reason or omit the field.`,
      );
    }
    if (requireWhy && why === undefined) {
      throw new Error(
        `${fn}: ${at} ('${item.what.trim()}') has no \`why\`. Every \`cannotCover\` entry ` +
          `needs one — see the entry above this line in the docs for why a permanent blind ` +
          `spot must say what makes it permanent.`,
      );
    }
    items.push({ what: item.what.trim(), ...(why !== undefined && { why: why.trim() }) });
  });
  return items;
}

/** Two entries are the same ground when they say the same two things. Used to
 *  fold the run's declarations into ONE answer-level block: five tools that
 *  all name the same missing collector should say it once. */
export function sameItem(a: CoverageItem, b: CoverageItem): boolean {
  return a.what === b.what && (a.why ?? '') === (b.why ?? '');
}

/** Merge lists in declaration order, dropping repeats. Order is the run's own
 *  order on purpose — it is the only ordering that means anything here. */
export function mergeItems(lists: ReadonlyArray<readonly CoverageItem[]>): readonly CoverageItem[] {
  const out: CoverageItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!out.some((seen) => sameItem(seen, item))) out.push(item);
    }
  }
  return out;
}
