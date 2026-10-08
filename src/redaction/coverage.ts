/**
 * coverage — what a run's records are served under, as a typed value with
 * THREE states. `undefined` is never "no policy".
 *
 * Pattern: a closed discriminated union, decided where the library positively
 *          knows the answer and switched on wherever a record is served.
 * Role:    the one vocabulary every serving door resolves to
 *          (`runRedaction.ts` · `coverageOfExecutor`, `declared.ts` ·
 *          `declarationOf`, `EventDispatcher` · `served`):
 *
 *   - `covered`        — the run was opened with a policy: serve under it.
 *   - `declared-none`  — POSITIVELY known to have none: the run was opened by
 *                        this library with no policy, or the runner declared
 *                        none when it was built. Served unchanged.
 *   - `unknown`        — the executor, the run, the scope or the runner is not
 *                        one this library recorded: nothing says what its
 *                        records may show. FAIL CLOSED, whatever the instance
 *                        declares — a placeholder for an event, a refusal for
 *                        a snapshot or a record.
 *
 * A lookup that misses is `unknown`, never `declared-none`: the difference
 * between "this run had no policy" and "this run is not one we know" is the
 * difference between serving a record and serving another run's raw values.
 */

import type { RedactionPolicy } from 'footprintjs';

/** What a run's records are served under — see the file header. */
export type Coverage =
  | { readonly state: 'covered'; readonly policy: RedactionPolicy }
  | { readonly state: 'declared-none' }
  | { readonly state: 'unknown' };

/** Positively no policy. */
export const DECLARED_NONE: Coverage = Object.freeze({ state: 'declared-none' });

/** Not recorded by this library — fail closed. */
export const UNKNOWN_COVERAGE: Coverage = Object.freeze({ state: 'unknown' });

/**
 * The coverage of a run THIS library opened, from the policy it computed for
 * the run — the union of typed declarations and the policies handed to the
 * run. Here, and only here, an absent policy is a positive fact: every input
 * of the union was itself known.
 */
export function coverageOfOpenedRun(policy: RedactionPolicy | undefined): Coverage {
  return policy === undefined ? DECLARED_NONE : Object.freeze({ state: 'covered', policy });
}

/** The policy a coverage serves under — `undefined` for `declared-none` only; `unknown` has none to give. */
export function policyOfCoverage(
  coverage: Exclude<Coverage, { state: 'unknown' }>,
): RedactionPolicy | undefined {
  return coverage.state === 'covered' ? coverage.policy : undefined;
}
