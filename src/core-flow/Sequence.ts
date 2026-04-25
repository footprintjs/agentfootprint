/**
 * Sequence — sequential composition of runners (steps chained one after another).
 *
 * Pattern: Builder (GoF) + Adapter over footprintjs's `addSubFlowChartNext`.
 * Role:    core-flow/ layer — pure control flow, no LLM deps.
 *          Each step's output becomes the next step's input; default
 *          mapping is string chaining (step N's return → step N+1's
 *          `{ message }`). Custom mapping via `.mapBetween(fn)` between
 *          any two steps.
 * Emits:   agentfootprint.composition.enter / exit (via compositionRecorder).
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

export interface SequenceOptions {
  /** Human-friendly name for events + topology. Default: 'Sequence'. */
  readonly name?: string;
  /** Stable id used for topology + events. Default: 'sequence'. */
  readonly id?: string;
}

export interface SequenceInput {
  readonly message: string;
}

export type SequenceOutput = string;

/** Default string→{message} mapper used between consecutive steps. */
const defaultMapBetween = (prev: string): { message: string } => ({ message: prev });

type StepChild = Runner<{ message: string }, string>;

interface StepEntry {
  readonly id: string;
  readonly runner: StepChild;
  /** Mapper applied BEFORE this step's run(). */
  readonly mapFromPrev: (prev: string) => { message: string };
}

interface SequenceState {
  [k: string]: unknown;
}

export class Sequence extends RunnerBase<SequenceInput, SequenceOutput> {
  readonly name: string;
  readonly id: string;
  private readonly steps: readonly StepEntry[];

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  constructor(opts: SequenceOptions, steps: readonly StepEntry[]) {
    super();
    this.name = opts.name ?? 'Sequence';
    this.id = opts.id ?? 'sequence';
    if (steps.length === 0) {
      throw new Error('Sequence: must have at least one .step()');
    }
    this.steps = steps;
  }

  static create(opts: SequenceOptions = {}): SequenceBuilder {
    return new SequenceBuilder(opts);
  }

  toFlowChart(): FlowChart {
    return this.buildChart();
  }

  async run(
    input: SequenceInput,
    options?: RunOptions,
  ): Promise<SequenceOutput | RunnerPauseOutcome> {
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
  ): Promise<SequenceOutput | RunnerPauseOutcome> {
    this.emitPauseResume(checkpoint, input);
    const executor = this.createExecutor();
    const result = await executor.resume(checkpoint, input, options);
    return this.finalizeResult(executor, result);
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Sequence:${this.id}`],
    };

    const chart = this.buildChart();
    const executor = new FlowChartExecutor(chart);

    const dispatcher = this.getDispatcher();
    const getRunCtx = (): RunContext => this.currentRunContext;

    executor.attachCombinedRecorder(
      new ContextRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    executor.attachCombinedRecorder(
      streamRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    executor.attachCombinedRecorder(
      agentRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    executor.attachCombinedRecorder(
      compositionRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    for (const r of this.attachedRecorders) executor.attachCombinedRecorder(r);
    return executor;
  }

  private finalizeResult(
    executor: FlowChartExecutor,
    result: unknown,
  ): SequenceOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    if (typeof result === 'string') return result;
    throw new Error('Sequence: unexpected result shape — expected string');
  }

  private buildChart(): FlowChart {
    const steps = this.steps;
    const compositionId = this.id;
    const compositionName = this.name;

    const seed = (scope: TypedScope<SequenceState>) => {
      const args = scope.$getArgs<SequenceInput>();
      scope.current = args.message;
      typedEmit(scope, 'agentfootprint.composition.enter', {
        kind: 'Sequence',
        id: compositionId,
        name: compositionName,
        childCount: steps.length,
      });
    };

    // Root description prefix `Sequence:` is the taxonomy marker —
    // downstream consumers (Lens, FlowchartRecorder) detect composition
    // primitives via the `<Kind>:` prefix convention. See
    // FlowchartRecorder.mapTopologyToSteps for the consumer side.
    let builder = flowChart<SequenceState>(
      'Seed',
      seed,
      'seed',
      undefined,
      `Sequence: ${steps.length}-step pipeline`,
    );

    // Mount each step as a subflow via addSubFlowChartNext. The step's
    // input comes from parent.current (mapped via mapFromPrev); the
    // step's return becomes parent.current (via outputMapper).
    for (const step of steps) {
      builder = builder.addSubFlowChartNext(
        `step-${step.id}`,
        step.runner.toFlowChart(),
        step.id,
        {
          inputMapper: (parent) =>
            step.mapFromPrev((parent.current as string) ?? ''),
          // `sfOutput` is the subflow's TraversalResult — for Runner-backed
          // subflows whose last stage returns a string, sfOutput IS that
          // string. We pipe it into parent.current for the next step's
          // inputMapper to pick up.
          outputMapper: (sfOutput) => ({
            current: typeof sfOutput === 'string' ? sfOutput : '',
          }),
        },
      );
    }

    // Final stage: emit composition.exit and return the current string
    // so executor.run() yields it as the TraversalResult.
    builder = builder.addFunction(
      'Finalize',
      (scope: TypedScope<SequenceState>) => {
        const current = (scope.current as string) ?? '';
        typedEmit(scope, 'agentfootprint.composition.exit', {
          kind: 'Sequence',
          id: compositionId,
          status: 'ok',
          durationMs: Date.now() - this.currentRunContext.runStartMs,
        });
        return current;
      },
      'finalize',
      'Sequence finalize',
    );

    return builder.build();
  }
}

/**
 * Fluent builder. Reads as natural English:
 *   Sequence.create().step('a', A).pipeVia(fn).step('b', B).build()
 *   →  "Sequence: step A, pipe via fn, step B."
 *
 * `step(id, runner)` adds a sequential step. `pipeVia(fn)` customises
 * the transformation of the previous step's output before it feeds the
 * next step (otherwise the default string-chain mapper is used).
 */
export class SequenceBuilder {
  private readonly opts: SequenceOptions;
  private readonly steps: StepEntry[] = [];
  /** Pending pipeVia transformer for the NEXT step (consumed on .step()). */
  private pendingPipe?: (prev: string) => { message: string };
  private readonly seenIds = new Set<string>();

  constructor(opts: SequenceOptions) {
    this.opts = opts;
  }

  /**
   * Add a step. Runner must accept `{ message: string }` and return `string`.
   * First step receives the Sequence input; subsequent steps receive the
   * previous step's output (via the default string-chain mapper, or via
   * the transformer set by a preceding `.pipeVia(fn)` call).
   */
  step(id: string, runner: StepChild): this {
    if (this.seenIds.has(id)) {
      throw new Error(`Sequence.step(): duplicate step id '${id}'`);
    }
    this.seenIds.add(id);
    const mapFromPrev = this.pendingPipe ?? defaultMapBetween;
    this.pendingPipe = undefined;
    this.steps.push({ id, runner, mapFromPrev });
    return this;
  }

  /**
   * Transform the previous step's string output before it reaches the
   * next step. Consumed once by the next `.step()` call. Default
   * mapping is `(prev) => ({ message: prev })`.
   *
   * Reads as English: `.step('a', A).pipeVia(fn).step('b', B)`
   * →  "step A, pipe via fn, step B"
   */
  pipeVia(fn: (prev: string) => { message: string }): this {
    this.pendingPipe = fn;
    return this;
  }

  build(): Sequence {
    if (this.pendingPipe !== undefined) {
      throw new Error(
        'Sequence.build(): .pipeVia() called with no following .step() to consume it',
      );
    }
    return new Sequence(this.opts, this.steps);
  }
}
