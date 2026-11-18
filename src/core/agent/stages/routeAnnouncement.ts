/**
 * routeAnnouncement — `route_decided` names the branch the run TOOK, even when
 * a wrapper around the Route decider changes it after the decider spoke.
 *
 * WHY. The Route decider announces its choice as it returns
 * (`route.ts` · `emitRouteDecided`). Typed negative claims put a wrapper
 * around it (`answerValidation.ts` · `withAnswerValidation`) that can turn a
 * `'final'` into `'negative-recheck'` — an answer citing a result handle that
 * does not resolve is asked once for corrected citations. Announced at once,
 * the record said `final` for a turn that looped, while the execution tree
 * said `negative-recheck`: two records of one decision disagreeing.
 *
 * So a wrapper that may re-route HOLDS the decider's announcement for the
 * scope it hands down, and releases it once it knows the branch: the held
 * one as it was, or its own in place of it. Exactly one `route_decided` per
 * iteration, naming the branch taken:
 *
 *   holdRouteAnnouncement(scope);            // before `decide(scope)`
 *   …decider calls emitRouteDecided → kept, not emitted
 *   announceHeld(scope, emit)                // 'final' as the decider said, or
 *   announceHeld(scope, emit, { chosen: 'negative-recheck', rationale })
 *
 * Keyed by the stage's own scope object (the per-invocation channel
 * `prepareFinal.ts` · `RAILS_REFUSED` uses), so no state is written and an
 * agent without such a wrapper never holds anything.
 */

import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { RouteBranch } from './route.js';

interface Announcement {
  readonly chosen: RouteBranch;
  readonly rationale: string;
}

type Emit = (scope: TypedScope<AgentState>, chosen: RouteBranch, rationale: string) => void;

/** The held scopes: `null` while held with nothing announced yet. */
const HELD = new WeakMap<object, Announcement | null>();

/** Hold the Route decider's announcement for `scope` until `announceHeld`. */
export function holdRouteAnnouncement(scope: object): void {
  HELD.set(scope, null);
}

/** `route.ts` · `emitRouteDecided` asks first: `true` = held, kept here and not emitted. */
export function keptForWrapper(scope: object, chosen: RouteBranch, rationale: string): boolean {
  if (!HELD.has(scope)) return false;
  HELD.set(scope, { chosen, rationale });
  return true;
}

/**
 * End the hold and announce once: `instead` when given, else what the decider
 * said. A second call (a `finally` after an early release) announces nothing.
 */
export function announceHeld(
  scope: TypedScope<AgentState>,
  emit: Emit,
  instead?: Announcement,
): void {
  if (!HELD.has(scope)) return;
  const held = HELD.get(scope);
  HELD.delete(scope);
  const said = instead ?? held;
  if (said !== undefined && said !== null) emit(scope, said.chosen, said.rationale);
}
