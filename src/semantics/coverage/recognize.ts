/**
 * The two envelope RECOGNIZERS — a leaf: no imports but types.
 *
 * `absent.ts` mints an absence and `ledger.ts` a coverage ledger, and each owns
 * its sentences; this file owns only the one question every reader asks of a
 * finished value, "is this an absence?" / "is this a covered result?". It is
 * split out so a post-hoc reader (the answer account, the one emptiness reader
 * in `emptiness.ts`, the standing fold) can ask it without loading the mints'
 * tool-name checks and refusal sentences. `absent.ts` and `ledger.ts` re-export
 * these names, so every existing import keeps working.
 */

import type { CoveredResult, DeclaredToolAbsence, ToolAbsence } from './types.js';

/**
 * The reserved key that makes an absence recognizable. Exported because tests,
 * docs and any consumer inspecting a raw tool result match on it — and
 * because a reserved word on the wire has to be nameable.
 */
export const ABSENCE_MARKER = 'af_absent';

/**
 * Recognize (or decline to recognize) a value as an absence — STRICT, and the
 * strictness is the zero-cost guarantee. Only a plain object whose
 * `af_absent` is exactly `true` and whose `checked` is a non-empty array
 * qualifies; every other value any tool has ever returned takes the path it
 * always took, byte for byte.
 *
 * `undefined` means "not an absence", never "a malformed one" — this library
 * does not guess at a shape it did not mint.
 */
export function readAbsence(value: unknown): ToolAbsence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (rec[ABSENCE_MARKER] !== true) return undefined;
  if (!Array.isArray(rec.checked) || rec.checked.length === 0) return undefined;
  return value as ToolAbsence;
}

/** The literal `absent({ checked: 'declared' })` mints in place of a list. */
export const DECLARED_CHECKED = 'declared';

/**
 * Recognize the envelope `absent({ checked: 'declared' })` mints — an absence
 * whose coverage the tool's `search` declares, before the dispatch funnel
 * composes it. STRICT like {@link readAbsence}: a plain object whose
 * `af_absent` is exactly `true` and whose `checked` is exactly the literal.
 * `readAbsence` never reads this shape, so a reader that predates it sees data.
 */
export function readDeclaredAbsence(value: unknown): DeclaredToolAbsence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (rec[ABSENCE_MARKER] !== true || rec.checked !== DECLARED_CHECKED) return undefined;
  return value as DeclaredToolAbsence;
}

/** The reserved key that makes a ledger recognizable. */
export const COVERAGE_MARKER = 'af_coverage';

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
