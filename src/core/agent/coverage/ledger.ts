/**
 * ledger — what a clean result does NOT rule out.
 *
 * Pattern: a wrapper the framework recognizes, minted by a helper (the
 *          `absent()` shape one level up: same vocabulary, different claim).
 * Role:    core/ layer, pure. `coverage()` is what a tool author writes;
 *          `readCoverageLedger` is what the dispatch loop calls.
 * Emits:   N/A (the caller emits `agentfootprint.tools.coverage_declared`).
 *
 * ## The problem, stated as narrowly as it deserves
 *
 * An agent answers confidently from partial coverage. "Everything looks fine"
 * is produced from four checks that passed, and arrives with no way to tell
 * whether *fine* means **verified** or **unexamined** — whether the fifth
 * thing was healthy or was never looked at. The evidence gate (9.35.0) is the
 * sibling of this: the gate catches invented VALUES, this catches unstated
 * LIMITS. Both are ways an answer can be false while every token in it is
 * real.
 *
 * A ledger is not a caveat and not a disclaimer. It is three lists the TOOL
 * knows and the model does not: what it checked, what it did not check, and
 * what it can never cover. Only the tool knows the third one, which is why
 * this cannot be prompt engineering.
 *
 * ## Why the wrapper, and not a field on the result
 *
 * The alternative — teaching the framework to read a `coverage` key off any
 * returned object — would make every domain object that happens to have one
 * change behavior. The wrapper is opt-in by construction: `coverage(x, …)`
 * produces a shape that did not exist before, so nothing that ever ran can
 * become a ledger by accident. Same argument as the effects envelope's strict
 * recognizer, same guarantee.
 */

import { normalizeCoverageList } from './items.js';
import type { Coverage, CoverageDeclaration, CoveredResult } from './types.js';

/** The reserved key that makes a ledger recognizable. */
export const COVERAGE_MARKER = 'af_coverage';

/**
 * The static sentence every ledger carries. The last clause is the OFFER half
 * of survival — the model is told to carry the limits into its answer. The
 * ENFORCEMENT half (`.limitsTravelWithTheAnswer()`) does not depend on the
 * model obeying it; see `answer.ts` for why both exist.
 */
export const COVERAGE_NOTE =
  'This result covers only what `checked` lists. `not_checked` is ground this call did not ' +
  'look at, and `cannot_cover` is ground this tool can never see — a clean result here is ' +
  'NOT evidence about either, and no retry changes `cannot_cover`. Carry these limits into ' +
  'any answer you build on this result.';

/**
 * Return a verdict with its own boundary attached.
 *
 * The model reads `{ af_coverage: {…}, result: <your value> }` — boundary
 * first, deliberately: a limit placed after a long result is a limit that gets
 * skimmed past. The framework records the ledger and, with
 * `.limitsTravelWithTheAnswer()` configured, appends it to the run's final
 * answer where the model cannot drop it.
 *
 * @example the highest-stakes tool in a triage agent
 *   defineTool({
 *     name: 'replication_health',
 *     description: 'Replication health across the estate',
 *     inputSchema: { type: 'object', properties: {} },
 *     execute: async () => {
 *       const { verdict, ndmTimedOut } = await checkReplication();
 *       return coverage(verdict, {
 *         checked: ['SRDF pair state on all 4 arrays (live query)'],
 *         notChecked: ndmTimedOut
 *           ? [{ what: 'NDM migration sessions', why: 'the API timed out — ask again' }]
 *           : [],
 *         cannotCover: [
 *           { what: 'host-side multipathing', why: 'no collector runs on the ESX hosts' },
 *         ],
 *       });
 *     },
 *   });
 */
export function coverage<T>(content: T, decl: CoverageDeclaration): CoveredResult<T> {
  const fn = 'coverage';
  if (typeof decl !== 'object' || decl === null) {
    throw new Error(
      `${fn}: takes the result and its boundary — coverage(result, { checked?, notChecked?, ` +
        `cannotCover? }). To return a result with no declared boundary, return it bare.`,
    );
  }
  const checked = normalizeCoverageList(fn, 'checked', decl.checked, false);
  const notChecked = normalizeCoverageList(fn, 'notChecked', decl.notChecked, false);
  const cannotCover = normalizeCoverageList(fn, 'cannotCover', decl.cannotCover, true);
  if (checked.length === 0 && notChecked.length === 0 && cannotCover.length === 0) {
    throw new Error(
      `${fn}: all three lists are empty, so this ledger declares no boundary at all — it ` +
        `would tell a reader nothing while looking like it did, which is worse than saying ` +
        `nothing. Name what you checked, what you skipped, or what you can never see; or ` +
        `return the result bare.`,
    );
  }
  return {
    af_coverage: {
      ...(checked.length > 0 && { checked }),
      ...(notChecked.length > 0 && { not_checked: notChecked }),
      ...(cannotCover.length > 0 && { cannot_cover: cannotCover }),
      note: COVERAGE_NOTE,
    },
    result: content,
  };
}

/**
 * Recognize (or decline to recognize) a value as a covered result. STRICT for
 * the same reason `readAbsence` is: only a plain object carrying a plain
 * `af_coverage` object AND a `result` key qualifies.
 */
export function readCoverageLedger(value: unknown): CoveredResult | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const marker = rec[COVERAGE_MARKER];
  if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) return undefined;
  if (!('result' in rec)) return undefined;
  return value as CoveredResult;
}

/** The ledger's coverage, in the normalized three-list shape. */
export function coverageOfLedger(covered: CoveredResult): Coverage {
  const m = covered.af_coverage;
  return {
    checked: m.checked ?? [],
    notChecked: m.not_checked ?? [],
    cannotCover: m.cannot_cover ?? [],
  };
}
