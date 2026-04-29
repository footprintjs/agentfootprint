/**
 * Conditional — routing composition: evaluates branches in order, runs the first match.
 *
 * Pattern: Builder (GoF) + Adapter over footprintjs's `addDeciderFunction`.
 * Role:    core-flow/ layer. Picks exactly ONE branch based on a predicate
 *          (sync function of input) OR an LLM decision. Chosen branch
 *          receives `{ message }` and returns a string.
 * Emits:   agentfootprint.composition.enter / exit +
 *          composition.route_decided (via compositionRecorder).
 *
 * v1 of this primitive supports `.when(id, predicate, runner)` + `.otherwise(id, runner)`.
 * LLM-gated routing (`.whenLLM(id, prompt, runner)`) lands in Phase 5.
 */

import {
  FlowChartExecutor,
  flowChart,
  type FlowChart,
  type FlowchartCheckpoint,
  type RunOptions,
  type TypedScope,
} from 'footprintjs';
import type { RunnerPauseOutcome } from '../core/pause.js';
import type { Runner } from '../core/runner.js';
import { RunnerBase, makeRunId } from '../core/RunnerBase.js';
import type { RunContext } from '../bridge/eventMeta.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { compositionRecorder } from '../recorders/core/CompositionRecorder.js';
import { typedEmit } from '../recorders/core/typedEmit.js';

export interface ConditionalOptions {
  readonly name?: string;
  readonly id?: string;
}

export interface ConditionalInput {
  readonly message: string;
}

export type ConditionalOutput = string;

type BranchChild = Runner<{ message: string }, string>;

export type Predicate = (input: ConditionalInput) => boolean;

interface BranchEntry {
  readonly id: string;
  readonly name: string;
  readonly runner: BranchChild;
  /** Undefined for the `otherwise` fallback. */
  readonly predicate?: Predicate;
}

interface ConditionalState {
  [k: string]: unknown;
}

export class Conditional extends RunnerBase<ConditionalInput, ConditionalOutput> {
  readonly name: string;
  readonly id: string;
  private readonly branches: readonly BranchEntry[];
  private readonly fallbackId: string;

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  constructor(opts: ConditionalOptions, branches: readonly BranchEntry[], fallbackId: string) {
    super();
    this.name = opts.name ?? 'Conditional';
    this.id = opts.id ?? 'conditional';
    if (branches.length < 2) {
      throw new Error('Conditional: must have at least one .when() branch plus an .otherwise()');
    }
    this.branches = branches;
    this.fallbackId = fallbackId;
  }

  static create(opts: ConditionalOptions = {}): ConditionalBuilder {
    return new ConditionalBuilder(opts);
  }

  toFlowChart(): FlowChart {
    return this.buildChart();
  }

  async run(
    input: ConditionalInput,
    options?: RunOptions,
  ): Promise<ConditionalOutput | RunnerPauseOutcome> {
    const executor = this.createExecutor();
    const result = await executor.run({
      input: { message: input.message },
      ...(options ?? {}),
    });
    return this.finalizeResult(executor, result);
  }

  async resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<ConditionalOutput | RunnerPauseOutcome> {
    this.emitPauseResume(checkpoint, input);
    const executor = this.createExecutor();
    const result = await executor.resume(checkpoint, input, options);
    return this.finalizeResult(executor, result);
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Conditional:${this.id}`],
    };

    const chart = this.buildChart();
    const executor = new FlowChartExecutor(chart);

    const dispatcher = this.getDispatcher();
    const getRunCtx = (): RunContext => this.currentRunContext;

    executor.attachCombinedRecorder(new ContextRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(streamRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(agentRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(compositionRecorder({ dispatcher, getRunContext: getRunCtx }));
    for (const r of this.attachedRecorders) executor.attachCombinedRecorder(r);
    return executor;
  }

  private finalizeResult(
    executor: FlowChartExecutor,
    result: unknown,
  ): ConditionalOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    if (typeof result === 'string') return result;
    throw new Error('Conditional: unexpected result shape — expected string');
  }

  private buildChart(): FlowChart {
    const branches = this.branches;
    const fallbackId = this.fallbackId;
    const compositionId = this.id;
    const compositionName = this.name;

    const seed = (scope: TypedScope<ConditionalState>) => {
      const args = scope.$getArgs<ConditionalInput>();
      scope.userMessage = args.message;
      typedEmit(scope, 'agentfootprint.composition.enter', {
        kind: 'Conditional',
        id: compositionId,
        name: compositionName,
        childCount: branches.length,
      });
    };

    /**
     * Decider — pure sync function returning the chosen branch id.
     * Fires composition.route_decided event with rationale so consumers
     * can explain WHY the route was picked.
     */
    const decider = (scope: TypedScope<ConditionalState>): string => {
      const input: ConditionalInput = {
        message: (scope.userMessage as string) ?? '',
      };

      let chosen = fallbackId;
      let rationale = `no .when() predicate matched — fell through to ${fallbackId}`;
      for (const b of branches) {
        if (b.predicate === undefined) continue; // skip the fallback
        if (b.predicate(input)) {
          chosen = b.id;
          rationale = `predicate for '${b.id}' returned true`;
          break;
        }
      }

      typedEmit(scope, 'agentfootprint.composition.route_decided', {
        conditionalId: compositionId,
        chosen,
        rationale,
      });

      return chosen;
    };

    // Root description prefix `Conditional:` is the taxonomy marker —
    // see FlowchartRecorder.mapTopologyToSteps for the consumer side.
    const base = flowChart<ConditionalState>(
      'Seed',
      seed,
      'seed',
      undefined,
      `Conditional: ${branches.length}-branch routing`,
    );
    let decList = base.addDeciderFunction(
      'Route',
      decider,
      'route',
      'Conditional branch selection',
    );
    for (const b of branches) {
      decList = decList.addSubFlowChartBranch(b.id, b.runner.toFlowChart(), b.name, {
        inputMapper: (parent) => ({ message: (parent.userMessage as string) ?? '' }),
        // Branch's string return becomes sfOutput; propagate to parent
        // as `result` for the Finalize stage to read.
        outputMapper: (sfOutput) => ({
          result: typeof sfOutput === 'string' ? sfOutput : '',
        }),
      });
    }
    let builder = decList.setDefault(fallbackId).end();

    // After the decider + chosen branch returns, emit composition.exit
    // and pass the branch's result as the executor's TraversalResult.
    builder = builder.addFunction(
      'Finalize',
      (scope: TypedScope<ConditionalState>) => {
        // The chosen branch's return is carried as the previous stage's
        // output. We read `scope.__branchResult` which the decider chain
        // writes via outputMapper? Actually footprintjs threads the
        // branch output as the NEXT stage's input argument — but we're
        // using `addFunction` which gets the SAME scope.
        //
        // Easier: each branch writes `scope.result`, and Finalize reads it.
        // But we don't control branch internals. Instead, read from the
        // stage chain's most-recent return via the executor.
        //
        // Pragmatic approach: return an empty string here and rely on
        // the decider branch being the LAST stage in its arm. Actually
        // that doesn't work either — decider WITH branches means each
        // branch IS a subflow, and THIS `Finalize` runs AFTER the branch
        // joins. What we want is the BRANCH's return.
        //
        // footprintjs behavior: stages chained after a decider receive
        // the chosen branch's subflow result via their first-arg.
        // Unfortunately `addFunction` receives only scope, not the
        // result.
        //
        // Solution: have each branch's outputMapper write scope.result,
        // then read it here.
        typedEmit(scope, 'agentfootprint.composition.exit', {
          kind: 'Conditional',
          id: compositionId,
          status: 'ok',
          durationMs: Date.now() - this.currentRunContext.runStartMs,
        });
        return (scope.result as string | undefined) ?? '';
      },
      'finalize',
      'Conditional finalize',
    );

    return builder.build();
  }
}

/**
 * Fluent builder. Branches evaluate in registration order; first matching
 * predicate wins. `.otherwise()` is the mandatory fallback.
 */
export class ConditionalBuilder {
  private readonly opts: ConditionalOptions;
  private readonly branches: BranchEntry[] = [];
  private fallbackRegistered = false;
  private fallbackId = '';
  private readonly seenIds = new Set<string>();

  constructor(opts: ConditionalOptions) {
    this.opts = opts;
  }

  /**
   * Register a predicate-gated branch. `predicate` is a pure sync function
   * of the Conditional's input; if it returns true, the corresponding
   * runner executes. Branches evaluate in registration order.
   */
  when(id: string, predicate: Predicate, runner: BranchChild, name?: string): this {
    if (this.seenIds.has(id)) {
      throw new Error(`Conditional.when(): duplicate branch id '${id}'`);
    }
    this.seenIds.add(id);
    this.branches.push({ id, runner, predicate, name: name ?? id });
    return this;
  }

  /**
   * Register the fallback branch. Exactly ONE must be registered before build().
   */
  otherwise(id: string, runner: BranchChild, name?: string): this {
    if (this.fallbackRegistered) {
      throw new Error('Conditional.otherwise(): already registered');
    }
    if (this.seenIds.has(id)) {
      throw new Error(`Conditional.otherwise(): duplicate branch id '${id}'`);
    }
    this.seenIds.add(id);
    this.branches.push({ id, runner, name: name ?? id });
    this.fallbackId = id;
    this.fallbackRegistered = true;
    return this;
  }

  build(): Conditional {
    if (!this.fallbackRegistered) {
      throw new Error(
        'Conditional.build(): missing .otherwise() — every Conditional needs a fallback branch',
      );
    }
    return new Conditional(this.opts, this.branches, this.fallbackId);
  }
}
