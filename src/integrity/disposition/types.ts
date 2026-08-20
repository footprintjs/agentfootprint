/**
 * Disposition — what happened when a check MET an assertion, as data.
 *
 * Pattern: plain data + a closed vocabulary. Pure, zero dependencies.
 * Role:    the Context Integrity family's accounting substrate. Every
 *          check, on every subject it meets, files exactly one of four
 *          dispositions — so "zero findings" and "zero checks ran" become
 *          DIFFERENT observable states. Two shipped checks in this
 *          codebase decayed into decoration because nothing measured
 *          whether they ran; this vocabulary exists so that can never be
 *          silent again.
 *
 * The vocabulary is deliberately aligned with the coverage primitives'
 * checked / not_checked / cannot_cover words (core/agent/coverage): same
 * house, same honesty grammar, different subject (a CHECK's encounter with
 * an assertion, rather than a tool's encounter with ground).
 */

/** The seams a check can sit at — the brief's five, closed. */
export type IntegritySeam = 'write' | 'compose' | 'wire' | 'choice' | 'claim';

/**
 * One check's verdict on one encounter:
 *
 * - `checked-pass`     — the check ran and found nothing wrong.
 * - `checked-fail`     — the check ran and filed a finding.
 * - `not-applicable`   — the check looked and the subject is out of its
 *                        scope BY RULE (e.g. a multi-valued predicate for
 *                        the single-value check). Counted, because a rule
 *                        that excuses everything is a dead check wearing a
 *                        justification.
 * - `unreachable`      — the check could not run because no identity edge
 *                        was stamped (facts without a shared subject are
 *                        incomparable, and incomparable means silent).
 *                        THE load-bearing one: it is the falsification
 *                        instrument — if `unreachable` dominates in real
 *                        traffic, applications are not stamping identity,
 *                        and the thesis itself (contradiction is computable
 *                        from what people actually declare) is failing.
 */
export type Disposition = 'checked-pass' | 'checked-fail' | 'not-applicable' | 'unreachable';

/** Aggregate accounting for one (check, seam) pair. */
export interface CheckReport {
  /** The check's plain name (a ContextErrorKind once the finding type lands). */
  readonly check: string;
  readonly seam: IntegritySeam;
  /** Encounters where the check was in scope: pass + fail. */
  readonly checked: number;
  /** Encounters that filed a finding. Always ≤ checked. */
  readonly findings: number;
  readonly notApplicable: number;
  /** Encounters with no identity edge — the dead-spot count to drive down. */
  readonly unreachable: number;
  /**
   * When the check last filed a FINDING (epoch ms) — absent means "never
   * has", which is either excellent news or a dead detector; the synthetic
   * canary (see ledger) is what tells those apart.
   */
  readonly lastFiredAt?: number;
  /** Findings from the dev-posture canary — counted apart, never mixed in. */
  readonly synthetic: number;
}
