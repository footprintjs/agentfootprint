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
import { readProvenance, type DeclaredProvenance } from '../../../lib/semantics/described.js';
import {
  coverageOfSemantics,
  periodOfSemantics,
  readSemantics,
} from '../../../lib/semantics/envelope.js';
import {
  ABSENCE_NOTE,
  ABSENCE_NOTE_HELD_ONLY,
  coverageOfAbsence,
  readAbsence,
  tryInsteadOfAbsence,
  tryInsteadToolOfAbsence,
} from './absent.js';
import { listsWithoutRecordOnly } from './items.js';
import { coverageOfLedger, readCoverageLedger } from './ledger.js';
import {
  noteWithClause,
  noteWithoutClause,
  readPeriod,
  servedPeriod,
  SERVED_VERDICT_KEY,
  unservedPeriod,
  warnDroppedDeclaration,
  type DeclaredPeriod,
  type ServedPeriodVerdict,
} from './period.js';
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
  /**
   * Present for `'absence'` when it declared where it looked and when that
   * source was measured (honesty step 7b) — the record's camelCase form, read
   * by the ONE provenance rule a described result is held to; a copy.
   */
  readonly provenance?: DeclaredProvenance;
  /**
   * The period the declaration's read covered (honesty step 7b) — the record's
   * camelCase form, read by the ONE period rule (`period.ts`); a copy. Absent
   * when none was declared, and when the envelope declared one the rule set
   * refuses — read, never repaired: it is left off the record (dev-warned) and
   * the model still reads what the tool wrote.
   */
  readonly period?: DeclaredPeriod;
}

/**
 * A declared period read off one envelope object, dropped from the record
 * (and named once per tool in dev mode) when it is malformed.
 */
function periodOf(holder: { readonly period?: unknown }, toolName: string | undefined) {
  // A value the model was SERVED (a reader of history) carries the library's
  // own verdict word; it is read as the period the tool declared.
  const read = readPeriod(unservedPeriod(holder.period));
  if (read.problem !== undefined) warnDroppedDeclaration(toolName, 'period', read.problem);
  return read.period;
}

/** The facts one absence declares — the same for a bare absence and for one
 *  a ledger bounds, so the two sites cannot drift. */
function absenceFacts(absence: ToolAbsence, toolName: string | undefined): CoverageFacts {
  const tryInstead = tryInsteadOfAbsence(absence);
  const tryInsteadTool = tryInsteadToolOfAbsence(absence);
  const source = readProvenance(absence.provenance);
  if (source.problem !== undefined) warnDroppedDeclaration(toolName, 'provenance', source.problem);
  const period = periodOf(absence, toolName);
  return {
    kind: 'absence',
    coverage: coverageOfAbsence(absence),
    lookedFor: absence.looked_for,
    ...(tryInstead !== undefined && { tryInstead }),
    ...(tryInsteadTool !== undefined && { tryInsteadTool }),
    ...(source.provenance !== undefined && { provenance: source.provenance }),
    ...(period !== undefined && { period }),
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
 * And one thing ADDED, derived from what the tool declared (honesty step 7b,
 * bench round 1): a declared `period` whose store did not hold all of the
 * time the read asked about is served with its verdict word and that word's
 * one note clause (see `withPeriodServed`). A `covered` period, a malformed
 * one and a result with none gain nothing.
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

/**
 * Pure: the served form of `value`, and nothing remembered (the answer account
 * reads through this; the dispatch door asks {@link servedToModel}, which also
 * records the pair for `strippedOnly`).
 *
 * `seen` guards a ledger that bounds ITSELF (`v.result = v`, directly or
 * further down): a holder met twice is returned as found, so a pathological
 * cycle is served as written instead of overflowing the stack.
 */
export function strip(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  const absence = readAbsence(value);
  if (absence !== undefined) return withPeriodServed(listsWithoutRecordOnly(absence), 'absence');
  const sem = readSemantics(value);
  if (sem !== undefined) {
    // Defensive at the dispatch door: `declareSemantics` has already replaced
    // a top-level semantic envelope with `semanticsForModel`, which drops the
    // three-list coverage detail, before `afterMoment` runs. It is reached for
    // a semantic envelope a LEDGER bounds, and by a direct caller.
    const cov = sem.coverage === undefined ? undefined : listsWithoutRecordOnly(sem.coverage);
    const listed = cov === sem.coverage ? value : { ...(value as object), coverage: cov };
    return withPeriodServed(listed as object, 'other');
  }
  const covered = readCoverageLedger(value);
  if (covered === undefined) return value;
  const marker = withPeriodServed(listsWithoutRecordOnly(covered.af_coverage), 'other');
  const result = strip(covered.result, seen);
  if (marker === covered.af_coverage && result === covered.result) return value;
  return { ...covered, af_coverage: marker, result };
}

/**
 * One declaring object's period, SERVED (honesty step 7b, bench round 1): the
 * verdict word inside `period` and that word's one clause after the note —
 * and, on an absence whose store held only part or none of the period asked,
 * `ABSENCE_NOTE_HELD_ONLY` in place of the note that claims the answer is
 * complete. The same reference back when there is nothing to serve (no
 * period, a malformed one, a `covered` one), so an undeclared result is
 * served byte for byte.
 *
 * Why the door serves a conclusion the record already holds: the registered
 * bench (`bench/results/`, round 1) showed the model restating `queried` as
 * the ground a result covered, never comparing it with `held` — the case the
 * design's § 9 kept this for. The word is `period.ts` · `periodVerdict`, the
 * rule the `period` row is filed by, so the two cannot disagree.
 */
function withPeriodServed<T extends object>(holder: T, door: 'absence' | 'other'): T {
  const rec = holder as Record<string, unknown>;
  const served = servedPeriod(rec.period);
  if (served === undefined) return holder;
  const note =
    door === 'absence' && served.verdict !== 'unknown' && rec.note === ABSENCE_NOTE
      ? ABSENCE_NOTE_HELD_ONLY
      : rec.note;
  return { ...rec, period: served.period, note: noteWithClause(note, served.clause) } as T;
}

/**
 * The inverse of the serve, for a reader of what the model was served: every
 * declaring object's verdict word and period clause removed (the note swap is
 * kept — it is the absence's own static note), the rest as found. The same
 * reference back when nothing was served. Asked by the evidence projection
 * (`evidence.ts` · `absenceEvidenceProjection`): words the library derived
 * never ground an answer.
 *
 * It walks the shapes the serve writes — an object with a `period`, and a
 * ledger's `af_coverage` and `result`, to any depth — and nothing else.
 */
export function withoutServedPeriod(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  const own = unserved(value as Record<string, unknown>);
  const covered = readCoverageLedger(own);
  if (covered === undefined) return own;
  const marker = unserved(covered.af_coverage as Record<string, unknown>);
  const result = withoutServedPeriod(covered.result, seen);
  if (marker === covered.af_coverage && result === covered.result) return own;
  return { ...covered, af_coverage: marker, result };
}

/** One object with its served verdict word and clause removed, or itself. */
function unserved(holder: Record<string, unknown>): Record<string, unknown> {
  const declared = unservedPeriod(holder.period);
  if (declared === holder.period) return holder;
  const verdict = (holder.period as Record<string, unknown>)[
    SERVED_VERDICT_KEY
  ] as ServedPeriodVerdict;
  const out: Record<string, unknown> = { ...holder, period: declared };
  const note = noteWithoutClause(holder.note, verdict);
  if (note === undefined) delete out.note;
  else out.note = note;
  return out;
}

const ABSENT_STATUS: ToolResultStatus = 'absent';

/**
 * Read one finalized tool result for coverage declarations — and, since
 * honesty step 7b, for the period each declaration's read covered and an
 * absence's source and time. `toolName` names the tool in the one dev
 * warning a malformed period or provenance gets (it is left off the record,
 * never repaired); the dispatch door passes it, a post-hoc reader need not.
 *
 * The two shapes compose: `coverage(absent({…}), {…})` is a search that found
 * nothing AND a boundary around the search, so both are declared and the
 * delivered status is still `'absent'` — the ledger bounds the answer, it
 * does not change what the answer was.
 */
export function readCoverageResult(value: unknown, toolName?: string): CoverageReading | undefined {
  const absence = readAbsence(value);
  if (absence !== undefined) {
    return { status: ABSENT_STATUS, declared: [absenceFacts(absence, toolName)] };
  }
  // A semantic envelope's `coverage` field (9.53.0) is ABSORBED here — the
  // one recognizer funnel — so the boundary a semantic tool declared flows
  // through the exact channel `coverage()` uses (the `tools.coverage_declared`
  // event, tracked state, the final-answer limits block) with zero extra
  // wiring at any dispatch door. Its `period` (honesty step 7b) is absorbed
  // the same way: an envelope with a period and no coverage lists files a
  // `'ledger'` row whose three lists are empty. A semantic envelope with
  // neither declares no boundary, exactly like a bare result.
  const sem = readSemantics(value);
  if (sem !== undefined) {
    const period = periodOfSemantics(sem);
    if (sem.coverage === undefined && period === undefined) return undefined;
    return {
      declared: [
        {
          kind: 'ledger',
          coverage: coverageOfSemantics(sem),
          ...(period !== undefined && { period }),
        },
      ],
    };
  }
  const covered = readCoverageLedger(value);
  if (covered === undefined) return undefined;
  const ledgerPeriod = periodOf(covered.af_coverage, toolName);
  const declared: CoverageFacts[] = [
    {
      kind: 'ledger',
      coverage: coverageOfLedger(covered),
      ...(ledgerPeriod !== undefined && { period: ledgerPeriod }),
    },
  ];
  const inner = readAbsence(covered.result);
  if (inner === undefined) return { declared };
  declared.push(absenceFacts(inner, toolName));
  return { status: ABSENT_STATUS, declared };
}
