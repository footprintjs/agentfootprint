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

import { conversationRedaction } from './conversation.js';
import {
  coverageOfOpenedRun,
  policyOfCoverage,
  UNKNOWN_COVERAGE,
  type RedactionCoverage,
} from './coverage.js';
import { unionRedactionPolicies } from './policy.js';

/** Every runner → what it declares: a policy, or positively none. Weak: dies with the runner. */
const declared = new WeakMap<object, RedactionCoverage>();

/**
 * Record what `runner` declares for every run of its own. Called by the
 * runner's own construction, which knows: `undefined` HERE is the declaration
 * "none" (`RunnerBase` records it for every runner before a subclass declares
 * its own), never a lookup that missed.
 */
export function declareRedaction(runner: object, policy: RedactionPolicy | undefined): void {
  declared.set(runner, coverageOfOpenedRun(policy));
}

/**
 * What `runner` declares: `covered` (a policy), `declared-none`, or `unknown`
 * — an object no runner of this library registered (`coverage.ts`).
 */
export function declarationOf(runner: object): RedactionCoverage {
  return declared.get(runner) ?? UNKNOWN_COVERAGE;
}

/**
 * The policy `runner` declares, for a union — its own, or (for a composition)
 * the union of its members'. FAIL CLOSED: a runner whose declaration this
 * library never recorded (a member that is not a runner of this library)
 * reads as declaring the whole conversation vocabulary, never as "none".
 */
export function redactionDeclaredBy(runner: object): RedactionPolicy | undefined {
  const declaration = declarationOf(runner);
  if (declaration.state === 'unknown') return conversationRedaction();
  return policyOfCoverage(declaration);
}

/**
 * A composition declares every policy its members declared. Called by each
 * composition's constructor with its members, after they exist and before the
 * composition's chart is built — the `readsMessageFromIfAny` placement.
 */
export function adoptMemberRedaction(composition: object, members: readonly object[]): void {
  declareRedaction(composition, unionRedactionPolicies(...members.map(redactionDeclaredBy)));
}
