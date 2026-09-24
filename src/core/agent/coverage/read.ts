/**
 * read — the ONE recognizer the tool-dispatch loop calls.
 *
 * Pattern: one reader, every dispatch door (the `applyResultCeiling`
 *          precedent). The batch loop and the credential/resume execute
 *          boundary both call this at the moment a handler's return lands, so
 *          a resumed call declares its coverage exactly as an inline one; the
 *          raise site (`../stages/toolCalls.ts` · `declareRaisedAbsence`)
 *          calls it on the `absence` a `requestInput` declared (9.114.0).
 * Role:    core/ layer, pure. Recognition and normalization only — the caller
 *          owns the events, the scope write and the delivered status.
 * Emits:   N/A.
 *
 * Zero-cost when unused: two `typeof` checks and a key lookup for every
 * result that is neither shape, and `undefined` back. Nothing is emitted,
 * nothing is written, and the value the model reads is the value the tool
 * returned — byte for byte.
 */

import type { ToolResultStatus } from '../../../lib/injection-engine/toolOutcome.js';
import { coverageOfSemantics, readSemantics } from '../../../lib/semantics/envelope.js';
import {
  coverageOfAbsence,
  readAbsence,
  tryInsteadOfAbsence,
  tryInsteadToolOfAbsence,
} from './absent.js';
import { coverageOfLedger, readCoverageLedger } from './ledger.js';
import type { Coverage, ToolAbsence, TryInsteadTool } from './types.js';

/** One coverage statement found in a result, before the caller stamps it with
 *  the call it came from. */
export interface CoverageFacts {
  readonly kind: 'absence' | 'ledger';
  readonly coverage: Coverage;
  /** Present for `'absence'` — what the search was for. */
  readonly lookedFor?: string;
  /**
   * Present for `'absence'` when it declared a sentence (9.113.0) — trimmed,
   * as `absent()` mints it, and never parsed for a tool name. Not a piece of
   * coverage, so it sits beside `coverage` rather than inside it.
   */
  readonly tryInstead?: string;
  /** Present for `'absence'` when it declared a typed tool (9.113.0) — a copy. */
  readonly tryInsteadTool?: TryInsteadTool;
}

/** The facts one absence declares — the same for a bare absence and for one
 *  a ledger bounds, so the two sites cannot drift. */
function absenceFacts(absence: ToolAbsence): CoverageFacts {
  const tryInstead = tryInsteadOfAbsence(absence);
  const tryInsteadTool = tryInsteadToolOfAbsence(absence);
  return {
    kind: 'absence',
    coverage: coverageOfAbsence(absence),
    lookedFor: absence.looked_for,
    ...(tryInstead !== undefined && { tryInstead }),
    ...(tryInsteadTool !== undefined && { tryInsteadTool }),
  };
}

/** What one recognized result declares. `undefined` from
 *  {@link readCoverageResult} means "neither shape": untouched path. */
export interface CoverageReading {
  /**
   * The status the framework DELIVERS for this call. `'absent'` when an
   * absence is in play — never `'failure'`, and that is the point: a status
   * of `'failure'` would route an honest empty answer down the same edge as
   * a broken collector, which is the exact confusion the primitive removes.
   * Undefined for a bare ledger — a ledger says nothing about the outcome,
   * only about its boundary.
   */
  readonly status?: ToolResultStatus;
  /** In declaration order: the outer ledger first, then the absence it
   *  wraps. Usually one entry; two only when an author bounded an absence. */
  readonly declared: readonly CoverageFacts[];
}

const ABSENT_STATUS: ToolResultStatus = 'absent';

/**
 * Read one finalized tool result for coverage declarations.
 *
 * The two shapes compose: `coverage(absent({…}), {…})` is a search that found
 * nothing AND a boundary around the search, so both are declared and the
 * delivered status is still `'absent'` — the ledger bounds the answer, it
 * does not change what the answer was.
 */
export function readCoverageResult(value: unknown): CoverageReading | undefined {
  const absence = readAbsence(value);
  if (absence !== undefined) {
    return { status: ABSENT_STATUS, declared: [absenceFacts(absence)] };
  }
  // A semantic envelope's `coverage` field (9.53.0) is ABSORBED here — the
  // one recognizer funnel — so the boundary a semantic tool declared flows
  // through the exact channel `coverage()` uses (the `tools.coverage_declared`
  // event, tracked state, the final-answer limits block) with zero extra
  // wiring at any dispatch door. A semantic envelope without `coverage`
  // declares no boundary, exactly like a bare result.
  const sem = readSemantics(value);
  if (sem !== undefined) {
    if (sem.coverage === undefined) return undefined;
    return { declared: [{ kind: 'ledger', coverage: coverageOfSemantics(sem) }] };
  }
  const covered = readCoverageLedger(value);
  if (covered === undefined) return undefined;
  const declared: CoverageFacts[] = [{ kind: 'ledger', coverage: coverageOfLedger(covered) }];
  const inner = readAbsence(covered.result);
  if (inner === undefined) return { declared };
  declared.push(absenceFacts(inner));
  return { status: ABSENT_STATUS, declared };
}
