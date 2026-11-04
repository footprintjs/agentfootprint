/**
 * llmSwarm adapts a shared roster to the typed routing strategy and Swarm.
 * Each dispatched agent turn needs one routing call. A final halt decision
 * is returned as data; there is no speculative call after the handoff budget.
 */

import type { LLMProvider } from '../provider-contract/types.js';
import type { Runner } from '../core/runner.js';
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
   * own default). The router runs once per dispatch; no extra call follows the budget.
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
 * not in the roster follows `swarm()`'s existing law (the native halt branch returns that decision's message), so a hallucinated agent
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

  return swarm({
    agents: opts.agents,
    router,
    ...(opts.maxHandoffs !== undefined && { maxHandoffs: opts.maxHandoffs }),
    id,
    name,
  });
}
