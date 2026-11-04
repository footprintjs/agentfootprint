/**
 * Swarm is a bounded native chart: route once, dispatch once, decide whether
 * to continue. The typed decision travels in that invocation's chart state.
 * A pure route function and a native routing strategy are exclusive shapes.
 */
import { flowChart, type FlowChart, type FlowchartCheckpoint, type TypedScope } from 'footprintjs';
import { RunnerBase, type RunnerCoreValues } from '../core/RunnerBase.js';
import type { Runner, RunOptions } from '../core/runner.js';
import type { RunnerInvocation } from '../core/runnerExecution.js';
import type { RunnerPauseOutcome } from '../core/pause.js';
import type { GroupMetadata } from '../core/translator.js';
import type { MemoryIdentity } from '../memory/identity/types.js';
import { normalizeRunInput } from '../core/runInput.js';
import { requestOf } from '../core/requestOfRun.js';
import { parentRunIn, readsParentRun, withParentRun } from '../core/memberRun.js';
import { composedInput, readsMessageFromIfAny } from '../core/messageFrom.js';
import { adoptMemberRedaction } from '../redaction/declared.js';
import { assertUnreservedSubflowSegment } from '../lib/conventions.js';
import { clampIterations } from '../lib/iterationBudget.js';
import { carryVerdict, childOutcome, raiseChildVerdict } from '../core-flow/childOutcome.js';
import { typedEmit } from '../recorders/core/typedEmit.js';
import { requireRoutingDecision, type RoutingDecision, type RoutingStrategy } from './routing.js';

export interface SwarmAgent {
  readonly id: string;
  readonly name?: string;
  readonly runner: Runner<{ message: string }, string>;
}
interface SwarmCommon {
  readonly agents: readonly SwarmAgent[];
  /** Agent dispatch budget. Default10, finite integer1..500, like Loop. */
  readonly maxHandoffs?: number;
  readonly name?: string;
  readonly id?: string;
}
export type SwarmOptions = SwarmCommon &
  (
    | {
        readonly route: (input: { readonly message: string }) => string | undefined;
        readonly router?: never;
      }
    | { readonly router: RoutingStrategy; readonly route?: never }
  );
interface SwarmState {
  [key: string]: unknown;
  current: string;
  iteration: number;
}

/** Every field is written each time; native merge must clear an old optional value. */
function decisionProjection(decision: RoutingDecision) {
  return {
    message: decision.message,
    agentId: decision.agentId ?? null,
    reason: decision.reason ?? null,
  };
}

function decisionOf(scope: TypedScope<SwarmState>): RoutingDecision {
  const stored = scope.$getValue('routingDecision');
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    throw new TypeError('Swarm: missing invocation routing decision');
  }
  const projection = stored as Record<string, unknown>;
  return requireRoutingDecision({
    message: projection.message,
    ...(projection.agentId !== null && { agentId: projection.agentId }),
    ...(projection.reason !== null && { reason: projection.reason }),
  });
}

class SwarmRunner extends RunnerBase<{ message: string }, string> {
  readonly id: string;
  readonly name: string;
  private readonly agents: readonly SwarmAgent[];
  private readonly route?: SwarmOptions['route'];
  private readonly router?: RoutingStrategy['step'];
  private readonly maxHandoffs: number;

  constructor(options: SwarmOptions) {
    super();
    const hasRoute = typeof options.route === 'function';
    const hasRouter = options.router !== undefined;
    if (hasRoute === hasRouter || (options.route !== undefined && !hasRoute)) {
      throw new TypeError('Swarm: supply exactly one of route or router');
    }
    if (hasRouter && typeof options.router?.step?.getSpec !== 'function') {
      throw new TypeError('Swarm: router must implement RoutingStrategy');
    }
    if (options.agents.length < 2)
      throw new Error('Swarm: must have >= 2 agents (use Agent for 1)');
    const seen = new Set<string>();
    for (const agent of options.agents) {
      assertUnreservedSubflowSegment('Swarm', 'agent id', agent.id);
      if (agent.id === 'done')
        throw new Error(
          'Swarm: agent id "done" is reserved for the halt branch — rename to avoid collision',
        );
      if (seen.has(agent.id)) throw new Error(`Swarm: duplicate agent id '${agent.id}'`);
      seen.add(agent.id);
    }
    this.id = options.id ?? 'swarm';
    this.name = options.name ?? 'Swarm';
    this.agents = Object.freeze(options.agents.map((agent) => Object.freeze({ ...agent })));
    this.route = options.route;
    this.router = options.router?.step;
    this.maxHandoffs = clampIterations(options.maxHandoffs ?? 10);
    const members = [
      ...this.agents.map((agent) => agent.runner),
      ...(this.router ? [this.router] : []),
    ];
    adoptMemberRedaction(this, members);
    readsMessageFromIfAny(this, members);
    readsParentRun(this);
    this.initChart(() => this.buildChart(), {
      runnerId: this.id,
      compositionPath: [`Swarm:${this.id}`],
      initialize: () => ({}),
    });
  }

  protected override buildUIGroupMetadata(): GroupMetadata {
    const members = [
      ...(this.router
        ? [{ memberId: 'router', runner: this.router, uiGroup: this.router.getUIGroup() }]
        : []),
      ...this.agents.map((agent) => ({
        memberId: agent.id,
        runner: agent.runner,
        uiGroup: agent.runner.getUIGroup(),
      })),
    ];
    return {
      kind: 'Loop',
      id: this.id,
      name: this.name,
      members,
      extra: { maxIterations: this.maxHandoffs },
    };
  }

  async run(
    input: { message: string } | string,
    options?: RunOptions,
  ): Promise<string | RunnerPauseOutcome> {
    return this.runExecution().withRun(async (invocation) => {
      const request = requestOf(options, 'Swarm.run');
      const normalized = normalizeRunInput<{ message: string; identity?: MemoryIdentity }>(
        input,
        'Swarm.run',
      );
      this.prepareCompositionRun(invocation, normalized.identity, request, 'Swarm.run');
      const prepared = this.compositionRunSetup(invocation);
      const result = await invocation.execute(
        { kind: 'run', options: { ...options, input: { message: normalized.message } } },
        prepared.setup,
        prepared.binding,
      );
      return this.finalizeResult(invocation, result);
    });
  }

  async resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<string | RunnerPauseOutcome> {
    this.noteResumeTakenUp(checkpoint);
    return this.runExecution().withRun(async (invocation) => {
      const request = requestOf(options, 'Swarm.resume');
      this.prepareCompositionResume(invocation, checkpoint, request, 'Swarm.resume');
      const prepared = this.compositionRunSetup(
        invocation,
        this.emitPauseResume(checkpoint, input),
      );
      const result = await invocation.execute(
        { kind: 'resume', mode: 'fresh', checkpoint, input, options },
        prepared.setup,
        prepared.binding,
      );
      return this.finalizeResult(invocation, result);
    });
  }

  private finalizeResult(
    invocation: RunnerInvocation<RunnerCoreValues>,
    result: unknown,
  ): string | RunnerPauseOutcome {
    const paused = this.detectPause(invocation, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    if (typeof result !== 'string') throw new TypeError('Swarm: expected a string result');
    return result;
  }

  private finish(scope: TypedScope<SwarmState>, reason: 'budget' | 'guard_false'): string {
    typedEmit(scope, 'agentfootprint.composition.iteration_exit', {
      loopId: this.id,
      iteration: scope.iteration,
      reason,
    });
    typedEmit(scope, 'agentfootprint.composition.exit', {
      kind: 'Loop',
      id: this.id,
      name: this.name,
      status: reason === 'budget' ? 'budget_exhausted' : 'ok',
      durationMs: Date.now() - this.runExecution().forScope(scope).context.runStartMs,
    });
    scope.$break();
    return scope.current;
  }

  private buildChart(): FlowChart {
    let builder = flowChart<SwarmState>(
      'Initialize',
      (scope) => {
        const args = scope.$getArgs<{ message: string }>();
        this.enterComposition(scope, args, 'Swarm');
        scope.current = args.message;
        scope.iteration = 0;
        typedEmit(scope, 'agentfootprint.composition.enter', {
          kind: 'Loop',
          id: this.id,
          name: this.name,
          childCount: this.agents.length + (this.router ? 1 : 0),
        });
      },
      'seed',
      { description: 'Loop: typed routing and agent dispatch' },
    ).addFunction(
      'IterationStart',
      (scope) => {
        scope.iteration += 1;
        typedEmit(scope, 'agentfootprint.composition.iteration_start', {
          loopId: this.id,
          iteration: scope.iteration,
        });
      },
      'iteration-start',
    );
    const router = this.router;
    if (router !== undefined) {
      builder = builder.addSubFlowChartNext('router', router.getSpec(), 'Routing decision', {
        inputMapper: (parent) =>
          withParentRun(
            parent.iteration > 1 || parent.messageFrom === 'composed'
              ? composedInput(router, { message: parent.current as string })
              : { message: parent.current as string },
            parentRunIn(parent),
            router,
          ),
        outputMapper: (output) => {
          const outcome = childOutcome(router, output);
          if ('verdict' in outcome) return carryVerdict(outcome.verdict);
          return { routingDecision: decisionProjection(requireRoutingDecision(outcome.answer)) };
        },
      });
    } else {
      const route = this.route!;
      builder = builder.addFunction(
        'Routing decision',
        (scope) => {
          const agentId = route({ message: scope.current });
          if (agentId !== undefined && typeof agentId !== 'string')
            throw new TypeError('Swarm: route must return an agent id or undefined');
          scope.routingDecision = decisionProjection({
            message: scope.current,
            ...(agentId !== undefined && { agentId }),
          });
        },
        'routing-decision',
      );
    }
    let dispatch = builder.addDeciderFunction(
      'Dispatch',
      (scope) => {
        raiseChildVerdict((key) => scope.$getValue(key));
        const decision = decisionOf(scope);
        scope.current = decision.message;
        return decision.agentId !== undefined &&
          this.agents.some((agent) => agent.id === decision.agentId)
          ? decision.agentId
          : 'done';
      },
      'dispatch',
    );
    for (const agent of this.agents) {
      dispatch = dispatch.addSubFlowChartBranch(
        agent.id,
        agent.runner.getSpec(),
        agent.name ?? agent.id,
        {
          inputMapper: (parent) =>
            withParentRun(
              composedInput(agent.runner, { message: parent.current as string }),
              parentRunIn(parent),
              agent.runner,
            ),
          outputMapper: (output) => {
            const outcome = childOutcome(agent.runner, output);
            if ('verdict' in outcome) return { current: '', ...carryVerdict(outcome.verdict) };
            return { current: typeof outcome.answer === 'string' ? outcome.answer : '' };
          },
        },
      );
    }
    builder = dispatch
      .addFunctionBranch('done', 'Done', (scope) => this.finish(scope, 'guard_false'))
      .setDefault('done')
      .end();
    return builder
      .addDeciderFunction(
        'Continue',
        (scope) => {
          raiseChildVerdict((key) => scope.$getValue(key));
          return scope.iteration >= this.maxHandoffs ? 'budget' : 'continue';
        },
        'continue-or-stop',
      )
      .addFunctionBranch('budget', 'Budget exhausted', (scope) => this.finish(scope, 'budget'))
      .addFunctionBranch('continue', 'Continue', (scope) => {
        typedEmit(scope, 'agentfootprint.composition.iteration_exit', {
          loopId: this.id,
          iteration: scope.iteration,
          reason: 'body_complete',
        });
        return scope.current;
      })
      .setDefault('budget')
      .end()
      .loopTo('iteration-start')
      .build();
  }
}

export function swarm(options: SwarmOptions): Runner<{ message: string }, string> {
  return new SwarmRunner(options);
}
