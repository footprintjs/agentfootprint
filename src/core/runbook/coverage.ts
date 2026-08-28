/**
 * runbook/coverage — the spine's ledger: inner folds + chart-declared
 * entries + the bridge's own, and the sentence naming the rules.
 *
 * Pattern: pure fold over three sources, reusing the coverage primitives'
 *          own recognizer and merge — no second grammar.
 * Role:    core/runbook.
 * Emits:   N/A.
 *
 * The three sources, in the order they land:
 *   1. INNER LEDGERS — every recorded inner call's result is read by the
 *      same `readCoverageResult` funnel the dispatch loop uses, and its
 *      three lists fold upward. An inner tool's honesty is carried, never
 *      re-authored.
 *   2. THE CHART'S OWN — the procedure states run-specific coverage by
 *      writing a `coverage` state key (`{ checked?, not_checked?,
 *      cannot_cover? }`, items as `{what, why?}` bags or bare strings).
 *      This is the app's vocabulary (which counters mean "not assessed" is
 *      the chart's to know); the ENVELOPE is the bridge's.
 *   3. THE BRIDGE'S OWN — one `checked` entry naming the procedure, its
 *      recorded step count and the rule set it ran under; and, for a
 *      verdict-shaped runbook, a `not_checked` entry counting DECLINED rows
 *      (the three-outcome honesty: a row that reached no classification is
 *      ground the answer does not cover).
 */

import { readCoverageResult } from '../agent/coverage/read.js';
import { mergeItems } from '../agent/coverage/items.js';
import { COVERAGE_NOTE } from '../agent/coverage/ledger.js';
import type { CoverageItem } from '../agent/coverage/types.js';
import type { InnerCallRecord } from './dispatch.js';
import type { RunbookRules } from './types.js';

/** The three lists, mid-fold. */
export interface LedgerLists {
  readonly checked: readonly CoverageItem[];
  readonly notChecked: readonly CoverageItem[];
  readonly cannotCover: readonly CoverageItem[];
}

const EMPTY: LedgerLists = { checked: [], notChecked: [], cannotCover: [] };

/** Fold every recorded inner call's declared coverage upward. */
export function foldInnerCoverage(records: readonly InnerCallRecord[]): LedgerLists {
  const checked: (readonly CoverageItem[])[] = [];
  const notChecked: (readonly CoverageItem[])[] = [];
  const cannotCover: (readonly CoverageItem[])[] = [];
  for (const record of records) {
    if (record.result === undefined) continue;
    const reading = readCoverageResult(record.result);
    for (const declared of reading?.declared ?? []) {
      checked.push(declared.coverage.checked);
      notChecked.push(declared.coverage.notChecked);
      cannotCover.push(declared.coverage.cannotCover);
    }
  }
  return {
    checked: mergeItems(checked),
    notChecked: mergeItems(notChecked),
    cannotCover: mergeItems(cannotCover),
  };
}

/** One list off the chart's `coverage` state key, normalized leniently —
 *  this is state the chart wrote, not a foreign wire; a malformed entry is
 *  dropped rather than refused (the run already happened). */
function stateList(value: unknown): CoverageItem[] {
  if (!Array.isArray(value)) return [];
  const items: CoverageItem[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim() !== '') {
      items.push({ what: entry.trim() });
    } else if (
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as { what?: unknown }).what === 'string'
    ) {
      const what = (entry as { what: string }).what;
      const why = (entry as { why?: unknown }).why;
      items.push({ what, ...(typeof why === 'string' && { why }) });
    }
  }
  return items;
}

/** The chart-declared lists, read off the final state's `coverage` key.
 *  Accepts both spellings of the two-word keys (state is often snake_case,
 *  the declaration camelCase) — one reader, no drift. */
export function chartCoverageOf(state: Readonly<Record<string, unknown>>): LedgerLists {
  const bag = state.coverage;
  if (bag === null || typeof bag !== 'object' || Array.isArray(bag)) return EMPTY;
  const rec = bag as Record<string, unknown>;
  return {
    checked: stateList(rec.checked),
    notChecked: stateList(rec.not_checked ?? rec.notChecked),
    cannotCover: stateList(rec.cannot_cover ?? rec.cannotCover),
  };
}

/** What the composed ledger needs to know about this run. */
export interface LedgerFacts {
  readonly chartName: string;
  readonly stepsExecuted: number;
  readonly rules?: RunbookRules;
  /** Rowset facts — present only for a verdict-shaped runbook. */
  readonly rowsTotal?: number;
  readonly declinedRows?: number;
}

/** The composed `af_coverage` value: three merged lists + the static law
 *  note + this run's own sentence. */
export interface ComposedLedger {
  readonly checked?: readonly CoverageItem[];
  readonly not_checked?: readonly CoverageItem[];
  readonly cannot_cover?: readonly CoverageItem[];
  readonly note: string;
  readonly sentence: string;
}

/** The rules clause every sentence carries — or the honest silence. */
function rulesClause(rules: RunbookRules | undefined): string {
  return rules !== undefined ? ` under ${rules.name} ${rules.version}` : '';
}

/** Compose the whole ledger. Inner folds land first, chart-declared second,
 *  the bridge's own last — provenance order, so a reader meets the sources
 *  before the summary. */
export function composeLedger(
  inner: LedgerLists,
  chart: LedgerLists,
  facts: LedgerFacts,
): ComposedLedger {
  const own: CoverageItem[] = [
    {
      what:
        `the declared procedure '${facts.chartName}' — ${facts.stepsExecuted} step(s) ` +
        `recorded${rulesClause(facts.rules)}`,
      ...(facts.rowsTotal !== undefined && {
        why: `${facts.rowsTotal} row(s) assessed, one decider pass per row`,
      }),
    },
  ];
  const declinedEntries: CoverageItem[] =
    facts.declinedRows !== undefined && facts.declinedRows > 0
      ? [
          {
            what: `${facts.declinedRows} row(s) that reached NO classification (verdict 'declined')`,
            why:
              'the declared rules could not be read for them; they are in the rowset with ' +
              'everything that IS known, and nothing was guessed to fill the gap',
          },
        ]
      : [];
  const checked = mergeItems([inner.checked, chart.checked, own]);
  const notChecked = mergeItems([inner.notChecked, chart.notChecked, declinedEntries]);
  const cannotCover = mergeItems([inner.cannotCover, chart.cannotCover]);

  const rowsPart =
    facts.rowsTotal !== undefined
      ? `; ${facts.rowsTotal} row(s) assessed` +
        (facts.declinedRows !== undefined && facts.declinedRows > 0
          ? `, ${facts.declinedRows} declined (no classification reached)`
          : '')
      : '';
  const gapsPart =
    notChecked.length > 0 ? `; ${notChecked.length} not-checked item(s) declared` : '';
  const sentence =
    `Ran '${facts.chartName}'${rulesClause(facts.rules)} — ` +
    `${facts.stepsExecuted} step(s) recorded${rowsPart}${gapsPart}.`;

  return {
    ...(checked.length > 0 && { checked }),
    ...(notChecked.length > 0 && { not_checked: notChecked }),
    ...(cannotCover.length > 0 && { cannot_cover: cannotCover }),
    note: COVERAGE_NOTE,
    sentence,
  };
}

/**
 * The carried provenance stamp: the FIRST inner result that declared an
 * `af_provenance` (on its unwrapped payload, or at its top level — both are
 * read, in that order). A derived answer is still an answer, and a source's
 * confession (`source: 'LOCAL SEED'`) must survive composition.
 */
export function carriedProvenanceOf(
  records: readonly InnerCallRecord[],
): Record<string, unknown> | undefined {
  const bagOf = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  for (const record of records) {
    const top = bagOf(record.result);
    if (top === undefined) continue;
    const payload = bagOf(top.result);
    for (const candidate of [payload, top]) {
      const stamp = bagOf(candidate?.af_provenance);
      if (stamp !== undefined) return stamp;
    }
  }
  return undefined;
}
