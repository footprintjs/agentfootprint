/**
 * declared — which runner declared which redaction policy, and the one a
 * composition inherits from what it composes.
 *
 * Pattern: a registry (a `WeakMap` from runner to policy) — the
 *          `core/messageFrom.ts` precedent: a capability a child has, which
 *          the composition that mounts the child must carry too.
 * Role:    the Map half of `src/redaction/`. Written at construction, read at
 *          every run; a run never changes it.
 *
 * WHY A COMPOSITION ADOPTS ITS MEMBERS' POLICIES. A composition does not run
 * its members on their own executors: `Sequence`, `Parallel`, `Conditional`,
 * `Loop`, `Graph` and `Workflow` mount each member's chart as a subflow of
 * their own, so ONE executor runs the whole tree and ONE redaction rule covers
 * it (footprintjs hands a run's policy to every nested runtime). An agent's
 * `redact` would therefore be dropped in silence the moment the agent was
 * composed — its own `run()` is never called. So a composition declares the
 * union of what its members declared, at construction, and a member's
 * declaration travels with it wherever it is mounted. The union can only add
 * names: a member never loses one because another member did not declare it.
 */

import type { RedactionPolicy } from 'footprintjs';

import { unionRedactionPolicies } from './policy.js';

const declared = new WeakMap<object, RedactionPolicy>();

/** Record the policy `runner` declares for every run of its own. */
export function declareRedaction(runner: object, policy: RedactionPolicy | undefined): void {
  if (policy !== undefined) declared.set(runner, policy);
}

/** The policy `runner` declares — its own, or (for a composition) the union of its members'. */
export function redactionDeclaredBy(runner: object): RedactionPolicy | undefined {
  return declared.get(runner);
}

/**
 * A composition declares every policy its members declared. Called by each
 * composition's constructor with its members, after they exist and before the
 * composition's chart is built — the `readsMessageFromIfAny` placement.
 */
export function adoptMemberRedaction(composition: object, members: readonly object[]): void {
  declareRedaction(composition, unionRedactionPolicies(...members.map(redactionDeclaredBy)));
}
