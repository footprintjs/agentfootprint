/**
 * ContextError — the ONE visible finding type, named in the words people
 * already use for these defects.
 *
 * Pattern: plain data + identity-keyed dedup. Pure.
 * Role:    everything a Context Integrity check detects is filed as
 *          exactly this shape, at every seam — a uniform finding is what
 *          makes findings a CORPUS (each one a labelled instance carrying
 *          its check, seam, subjects and witnesses) and what keeps the
 *          disposition accounting honest across seams.
 *
 * NAMING LAW: the `kind` is the plain software-defect name, never the
 * algebra term — the people reading a finding are not reading the
 * mechanism. The one guardrail that outranks the naming: never use a
 * familiar name that is subtly wrong. ("State loss" for the evicted-
 * identifiers failure would send an engineer hunting a storage bug that
 * does not exist; the ledger held every identifier — they stopped being
 * SERVED. `dangling-reference` is what a linker means and what happened.)
 */

import type { Assertion, SubjectRef } from '../assertion/types.js';
import type { IntegritySeam } from '../disposition/types.js';

/**
 * The nine defect classes, by their plain names:
 *
 * | kind | means | mechanism |
 * |---|---|---|
 * | `invariant-violation`  | two things that cannot both be true were both asserted | exclusion |
 * | `unsupported-argument` | acted on a value nothing served                        | domain    |
 * | `dangling-reference`   | offered an action whose inputs are no longer available | closure   |
 * | `duplicate-execution`  | did settled work again                                 | once      |
 * | `unsupported-claim`    | stated something the record does not support           | grounding |
 * | `empty-lookup`         | the run produced this value, and the lookup for it found nothing | join |
 * | `column-type-mismatch` | a column holds something other than the type its tool declared | type |
 * | `missing-column`       | a column the tool declared is in none of its rows      | presence  |
 * | `prior-turn-evidence`  | every value in the answer was served before this turn  | recency   |
 *
 * `empty-lookup` is the one class that is ADVISORY BY CONSTRUCTION (9.77.0) —
 * every finding it files carries `advisory: true`, because an empty result
 * can be perfectly true and nothing in the library can tell a true absence
 * from a lookup that could never have matched. It is a place to look, not a
 * defect that was proven. It is deliberately NOT `dangling-reference`, whose
 * meaning is the opposite: there the ground has left reach, here the ground
 * is in reach and the lookup came back with nothing.
 *
 * `column-type-mismatch` and `missing-column` (9.78.0) are two classes rather
 * than one ON PURPOSE, and the field failure they come from is the argument:
 * a LUN of 0 stored as `''` and a LUN column that was never delivered send a
 * person to two different files, and a checker that said only "something is
 * off with logical_unit_number" would have helped with neither. Unlike
 * `empty-lookup`, neither is advisory: a column declared `number` that holds
 * a string is not a place to look, it is a broken promise — though what the
 * check can see about it is bounded, and the bound ships as
 * `COLUMN_TYPE_CEILING` in every message.
 *
 * `prior-turn-evidence` (9.83.0) is the family's SECOND advisory-by-
 * construction class, and for the same shape of reason as `empty-lookup`:
 * referring back to an earlier result is ordinary conversation, so an answer
 * built entirely from earlier turns is a place to look and never a proven
 * defect. It is deliberately NOT `unsupported-claim`, which is the opposite
 * fact — there the answer says something the record contradicts, here every
 * value in it is in the record and the question is only WHEN it got there.
 * Its bound ships as `PRIOR_TURN_EVIDENCE_CEILING` in every message.
 */
export type ContextErrorKind =
  | 'invariant-violation'
  | 'unsupported-argument'
  | 'dangling-reference'
  | 'duplicate-execution'
  | 'unsupported-claim'
  | 'empty-lookup'
  | 'column-type-mismatch'
  | 'missing-column'
  | 'prior-turn-evidence';

/** One detected context error — a labelled instance, automatically. */
export interface ContextError {
  readonly kind: ContextErrorKind;
  readonly seam: IntegritySeam;
  /** The stamped subjects this is about. */
  readonly subjects: readonly SubjectRef[];
  /** The two-or-more assertions that prove it — copies, plain data. */
  readonly witnesses: readonly Assertion[];
  /**
   * WHICH RELATION the defect is about, when the subjects alone do not
   * determine it (9.61.0).
   *
   * The substrate already treats the predicate as identity-bearing —
   * `assertionKey` is `(subject, predicate, epoch)` — and a finding's
   * identity was strictly coarser than the algebra key one file over. That
   * gap lost real defects: two claims about two FIELDS of one entity
   * rendered the same identity, so the second was deduplicated away and the
   * event channel disagreed with the disposition ledger about the same run.
   *
   * Absent on the checks whose subjects already discriminate (a tool name
   * is the whole story there), which keeps their identities byte-identical.
   */
  readonly predicate?: string;
  /** The epoch the conflict was judged at, when the witnesses carry one. */
  readonly epoch?: number;
  /** True when every witness is canary material — never mixed with real. */
  readonly synthetic?: true;
  /**
   * A SOFTER CLASS (9.61.0): the finding reports doubt rather than
   * contradiction — today, an answer that declines to claim (`null`,
   * `'unknown'`) a fact the run verified. Presence-only, and counted apart
   * from real defects: an advisory is a thing worth seeing, never a thing
   * that was wrong. `contextErrorIdentity` does not read it, so an
   * advisory and a contradiction about the same subjects would collapse to
   * one finding — which is correct: they are the same disagreement, and
   * the first filing wins.
   */
  readonly advisory?: true;
  /** One plain sentence a person can act on. States the defect, never a verdict on who is right. */
  readonly message: string;
}

/**
 * The identity a finding deduplicates by: the same defect about the same
 * subjects at the same seam is ONE finding however many passes re-detect
 * it — a findings channel that spams recreates the noise problem it
 * exists to prevent.
 */
export function contextErrorIdentity(e: ContextError): string {
  const subjects = e.subjects
    .map((s) => `${s.kind} ${s.id}`)
    .sort()
    .join(' + ');
  const epoch = e.epoch === undefined ? '' : String(e.epoch);
  // The predicate rides between the subjects and the epoch, mirroring
  // `assertionKey`. Absent renders '', so every finding filed before this
  // field existed keeps exactly the identity it had.
  const predicate = e.predicate ?? '';
  return `${e.kind} @${e.seam} [${subjects}] ${predicate} ${epoch}`;
}

/** Keep the FIRST filing of each identity, in input order. */
export function dedupeContextErrors(errors: readonly ContextError[]): readonly ContextError[] {
  const seen = new Set<string>();
  const kept: ContextError[] = [];
  for (const e of errors) {
    const id = contextErrorIdentity(e);
    if (seen.has(id)) continue;
    seen.add(id);
    kept.push(e);
  }
  return kept;
}
