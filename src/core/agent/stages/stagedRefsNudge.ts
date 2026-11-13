/**
 * stages/stagedRefsNudge — the staged-refs nudge at the stage level: the two
 * record inputs seed writes for it, and the line one request carries.
 *
 * The join and the sentence are pure (`../stagedRefs.ts`). What a stage adds
 * is the RECORD around them: seed commits the `wants` declarations and the
 * receipt of the tickets the library placed (`../placedTickets.ts`), so a
 * rebuild (`time-travel/servedView/requestOnly.ts`) composes the same line
 * from committed state; CallLLM composes the line for one request and records
 * that it fired (`agentfootprint.agent.grounding_nudged`).
 *
 * @example
 * ```ts
 * seedStagedRefs(scope, deps.toolWantsByName, resume?.placedTickets); // in seed
 * const nudge = stagedRefsNudgeFor(scope, messages, toolWants, served, iteration); // in CallLLM
 * ```
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage, LLMToolSchema } from '../../../provider-contract/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import { seededTickets, type PlacedTicket } from '../placedTickets.js';
import { findStagedRefs, stagedRefsNudgeLine } from '../stagedRefs.js';
import type { AgentState } from '../types.js';

/**
 * Seed's half. The `wants` declarations (9.88.0) are the one input to the
 * nudge that was build-time-only, so they are committed — value-conditional,
 * under the same condition request assembly uses. Then the receipt: the
 * tickets a continued conversation carried, or `[]` on an agent whose nudge is
 * armed, so a recording says it kept the receipt before its first placement.
 * An agent with neither writes neither key.
 */
export function seedStagedRefs(
  scope: TypedScope<AgentState>,
  toolWantsByName: AgentState['toolWantsByName'],
  carried: readonly PlacedTicket[] | undefined,
): void {
  if (toolWantsByName !== undefined) {
    scope.toolWantsByName = toolWantsByName;
  }
  const tickets = seededTickets(carried, toolWantsByName !== undefined);
  if (tickets !== undefined) scope.placedTickets = tickets;
}

/**
 * CallLLM's half: the line for this request, or `undefined`. Judged on
 * `served` — the tools REALLY served this call, so a withheld surface arms
 * nothing and a synthetic schema tool is never named a spender — and on the
 * committed receipt, so only a ticket the library placed is named. Each
 * firing is recorded as `agentfootprint.agent.grounding_nudged`.
 */
export function stagedRefsNudgeFor(
  scope: TypedScope<AgentState>,
  messages: readonly LLMMessage[],
  toolWants: ReadonlyMap<string, readonly string[]>,
  served: readonly LLMToolSchema[],
  iteration: number,
): LLMMessage | undefined {
  const names = new Set(served.map((t) => t.name));
  const match = findStagedRefs(messages, toolWants, names, scope.placedTickets);
  if (match === undefined) return undefined;
  typedEmit(scope, 'agentfootprint.agent.grounding_nudged', {
    iteration,
    refs: match.refs.map((r) => ({ ref: r.ref, kind: r.kind })),
    ...(match.refsOmitted > 0 && { refsOmitted: match.refsOmitted }),
    tools: [...match.tools],
  });
  return { role: 'user', content: stagedRefsNudgeLine(match) };
}
