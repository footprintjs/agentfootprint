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
 * iteration, naming the branch taken. A citation override also keeps both decisions:
 *
 *   holdRouteAnnouncement(scope);            // before `decide(scope)`
 *   …decider calls emitRouteDecided → kept, not emitted
 *   announceHeld(scope)                // 'final' as the decider said, or
 *   announceHeld(scope, { chosen: 'negative-recheck', rationale, reasons })
 *
 * Keyed by the stage's own scope object (the per-invocation channel
 * `prepareFinal.ts` · `RAILS_REFUSED` uses), so no state is written and an
 * agent without such a wrapper never holds anything.
 */

import type { TypedScope } from 'footprintjs';
import type { AgentRouteDecidedPayload } from '../../../events/payloads.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentState } from '../types.js';
import type { RouteBranch } from './route.js';

interface Announcement {
  readonly chosen: RouteBranch;
  readonly rationale: string;
}

type RouteDecisions = AgentRouteDecidedPayload['routeDecisions'];
type Override = NonNullable<RouteDecisions>['override'];

/** The held scopes: `null` while held with nothing announced yet. */
const HELD = new WeakMap<object, Announcement | null>();

/** Hold the Route decider's announcement for `scope` until `announceHeld`. */
export function holdRouteAnnouncement(scope: object): void {
  HELD.set(scope, null);
}

function announceRoute(
  scope: TypedScope<AgentState>,
  chosen: RouteBranch,
  rationale: string,
  routeDecisions?: RouteDecisions,
): void {
  typedEmit(scope, 'agentfootprint.agent.route_decided', {
    turnIndex: 0,
    iterIndex: scope.iteration as number,
    chosen,
    rationale,
    ...(routeDecisions !== undefined && { routeDecisions }),
  });
}

/** Publish the Route decision unless the validation wrapper is still resolving it. */
export function emitRouteDecided(
  scope: TypedScope<AgentState>,
  chosen: RouteBranch,
  rationale: string,
): void {
  if (HELD.has(scope)) HELD.set(scope, { chosen, rationale });
  else announceRoute(scope, chosen, rationale);
}

/**
 * End the hold and announce once: `instead` when given, else what the decider
 * said. A second call (a `finally` after an early release) announces nothing.
 */
export function announceHeld(
  scope: TypedScope<AgentState>,
  instead?: Pick<Override, 'chosen' | 'reasons'> & Pick<Announcement, 'rationale'>,
): void {
  if (!HELD.has(scope)) return;
  const held = HELD.get(scope);
  HELD.delete(scope);
  const said = instead ?? held;
  if (said === undefined || said === null) return;
  const decisions: RouteDecisions =
    held?.chosen === 'final' && instead !== undefined
      ? {
          provisional: { chosen: held.chosen, label: 'route-chose-to-finish' },
          override: { chosen: instead.chosen, reasons: instead.reasons },
        }
      : undefined;
  announceRoute(scope, said.chosen, said.rationale, decisions);
}
