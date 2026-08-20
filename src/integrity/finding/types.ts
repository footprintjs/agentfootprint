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
 * The five defect classes, by their plain names:
 *
 * | kind | means | mechanism |
 * |---|---|---|
 * | `invariant-violation`  | two things that cannot both be true were both asserted | exclusion |
 * | `unsupported-argument` | acted on a value nothing served                        | domain    |
 * | `dangling-reference`   | offered an action whose inputs are no longer available | closure   |
 * | `duplicate-execution`  | did settled work again                                 | once      |
 * | `unsupported-claim`    | stated something the record does not support           | grounding |
 */
export type ContextErrorKind =
  | 'invariant-violation'
  | 'unsupported-argument'
  | 'dangling-reference'
  | 'duplicate-execution'
  | 'unsupported-claim';

/** One detected context error — a labelled instance, automatically. */
export interface ContextError {
  readonly kind: ContextErrorKind;
  readonly seam: IntegritySeam;
  /** The stamped subjects this is about. */
  readonly subjects: readonly SubjectRef[];
  /** The two-or-more assertions that prove it — copies, plain data. */
  readonly witnesses: readonly Assertion[];
  /** The epoch the conflict was judged at, when the witnesses carry one. */
  readonly epoch?: number;
  /** True when every witness is canary material — never mixed with real. */
  readonly synthetic?: true;
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
  return `${e.kind} @${e.seam} [${subjects}] ${epoch}`;
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
