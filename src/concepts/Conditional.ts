/**
 * Conditional — branch to a runner based on predicates (DAG "if/else").
 *
 * Thin wrapper over footprintjs `addDeciderFunction` + `addFunctionBranch`.
 * A conditional is a top-level routing decision between runners — distinct
 * from `Agent.route()`, which branches INSIDE a ReAct loop. Use Conditional
 * when the shape is "pick one runner and return its result" (triage, content
 * classification, policy routing).
 *
 * Predicates are evaluated in the order `.when()` was called; first match
 * wins. If every predicate misses, the `otherwise` branch runs. A predicate
 * that throws is treated as a miss (fail-open) and the next branch is tried.
 *
 * @example
 * ```ts
 * import { Conditional, Agent, RAG } from 'agentfootprint';
 *
 * const triage = Conditional.create({ name: 'triage' })
 *   .when((input) => input.includes('refund'), refundAgent)
 *   .when((input) => input.length > 500, ragRunner)
 *   .otherwise(generalAgent)
 *   .build();
 *
 * const result = await triage.run('I want a refund please');
 * // Narrative: "[triage] Chose refundAgent — predicate 0 matched"
 * ```
 *
 * Conditional is a runner itself — plug it into `FlowChart`, `Parallel`,
 * `Agent.route()`, or another `Conditional`. Composes like any other concept.
 *
 * ## Why this exists alongside footprintjs primitives
 *
 * footprintjs gives you `addDeciderFunction` + `addFunctionBranch` + `decide()`
 * at the stage level. Conditional wraps those so you can compose **runners**
 * (Agent, RAG, Swarm, user-built) instead of stage functions. Same underlying
 * engine, same narrative, same evidence capture from `decide()`.
 */

import {
  flowChart as buildFlowChart,
  FlowChartExecutor,
  MetricRecorder,
  decide,
} from 'footprintjs';
import type { FlowChart as FlowChartDef, TypedScope } from 'footprintjs';

import type { RunnerLike, TraversalResult, AgentResultEntry } from '../types';
import type { AgentRecorder } from '../core';
import { runnerAsStage } from '../stages/runnerAsStage';
import { RecorderBridge } from '../recorders/RecorderBridge';
import { annotateSpecIcons } from './specIcons';
import { createAgentRenderer } from '../lib/narrative';

/** Predicate tested against the input string + scope state. */
export type ConditionalPredicate = (input: string, state: Record<string, unknown>) => boolean;

interface ConditionalBranch {
  readonly id: string;
  readonly name: string;
  readonly predicate: ConditionalPredicate;
  readonly runner: RunnerLike;
}

export interface ConditionalOptions {
  /** Name for narrative + spec. Defaults to `'conditional'`. */
  readonly name?: string;
}

/** Valid characters for a branch ID that feeds into runtimeStageId. */
const VALID_BRANCH_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isRunnerLike(x: unknown): x is RunnerLike {
  return x !== null && typeof x === 'object' && typeof (x as { run?: unknown }).run === 'function';
}

/**
 * Builder for the Conditional concept. Each `.when()` adds a predicate →
 * runner branch. `.otherwise()` sets the default (required). `.build()`
 * returns a `ConditionalRunner`.
 */
export class Conditional {
  private readonly conditionalName: string;
  private readonly branches: ConditionalBranch[] = [];
  private defaultRunner?: RunnerLike;
  private defaultName = 'Default';
  private readonly recorders: AgentRecorder[] = [];

  private constructor(options: ConditionalOptions) {
    this.conditionalName = options.name ?? 'conditional';
  }

  static create(options: ConditionalOptions = {}): Conditional {
    return new Conditional(options);
  }

  /**
   * Add a predicate → runner branch. Predicates are evaluated in the order
   * they were added; first match wins. A throwing predicate is treated as a
   * miss (fail-open) so a faulty branch never blocks a valid one.
   *
   * The `id` + optional `name` appear in narrative / decision evidence.
   */
  when(
    predicate: ConditionalPredicate,
    runner: RunnerLike,
    options?: { id?: string; name?: string },
  ): this {
    if (typeof predicate !== 'function') {
      throw new TypeError(
        'Conditional.when: predicate must be a function (input, state) => boolean.',
      );
    }
    if (!isRunnerLike(runner)) {
      throw new TypeError(
        'Conditional.when: runner must expose a run() method. Pass a built runner (Agent, LLMCall, etc.).',
      );
    }
    const id = options?.id ?? `branch-${this.branches.length}`;
    if (id === 'default') {
      throw new Error(
        "Conditional.when: branch ID 'default' is reserved for .otherwise(). Pass a different id.",
      );
    }
    if (!VALID_BRANCH_ID.test(id)) {
      throw new Error(
        `Conditional.when: branch ID '${id}' is invalid. Use alphanumerics, hyphens, or underscores — IDs feed into runtimeStageId and cannot contain '/' or whitespace.`,
      );
    }
    if (this.branches.some((b) => b.id === id)) {
      throw new Error(`Conditional: duplicate branch ID '${id}'.`);
    }
    this.branches.push({
      id,
      name: options?.name ?? id,
      predicate,
      runner,
    });
    return this;
  }

  /** Set the default runner — runs when every `.when()` predicate misses. */
  otherwise(runner: RunnerLike, options?: { name?: string }): this {
    if (!isRunnerLike(runner)) {
      throw new TypeError(
        'Conditional.otherwise: runner must expose a run() method. Pass a built runner (Agent, LLMCall, etc.).',
      );
    }
    this.defaultRunner = runner;
    if (options?.name) this.defaultName = options.name;
    return this;
  }

  recorder(rec: AgentRecorder): this {
    this.recorders.push(rec);
    return this;
  }

  build(): ConditionalRunner {
    if (this.branches.length === 0) {
      throw new Error(
        'Conditional requires at least one .when() branch. Use FlowChart for unconditional single-runner pipelines.',
      );
    }
    if (!this.defaultRunner) {
      throw new Error(
        'Conditional requires .otherwise(runner) — a default branch. Without it, an input matching nothing has no runner to route to.',
      );
    }
    return new ConditionalRunner({
      name: this.conditionalName,
      branches: [...this.branches],
      defaultRunner: this.defaultRunner,
      defaultName: this.defaultName,
      recorders: [...this.recorders],
    });
  }
}

interface ConditionalRunnerOptions {
  readonly name: string;
  readonly branches: readonly ConditionalBranch[];
  readonly defaultRunner: RunnerLike;
  readonly defaultName: string;
  readonly recorders: readonly AgentRecorder[];
}

/**
 * Widens MultiAgentState so `runnerAsStage` (typed against MultiAgentState)
 * can be dropped into a Conditional's flowchart without a cast. `agentResults`
 * is populated by branch stages and surfaces in `getSnapshot()` for inspection.
 */
interface ConditionalState {
  pipelineInput: string;
  result: string;
  agentResults: AgentResultEntry[];
  messages: unknown[];
  systemPrompt: string;
  [key: string]: unknown;
}

/**
 * Runner produced by `Conditional.build()`. Exposes the same surface as other
 * runners: `run`, `getNarrative`, `getNarrativeEntries`, `getSnapshot`,
 * `getSpec`, `toFlowChart`. Composes into FlowChart / Parallel / Agent.route
 * like any other runner.
 */
export class ConditionalRunner {
  private readonly opts: ConditionalRunnerOptions;
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;
  private readonly narrativeRenderer = createAgentRenderer();

  constructor(opts: ConditionalRunnerOptions) {
    this.opts = opts;
  }

  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<TraversalResult> {
    const startTime = Date.now();
    const bridge =
      this.opts.recorders.length > 0 ? new RecorderBridge([...this.opts.recorders]) : null;

    bridge?.dispatchTurnStart(message);

    const chart = this.buildChart();

    const executor = new FlowChartExecutor(chart, { enrichSnapshots: true });
    executor.enableNarrative({ renderer: this.narrativeRenderer });
    executor.attachRecorder(new MetricRecorder('metrics'));

    try {
      await executor.run({
        input: { message },
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
    } catch (err) {
      bridge?.dispatchError('llm', err);
      throw err;
    }

    this.lastExecutor = executor;

    const snapshot = executor.getSnapshot();
    const state = snapshot?.sharedState ?? {};
    const content = (state.result as string) ?? '';

    bridge?.dispatchTurnComplete(content, 0);

    return {
      content,
      agents: [],
      totalLatencyMs: Date.now() - startTime,
    };
  }

  private buildChart(): FlowChartDef {
    // Seed stage: store pipeline input so runner stages can read it.
    const seedStage = (scope: TypedScope<ConditionalState>) => {
      const args = scope.$getArgs<{ message: string }>();
      scope.pipelineInput = args?.message ?? '';
    };

    // Decider: evaluate predicates in order. Use decide() so the matched
    // branch id appears in the narrative as decision evidence.
    //
    // `decide()` returns a `DecisionResult<T>` — we extract `.value` to
    // satisfy footprintjs's `addDeciderFunction` signature (string branch id).
    // The full DecisionResult is still captured internally by the engine so
    // it appears in the narrative / FlowRecorder `onDecision` evidence field.
    const branches = this.opts.branches;
    const deciderFn = (scope: TypedScope<ConditionalState>): string => {
      const input = scope.pipelineInput ?? '';
      // Frozen state snapshot so a predicate can't accidentally mutate scope.
      // Only exposes well-known fields — predicates must not depend on
      // arbitrary scope keys (that's what stages are for).
      const state: Readonly<Record<string, unknown>> = Object.freeze({
        pipelineInput: input,
      });
      // decide() returns a DecisionResult whose `.branch` is the chosen id.
      // footprintjs's addDeciderFunction accepts DecisionResult directly, but
      // we extract `.branch` for a clearer string-typed return.
      const result = decide(
        scope,
        branches.map((b) => ({
          when: () => {
            // Fail-open on throw so a broken predicate can't block other
            // matching branches. Coerce non-boolean truthy returns to true.
            try {
              return Boolean(b.predicate(input, state));
            } catch {
              return false;
            }
          },
          then: b.id,
          label: b.name,
        })),
        'default',
      );
      return result.branch;
    };

    let builder = buildFlowChart<ConditionalState>('Seed', seedStage, 'seed');
    let decider = builder.addDeciderFunction(
      'Route',
      deciderFn,
      `${this.opts.name}-decide`,
      'Pick the branch whose predicate matches first.',
    );

    // Mount every branch as `runnerAsStage` — it calls `runner.run(input)`
    // and writes the output to `scope.result` on the parent. This keeps
    // propagation simple: whichever branch fires, its content ends up on
    // `result` for the caller to read. Subflow-mount variants (for UI
    // drill-down) can be added behind a flag if/when needed.
    for (const b of this.opts.branches) {
      decider = decider.addFunctionBranch(
        b.id,
        b.name,
        runnerAsStage({ id: b.id, name: b.name, runner: b.runner }),
      );
    }

    decider = decider.addFunctionBranch(
      'default',
      this.opts.defaultName,
      runnerAsStage({
        id: 'default',
        name: this.opts.defaultName,
        runner: this.opts.defaultRunner,
      }),
    );

    builder = decider.setDefault('default').end();

    this.lastSpec = annotateSpecIcons(builder.toSpec());
    return builder.build();
  }

  /** Get the flowchart spec (stage graph metadata). */
  getSpec(): unknown {
    if (!this.lastSpec) {
      this.buildChart();
    }
    return this.lastSpec;
  }

  /** Expose the flowchart definition so this runner can be mounted as a subflow. */
  toFlowChart(): FlowChartDef {
    return this.buildChart();
  }

  /** Get the narrative from the last run. */
  getNarrative(): string[] {
    return this.lastExecutor?.getNarrative() ?? [];
  }

  /** Get structured narrative entries from the last run. */
  getNarrativeEntries() {
    return this.lastExecutor?.getNarrativeEntries() ?? [];
  }

  /** Get the full execution snapshot from the last run. */
  getSnapshot() {
    return this.lastExecutor?.getSnapshot();
  }
}
