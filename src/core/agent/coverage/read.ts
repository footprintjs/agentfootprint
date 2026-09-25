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
import { listsWithoutRecordOnly } from './items.js';
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

/**
 * The value the MODEL is served for one finalized tool result: a recognized
 * envelope with `short` and `kind` removed from every coverage item. They are
 * RECORD-ONLY: the events, the tracked `coverageDeclared` rows and the answer
 * account carry them; the model's request never does, so a tool that
 * declares them costs no request byte.
 *
 * The shapes, and nesting: a bare absence; a ledger — its own lists AND
 * whatever it bounds, read by this same function (so `coverage(absent(…))`,
 * `coverage(coverage(…))` and a semantic envelope under a ledger are all
 * served stripped; the depth is whatever the author built); and a semantic
 * envelope's `coverage`.
 *
 * NOT stripped, because none is a recognized envelope OBJECT: a result
 * returned as JSON TEXT (an `mcpClient` result in its default text mode is
 * one), an `af_absent` whose `checked` is empty or missing (the recognizer
 * refuses it, so it is ordinary data — served and recorded as written), and
 * an absence buried inside a tool's own domain object or array. A key whose
 * value is `null` counts as omitted (a JSON producer's `None`), so it is
 * served as written and stamps nothing.
 *
 * Zero-cost when unused: the SAME reference back for every value that is not
 * a recognized envelope, and for every envelope whose items declare neither
 * key — so a caller that stamps `tool_end.modelResult` by reference
 * inequality stamps nothing new. A structural copy only when a key was
 * present.
 *
 * Asked at the ENTRY of `../stages/toolCalls.ts` · `afterMoment`, which every
 * dispatch path (the batch loop and the four resume doors) calls for a result
 * that ran — so every after-tool link is handed the served value, and none
 * can re-serve the fields — and by the result ceiling and the column judge at
 * both execute boundaries, which measure what the model will read.
 */
export function servedToModel(value: unknown): unknown {
  const served = strip(value);
  // Remembered, so the placement door can tell "the two channels differ
  // only by this strip" (one value, one ticket) from "a rule changed what
  // the model reads" — see `strippedOnly`.
  if (served !== value && typeof served === 'object' && served !== null) {
    STRIPPED_FROM.set(served, value);
  }
  return served;
}

/** served copy → the value it was stripped from. Weak: never holds a result
 *  past the call that produced it. */
const STRIPPED_FROM = new WeakMap<object, unknown>();

/**
 * True when `modelResult` is exactly what {@link servedToModel} produced from
 * `result` — the two channels carry ONE value and differ only by the
 * record-only fields. `../stages/toolCalls.ts` · `placeResults` then gives
 * both channels the ticket, as it does when they are one reference, so a
 * declaring tool never keeps its whole payload on `tool_end.result`.
 */
export function strippedOnly(result: unknown, modelResult: unknown): boolean {
  if (typeof modelResult !== 'object' || modelResult === null) return false;
  return STRIPPED_FROM.has(modelResult) && STRIPPED_FROM.get(modelResult) === result;
}

function strip(value: unknown): unknown {
  const absence = readAbsence(value);
  if (absence !== undefined) return listsWithoutRecordOnly(absence);
  const sem = readSemantics(value);
  if (sem !== undefined) {
    // Defensive at the dispatch door: `declareSemantics` has already replaced
    // a top-level semantic envelope with `semanticsForModel`, which drops the
    // three-list coverage detail, before `afterMoment` runs. It is reached for
    // a semantic envelope a LEDGER bounds, and by a direct caller.
    if (sem.coverage === undefined) return value;
    const cov = listsWithoutRecordOnly(sem.coverage);
    return cov === sem.coverage ? value : { ...(value as object), coverage: cov };
  }
  const covered = readCoverageLedger(value);
  if (covered === undefined) return value;
  const marker = listsWithoutRecordOnly(covered.af_coverage);
  const result = strip(covered.result);
  if (marker === covered.af_coverage && result === covered.result) return value;
  return { ...covered, af_coverage: marker, result };
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
