/**
 * Swarm — multi-agent handoff. At each step, an LLM-driven routing
 * decision picks which agent handles the next turn.
 *
 * Origin: OpenAI Swarm experiment (2024). Useful for specialist
 *         routing — each agent has a narrow role + its own tools.
 *
 * Pattern: Factory → produces a `Runner` built from
 *          `Loop(Conditional(route-to-agent))`.
 * Role:    patterns/ layer. Pure composition over existing primitives.
 *          Agent roster is FIXED at build time; the routing decision
 *          is made at runtime by a consumer-supplied `route(input)`
 *          function (sync — pure over `{ message }`).
 *
 * For LLM-driven routing (the classic Swarm style), the consumer
 * composes a "router" LLMCall as the first step of each iteration and
 * parses its response in their `route()` function.
 */

import { flowChart, type FlowChart, type TypedScope } from 'footprintjs';
import { RunnerBase } from '../core/RunnerBase.js';
import type { Runner } from '../core/runner.js';
import { Conditional } from '../core-flow/Conditional.js';
import { Loop } from '../core-flow/Loop.js';

export interface SwarmAgent {
  /** Stable id used in events + routing decisions. */
  readonly id: string;
  /** Display name for topology / narrative. */
  readonly name?: string;
  /** The runner that handles a turn when selected. */
  readonly runner: Runner<{ message: string }, string>;
}

export interface SwarmOptions {
  /**
   * The fixed agent roster. Must contain >= 2 agents. The order doesn't
   * matter — the `route` function selects by id.
   */
  readonly agents: readonly SwarmAgent[];
  /**
   * Routing function — receives the current message and returns the
   * selected agent's id. Pure sync; evaluated before each iteration's
   * chosen agent runs. Return `undefined` or an unknown id to halt
   * the swarm (the loop's `until` guard fires).
   */
  readonly route: (input: { readonly message: string }) => string | undefined;
  /** Max hand-offs before the loop halts. Default 10. */
  readonly maxHandoffs?: number;
  readonly name?: string;
  readonly id?: string;
}

/**
 * Build a Swarm Runner. Each iteration:
 *   1. Router evaluates `route(input)` to pick an agent id.
 *   2. Conditional dispatches to that agent's runner.
 *   3. Agent's output becomes the next iteration's input.
 * Loop halts when `route` returns a halt-sentinel id (or unknown id
 * falling to the `done` branch) OR when `maxHandoffs` is reached.
 */
export function swarm(opts: SwarmOptions): Runner<{ message: string }, string> {
  if (opts.agents.length < 2) {
    throw new Error('Swarm: must have >= 2 agents (use Agent for 1)');
  }
  const routeFn = opts.route;
  const ids = new Set(opts.agents.map((a) => a.id));
  if (ids.has('done')) {
    throw new Error(
      'Swarm: agent id "done" is reserved for the halt branch — rename to avoid collision',
    );
  }
  const maxHandoffs = opts.maxHandoffs ?? 10;

  // Build the routing conditional. One `.when(id, ...)` per agent; the
  // routing function's return-value drives branch selection.
  let conditional = Conditional.create({ id: 'route' });
  for (const agent of opts.agents) {
    conditional = conditional.when(
      agent.id,
      (input) => routeFn(input) === agent.id,
      agent.runner,
      agent.name ?? agent.id,
    );
  }
  const routing = conditional.otherwise('done', new IdentityRunner()).build();

  // Wrap in Loop so handoffs iterate. Exit guard: when `route` returns
  // a halt sentinel, the next `Conditional.when` evaluation fires the
  // `done` fallback; the body returns the identity output. To stop the
  // loop at that point we use the `until` guard inspecting whether the
  // current message was produced by the identity path — heuristically,
  // we halt when `route(latestOutput)` returns undefined or 'done'.
  return Loop.create({
    id: opts.id ?? 'swarm',
    name: opts.name ?? 'Swarm',
  })
    .repeat(routing)
    .times(maxHandoffs)
    .until(({ latestOutput }) => {
      const next = routeFn({ message: latestOutput });
      return next === undefined || next === 'done' || !ids.has(next);
    })
    .build();
}

/**
 * Identity runner — echoes its input message unchanged. Used as the
 * Swarm's `otherwise` fallback so the loop can exit cleanly when the
 * router returns a halt sentinel. Not exported (internal-only).
 */
class IdentityRunner extends RunnerBase<{ message: string }, string> {
  readonly id = 'done';
  readonly name = 'Done';

  toFlowChart(): FlowChart {
    // `message` is reserved as the readonly input key  runners;
    // shadow it with `echoedMessage` inside scope to keep the identity
    // stage writable.
    interface IdentityState {
      echoedMessage: string;
    }
    return flowChart<IdentityState>(
      'Done',
      (scope: TypedScope<IdentityState>) => {
        scope.echoedMessage = scope.$getArgs<{ message: string }>().message;
      },
      'done-seed',
    )
      .addFunction(
        'Return',
        (scope: TypedScope<IdentityState>) => scope.echoedMessage,
        'done-return',
      )
      .build();
  }

  async run(input: { message: string }): Promise<string> {
    return input.message;
  }

  async resume(): Promise<string> {
    throw new Error('Swarm IdentityRunner does not support pause/resume');
  }
}
