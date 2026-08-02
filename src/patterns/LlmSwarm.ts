/**
 * llmSwarm — the classic Swarm, with the LLM doing the routing.
 *
 * WHY this exists: `swarm()` gives you the hand-off machinery but asks you
 * for a sync `route()` function; `llmRouter()` gives you the LLM decision
 * but asks you to place it in the chain yourself. Placing it correctly is
 * the fiddly half — the decision for a message must be made BEFORE that
 * message reaches `route()`, which means one router call before the first
 * turn and one after every turn. Get it wrong and the swarm halts on turn
 * one for no visible reason. This wires it, once:
 *
 *   Sequence
 *     ├── router.step                      ← the first decision
 *     └── swarm({ agents, route })         ← Loop(Conditional(agent))
 *           └── per agent: Sequence(agent → router.step)
 *                                            ↑ the next decision, made on
 *                                              the text it hands forward
 *
 * Every `route()` call is then a lookup of a decision already made for
 * that exact message. No LLM call ever happens inside `route()` — which
 * matters, because `swarm()` evaluates it once per branch predicate AND
 * again in the loop's exit guard.
 *
 * Pattern: Facade (GoF) over `llmRouter` + `swarm` + `Sequence`. No new
 *          control flow — everything here is composition.
 *
 * Cost shape: one routing call per turn, plus one to start. A 2-hand-off
 * conversation costs 3 routing calls and 2 specialist calls.
 *
 * @example
 * ```ts
 * const desk = llmSwarm({
 *   provider,
 *   model: 'claude-sonnet-4-5',
 *   agents: [
 *     { id: 'billing', description: 'Invoices, refunds, payment methods.', runner: billingAgent },
 *     { id: 'tech', description: 'Login problems, errors, outages.', runner: techAgent },
 *   ],
 *   maxHandoffs: 4,
 * });
 *
 * desk.on('agentfootprint.composition.route_decided', (e) =>
 *   console.log(e.payload.chosen, '←', e.payload.rationale),
 * );
 *
 * const answer = await desk.run({ message: 'my invoice is wrong' });
 * ```
 */

import type { LLMProvider } from '../adapters/types.js';
import type { Runner } from '../core/runner.js';
import { Sequence } from '../core-flow/Sequence.js';
import { llmRouter, type LlmRouter } from './LlmRouter.js';
import { swarm, type SwarmAgent } from './Swarm.js';

/**
 * A swarm member as the LLM router sees it: the runner that handles a
 * turn, plus the `description` that becomes its line in the router's
 * prompt. One source — the roster the swarm dispatches on and the roster
 * the model reads are the same list.
 */
export interface LlmSwarmAgent extends SwarmAgent {
  /** What this agent handles, in the model's language. Required here:
   *  an agent with no description is invisible to the router. */
  readonly description: string;
}

export interface LlmSwarmOptions {
  /** The LLM that makes the routing decisions (not the specialists' own). */
  readonly provider: LLMProvider;
  /** Model to ask for routing decisions. */
  readonly model: string;
  /** The roster. Two or more; ids must be unique and none may be `'done'`. */
  readonly agents: readonly LlmSwarmAgent[];
  /** Extra authored framing for the router. See `llmRouter`. */
  readonly instruction?: string;
  /** Routing temperature. Default `0`. */
  readonly temperature?: number;
  /**
   * Maximum agent turns before the loop halts. Default 10 (the swarm's
   * own default). The router runs once per turn plus once to start.
   */
  readonly maxHandoffs?: number;
  /** Stable id for the swarm's composition events. Default `'swarm'`. */
  readonly id?: string;
  /** Display name. Default `'Swarm'`. */
  readonly name?: string;
}

/**
 * Build a swarm whose hand-offs are decided by an LLM.
 *
 * Halting: the router omits `agentId` when it judges the work done — the
 * swarm stops and that decision's `message` is the answer. An id that is
 * not in the roster follows `swarm()`'s existing law (the `done` fallback
 * echoes the message and the loop guard halts), so a hallucinated agent
 * ends the run instead of silently picking someone.
 *
 * Watching it: subscribe to `agentfootprint.composition.route_decided` —
 * every decision arrives with the chosen id, a rationale, and the model's
 * own `reason` as evidence. (That reason stays in the trace; it is never
 * fed back into a prompt.)
 */
export function llmSwarm(opts: LlmSwarmOptions): Runner<{ message: string }, string> {
  // Checked here, before the router is built, so the error names the call
  // the consumer actually made.
  if (opts.agents.length < 2) {
    throw new Error('llmSwarm: must have >= 2 agents (use Agent for 1)');
  }
  const id = opts.id ?? 'swarm';
  const name = opts.name ?? 'Swarm';

  const router: LlmRouter = llmRouter({
    provider: opts.provider,
    model: opts.model,
    agents: opts.agents.map((a) => ({ id: a.id, description: a.description })),
    ...(opts.instruction !== undefined && { instruction: opts.instruction }),
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    id: `${id}-router`,
    name: `${name} router`,
  });

  // Each turn is "agent answers, then the router reads that answer" — so
  // the decision for the text the loop carries forward exists before the
  // next iteration's route() and before the loop's exit guard.
  const agents: SwarmAgent[] = opts.agents.map((a) => ({
    id: a.id,
    ...(a.name !== undefined && { name: a.name }),
    runner: Sequence.create({
      id: `${id}-${a.id}-turn`,
      name: `${a.name ?? a.id} turn`,
    })
      .step('agent', a.runner)
      .step('route', router.step)
      .build(),
  }));

  const dispatch = swarm({
    agents,
    route: router.route,
    ...(opts.maxHandoffs !== undefined && { maxHandoffs: opts.maxHandoffs }),
    id,
    name,
  });

  return Sequence.create({ id: `${id}-chain`, name })
    .step('route', router.step)
    .step('swarm', dispatch)
    .build();
}
