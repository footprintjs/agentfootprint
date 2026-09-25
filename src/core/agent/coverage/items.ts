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

import { isDevMode } from 'footprintjs';

import type { CoverageInput, CoverageItem } from './types.js';

/** Section names, as the author spells them — used verbatim in refusals. */
export type CoverageSection = 'checked' | 'notChecked' | 'cannotCover';

const isPlainString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

// ── The record-only extras: `short` and `kind` ─────────────────────────────
//
// ONE rule set, two doors. `normalizeCoverageList` (the `absent()` /
// `coverage()` mint) THROWS on a fault, at the line the author just wrote;
// `readItemExtras` (every envelope the dispatch door reads, including one a
// Python sidecar minted) DROPS a faulty value — read, never repaired, the
// `tryInsteadOfAbsence` law — with one dev warning per tool. The two cannot
// disagree about what a valid value is, because both ask the functions below.

/** The closed kind vocabulary — `CoverageItem.kind`, named for this file. */
export type CoverageKind = NonNullable<CoverageItem['kind']>;

/** The longest `short` a report prints on one line. */
export const MAX_SHORT_CHARS = 80;

/** The closed `kind` vocabulary, tied to {@link CoverageKind}: a member the
 *  union gains, or one listed here it does not have, fails to compile. */
const COVERAGE_KINDS: readonly string[] = Object.keys({
  existence: true,
  scope: true,
} satisfies Record<CoverageKind, true>);

/** The item keys that are RECORD-ONLY — never served to the model, never
 *  evidence. `read.ts` · `servedToModel` and `evidence.ts` remove these. */
export const RECORD_ONLY_ITEM_KEYS: readonly string[] = ['short', 'kind'];

/** What is wrong with a `short`, or `undefined` when it is fine. `what` is the
 *  item's own (trimmed) `what`. */
function shortProblem(short: unknown, what: string): string | undefined {
  if (typeof short !== 'string' || short.trim() === '') {
    return '`short` must be a non-empty string — or omit it; the report then prints `what`.';
  }
  const s = short.trim();
  if (/[\r\n]/.test(s)) return '`short` must be one line.';
  if (s.length > MAX_SHORT_CHARS) {
    return `\`short\` is ${s.length} characters; the limit is ${MAX_SHORT_CHARS}.`;
  }
  if (s.length > what.length) {
    return '`short` is longer than `what` — a short form restates `what` in fewer words.';
  }
  return undefined;
}

/** What is wrong with a `kind` in `section`, or `undefined` when it is fine. */
function kindProblem(kind: unknown, section: CoverageSection): string | undefined {
  if (section === 'checked') {
    return (
      '`kind` is refused on `checked` — it says what kind of ground was NOT reached ' +
      "('existence' or 'scope'), so it belongs on `notChecked` or `cannotCover`."
    );
  }
  if (typeof kind !== 'string' || !COVERAGE_KINDS.includes(kind)) {
    return `\`kind\` must be one of ${COVERAGE_KINDS.map((k) => `'${k}'`).join(', ')}.`;
  }
  return undefined;
}

/** The record-only extras a well-formed item may carry. */
export interface CoverageItemExtras {
  readonly short?: string;
  readonly kind?: CoverageKind;
}

/** Declared = an own key holding a value. `null` reads as omitted: a JSON
 *  producer writes a missing optional value as `null` (Python's `None`). */
const has = (item: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(item, key) && (item as Record<string, unknown>)[key] != null;

/** Tools already warned about a dropped extra — one warning per tool name. */
const warnedTools = new Set<string>();

/**
 * The item's `short` / `kind`, when each is valid — the NON-throwing reader
 * every dispatch door uses (`../stages/toolCalls.ts` · `declareCoverage`'s
 * copy), so the event and the tracked row carry the same fields.
 *
 * An invalid value is DROPPED, never repaired, and named once per tool in dev
 * mode: an envelope minted elsewhere (a Python sidecar, a hand-built value)
 * is read as found, and the absence it carries is still an absence either
 * way. `{}` when the item declares neither — so a spread of it adds no key.
 */
export function readItemExtras(
  item: unknown,
  section: CoverageSection,
  toolName?: string,
): CoverageItemExtras {
  if (typeof item !== 'object' || item === null) return {};
  const rec = item as Record<string, unknown>;
  const wantsShort = has(rec, 'short');
  const wantsKind = has(rec, 'kind');
  if (!wantsShort && !wantsKind) return {};
  const what = typeof rec.what === 'string' ? rec.what.trim() : '';
  const problems: string[] = [];
  let short: string | undefined;
  let kind: CoverageKind | undefined;
  if (wantsShort) {
    const problem = shortProblem(rec.short, what);
    if (problem === undefined) short = (rec.short as string).trim();
    else problems.push(problem);
  }
  if (wantsKind) {
    const problem = kindProblem(rec.kind, section);
    if (problem === undefined) kind = rec.kind as CoverageKind;
    else problems.push(problem);
  }
  const [firstProblem] = problems;
  if (firstProblem !== undefined) warnDroppedExtra(toolName, section, firstProblem);
  return { ...(short !== undefined && { short }), ...(kind !== undefined && { kind }) };
}

function warnDroppedExtra(toolName: string | undefined, section: string, problem: string): void {
  const key = toolName ?? '';
  if (warnedTools.has(key) || !isDevMode()) return;
  warnedTools.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint coverage: tool '${toolName ?? '(unknown)'}' declared a ${section} item ` +
      `the record cannot carry, so that field was dropped (the item itself is kept): ` +
      `${problem} This warning fires once per tool.`,
  );
}

/**
 * One coverage list with the record-only keys removed from every item that
 * has one — the SAME reference when no item has one (the zero-cost law: a
 * run whose tools declare neither serves exactly the value it always did).
 * Anything that is not an array, and any item that is not an object, is left
 * as found.
 */
export function listWithoutRecordOnly(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  const carries = (i: unknown): boolean =>
    typeof i === 'object' &&
    i !== null &&
    RECORD_ONLY_ITEM_KEYS.some((k) => Object.prototype.hasOwnProperty.call(i, k));
  if (!list.some(carries)) return list;
  return list.map((i: unknown) =>
    carries(i)
      ? Object.fromEntries(
          Object.entries(i as Record<string, unknown>).filter(
            ([key]) => !RECORD_ONLY_ITEM_KEYS.includes(key),
          ),
        )
      : i,
  );
}

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
    const what = item.what.trim();
    // The record-only extras, refused HERE by the same rules the dispatch
    // door reads them by (`readItemExtras`). `null`/`undefined` = omitted.
    const short = item.short == null ? undefined : item.short;
    const kind = item.kind == null ? undefined : item.kind;
    const shortFault = short === undefined ? undefined : shortProblem(short, what);
    if (shortFault !== undefined) throw new Error(`${fn}: ${at} ('${what}') — ${shortFault}`);
    const kindFault = kind === undefined ? undefined : kindProblem(kind, section);
    if (kindFault !== undefined) throw new Error(`${fn}: ${at} ('${what}') — ${kindFault}`);
    items.push({
      what,
      ...(why !== undefined && { why: why.trim() }),
      ...(short !== undefined && { short: short.trim() }),
      ...(kind !== undefined && { kind }),
    });
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

/** The three coverage lists as the WIRE spells them — an absence's, a
 *  ledger's `af_coverage` and a semantic envelope's `coverage`. */
const WIRE_LISTS = ['checked', 'not_checked', 'cannot_cover'] as const;

/**
 * `holder` (an envelope or a ledger marker) with each wire list stripped of
 * the record-only keys — the SAME reference when none of its lists carried
 * one. The one helper `read.ts` · `servedToModel` (what the model is served)
 * and `evidence.ts` (what may ground) both use, so the two cannot disagree
 * about which keys are record-only.
 */
export function listsWithoutRecordOnly<T extends object>(holder: T): T {
  let out: Record<string, unknown> | undefined;
  for (const key of WIRE_LISTS) {
    const list = (holder as Record<string, unknown>)[key];
    const kept = listWithoutRecordOnly(list);
    if (kept === list) continue;
    out = out ?? { ...(holder as Record<string, unknown>) };
    out[key] = kept;
  }
  return (out as T | undefined) ?? holder;
}
