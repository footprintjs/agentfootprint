/**
 * Loop — iteration composition: runs a body runner repeatedly until exit.
 *
 * Pattern: Builder (GoF) + Adapter over footprintjs's `loopTo` + `$break`.
 * Role:    core-flow/ layer. Enables Reflection, Self-Refine, Debate,
 *          Reflexion, Constitutional AI, and any pattern needing
 *          iterative refinement of a composition output.
 * Emits:   agentfootprint.composition.enter / exit +
 *          composition.iteration_start / iteration_exit
 *          (via compositionRecorder).
 *
 * Budget guard is MANDATORY. You must set at least one of:
 *   - maxIterations (default 10 if only .body() is set)
 *   - maxWallclockMs
 * Hard ceiling of 500 iterations prevents runaway loops even if a guard
 * misfires; exceeding it throws.
 */

import {
  FlowChartExecutor,
  flowChart,
  type FlowChart,
  type FlowchartCheckpoint,
  type RunOptions,
  type StructureRecorder,
  type TypedScope,
} from 'footprintjs';
import type {
  GroupMember,
  GroupMetadata,
  GroupTranslator,
} from '../core/translator.js';
import type { RunnerPauseOutcome } from '../core/pause.js';
import type { Runner } from '../core/runner.js';
import { RunnerBase, makeRunId } from '../core/RunnerBase.js';
import type { RunContext } from '../bridge/eventMeta.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { compositionRecorder } from '../recorders/core/CompositionRecorder.js';
import { typedEmit } from '../recorders/core/typedEmit.js';

export interface LoopOptions {
  readonly name?: string;
  readonly id?: string;
  /**
   * Optional build-time recorders passed through to footprintjs's
   * `flowChart()` factory. Each recorder observes per-node build
   * events (`onStageAdded` / `onSubflowMounted` / etc.) for this
   * composition's internal chart (Seed + IterationStart + body mount +
   * Guard). When omitted, no build-time observation is wired up.
   */
  readonly structureRecorders?: readonly StructureRecorder[];
  /**
   * Optional per-COMPOSITION translator (UI-agnostic). See
   * `core/translator.ts`. When attached, `runner.getUIGroup()` invokes
   * it with the Loop's `GroupMetadata` (kind `'Loop'`, id, name, body
   * as the single member, plus iteration budgets in `extra`).
   * Returns `undefined` when omitted.
   */
  readonly groupTranslator?: GroupTranslator;
}

export interface LoopInput {
  readonly message: string;
}

export type LoopOutput = string;

type BodyChild = Runner<{ message: string }, string>;

/** Predicate evaluated AFTER each body iteration. Return true to exit the loop. */
export type UntilGuard = (ctx: {
  readonly iteration: number;
  readonly latestOutput: string;
  readonly startMs: number;
}) => boolean;

const HARD_ITERATION_CAP = 500;

interface LoopState {
  [k: string]: unknown;
}

export class Loop extends RunnerBase<LoopInput, LoopOutput> {
  readonly name: string;
  readonly id: string;
  private readonly body: BodyChild;
  private readonly maxIterations: number;
  private readonly maxWallclockMs: number | undefined;
  private readonly until: UntilGuard | undefined;
  private readonly opts: LoopOptions;
  /** Per-method translator override on `.repeat()`, when set. Applies
   *  to the body member's `uiGroup`. */
  private readonly bodyTranslator: GroupTranslator | undefined;

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  constructor(
    opts: LoopOptions,
    body: BodyChild,
    config: {
      maxIterations: number;
      maxWallclockMs?: number;
      until?: UntilGuard;
      bodyTranslator?: GroupTranslator;
    },
  ) {
    super();
    this.opts = opts;
    this.name = opts.name ?? 'Loop';
    this.id = opts.id ?? 'loop';
    this.body = body;
    this.maxIterations = clampIterations(config.maxIterations);
    this.maxWallclockMs = config.maxWallclockMs;
    this.until = config.until;
    this.bodyTranslator = config.bodyTranslator;
    // Eager chart construction — see `RunnerBase.initChart` JSDoc.
    this.initChart(() => this.buildChart());
  }

  static create(opts: LoopOptions = {}): LoopBuilder {
    return new LoopBuilder(opts);
  }

  // `getSpec()` inherited from RunnerBase — returns the cached chart.

  // ─── UI group translation (L1b) ───────────────────────────────
  protected override getGroupTranslator(): GroupTranslator | undefined {
    return this.opts.groupTranslator;
  }

  /** Loop has a single body member + iteration budgets in `extra`.
   *  Per-method override (L1c) takes precedence over the body
   *  runner's own translator. */
  protected override buildUIGroupMetadata(): GroupMetadata {
    const members: GroupMember[] = [
      {
        memberId: 'body',
        runner: this.body,
        uiGroup:
          this.bodyTranslator !== undefined
            ? this.body.getUIGroupWith(this.bodyTranslator)
            : this.body.getUIGroup(),
      },
    ];
    return {
      kind: 'Loop',
      id: this.id,
      name: this.name,
      members,
      extra: {
        maxIterations: this.maxIterations,
        ...(this.maxWallclockMs !== undefined && {
          maxWallclockMs: this.maxWallclockMs,
        }),
        hasUntilGuard: this.until !== undefined,
      },
    };
  }

  async run(input: LoopInput, options?: RunOptions): Promise<LoopOutput | RunnerPauseOutcome> {
    const executor = this.createExecutor();
    this.lastExecutor = executor;
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
  ): Promise<LoopOutput | RunnerPauseOutcome> {
    this.emitPauseResume(checkpoint, input);
    const executor = this.createExecutor();
    const result = await executor.resume(checkpoint, input, options);
    return this.finalizeResult(executor, result);
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Loop:${this.id}`],
    };

    // Reuse the cached chart built at constructor time.
    const executor = new FlowChartExecutor(this.getSpec());

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
  ): LoopOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    if (typeof result === 'string') return result;
    throw new Error('Loop: unexpected result shape — expected string');
  }

  private buildChart(): FlowChart {
    const body = this.body;
    const maxIterations = this.maxIterations;
    const maxWallclockMs = this.maxWallclockMs;
    const until = this.until;
    const compositionId = this.id;
    const compositionName = this.name;

    const seed = (scope: TypedScope<LoopState>) => {
      const args = scope.$getArgs<LoopInput>();
      scope.current = args.message;
      scope.iteration = 0;
      scope.startMs = Date.now();
      typedEmit(scope, 'agentfootprint.composition.enter', {
        kind: 'Loop',
        id: compositionId,
        name: compositionName,
        childCount: 1,
      });
    };

    const iterationStart = (scope: TypedScope<LoopState>) => {
      const next = ((scope.iteration as number) ?? 0) + 1;
      scope.iteration = next;
      typedEmit(scope, 'agentfootprint.composition.iteration_start', {
        loopId: compositionId,
        iteration: next,
      });
    };

    /**
     * Guard stage — runs AFTER the body subflow completes each iteration.
     * Checks exit conditions; when any fires, emits iteration_exit with
     * the reason + $break terminates the loop.
     */
    const guard = (scope: TypedScope<LoopState>) => {
      const iteration = scope.iteration as number;
      const latestOutput = (scope.current as string) ?? '';
      const startMs = scope.startMs as number;

      let exitReason: 'budget' | 'guard_false' | 'break' | 'body_complete' | undefined;

      if (iteration >= maxIterations) {
        exitReason = 'budget';
      } else if (maxWallclockMs !== undefined && Date.now() - startMs >= maxWallclockMs) {
        exitReason = 'budget';
      } else if (iteration >= HARD_ITERATION_CAP) {
        exitReason = 'budget';
      } else if (until !== undefined && until({ iteration, latestOutput, startMs })) {
        exitReason = 'guard_false';
      }

      if (exitReason !== undefined) {
        typedEmit(scope, 'agentfootprint.composition.iteration_exit', {
          loopId: compositionId,
          iteration,
          reason: exitReason,
        });
        typedEmit(scope, 'agentfootprint.composition.exit', {
          kind: 'Loop',
          id: compositionId,
          name: compositionName,
          status: exitReason === 'budget' ? 'budget_exhausted' : 'ok',
          durationMs: Date.now() - this.currentRunContext.runStartMs,
        });
        // $break stops the flow BEFORE loopTo fires. The latest string
        // output is returned as the executor's TraversalResult.
        scope.$break();
        return latestOutput;
      }

      // Continue looping: emit "body_complete" for the completed iteration
      // before the loopTo takes us back. Next iteration's iterationStart
      // emits iteration_start again.
      typedEmit(scope, 'agentfootprint.composition.iteration_exit', {
        loopId: compositionId,
        iteration,
        reason: 'body_complete',
      });
      return latestOutput;
    };

    // Root description prefix `Loop:` is the taxonomy marker — see
    // FlowchartRecorder.mapTopologyToSteps for the consumer side.
    return flowChart<LoopState>('Seed', seed, 'seed', {
      ...(this.opts.structureRecorders !== undefined && {
        structureRecorders: [...this.opts.structureRecorders],
      }),
      description: 'Loop: iterated body',
    })
      .addFunction('IterationStart', iterationStart, 'iteration-start', 'Loop iteration marker')
      .addSubFlowChartNext('body', body.getSpec(), 'body', {
        inputMapper: (parent) => ({ message: (parent.current as string) ?? '' }),
        // Body's string return becomes next iteration's input via `current`.
        outputMapper: (sfOutput) => ({
          current: typeof sfOutput === 'string' ? sfOutput : '',
        }),
      })
      .addFunction('Guard', guard, 'guard', 'Loop exit-condition guard')
      .loopTo('iteration-start')
      .build();
  }
}

/**
 * Fluent builder. Reads as natural English:
 *   Loop.create().repeat(runner).times(10).forAtMost(30_000).until(fn).build()
 *   →  "Loop: repeat runner, up to 10 times, for at most 30 seconds, until fn."
 *
 * Enforces a body runner is supplied before .build(). Default budget is
 * 10 iterations (hard ceiling 500). Any of .times / .forAtMost / .until
 * can fire to exit the loop.
 */
/**
 * Options bag accepted by `LoopBuilder.repeat()` for per-method overrides.
 */
export interface LoopRepeatOptions {
  /** Per-method translator override for the body runner — overrides
   *  the runner's own constructor-level translator for THIS loop only. */
  readonly groupTranslator?: GroupTranslator;
}

export class LoopBuilder {
  private readonly opts: LoopOptions;
  private _body: BodyChild | undefined;
  private _bodyTranslator: GroupTranslator | undefined;
  private _maxIterations: number | undefined;
  private _maxWallclockMs: number | undefined;
  private _until: UntilGuard | undefined;

  constructor(opts: LoopOptions) {
    this.opts = opts;
  }

  /**
   * The runner that executes each iteration. Required.
   * Each iteration's output string becomes the next iteration's input `{ message }`.
   *
   * Optional second arg `opts.groupTranslator` overrides the body
   * runner's own translator for THIS loop only — only its
   * `member.uiGroup` flips to the override's output.
   */
  repeat(runner: BodyChild, opts?: LoopRepeatOptions): this {
    if (this._body !== undefined) {
      throw new Error('Loop.repeat(): already set');
    }
    this._body = runner;
    if (opts?.groupTranslator !== undefined) {
      this._bodyTranslator = opts.groupTranslator;
    }
    return this;
  }

  /**
   * Maximum iteration count. Default 10 if only `.repeat()` is called.
   * Hard ceiling 500 — larger values are clamped.
   */
  times(n: number): this {
    this._maxIterations = n;
    return this;
  }

  /**
   * Wall-clock time budget in milliseconds. The loop exits at the next
   * guard check after this elapses.
   */
  forAtMost(ms: number): this {
    this._maxWallclockMs = ms;
    return this;
  }

  /**
   * Exit predicate evaluated after each iteration. Return `true` to exit.
   * Receives `{ iteration, latestOutput, startMs }`.
   */
  until(guard: UntilGuard): this {
    this._until = guard;
    return this;
  }

  build(): Loop {
    if (this._body === undefined) {
      throw new Error('Loop.build(): .repeat(runner) is required');
    }
    const maxIterations = this._maxIterations ?? 10;
    return new Loop(this.opts, this._body, {
      maxIterations,
      ...(this._maxWallclockMs !== undefined && { maxWallclockMs: this._maxWallclockMs }),
      ...(this._until !== undefined && { until: this._until }),
      ...(this._bodyTranslator !== undefined && { bodyTranslator: this._bodyTranslator }),
    });
  }
}

function clampIterations(n: number): number {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 1;
  if (n > HARD_ITERATION_CAP) return HARD_ITERATION_CAP;
  return n;
}
