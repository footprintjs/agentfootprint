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
  flowChart,
  type FlowChart,
  type FlowchartCheckpoint,
  type StructureRecorder,
  type TypedScope,
} from 'footprintjs';
import type { RunOptions } from '../core/runner.js';
import type { GroupMember, GroupMetadata, GroupTranslator } from '../core/translator.js';
import type { RunnerPauseOutcome } from '../core/pause.js';
import type { Runner } from '../core/runner.js';
import { RunnerBase, type RunnerCoreValues } from '../core/RunnerBase.js';
import type { RunnerInvocation } from '../core/runnerExecution.js';
import { normalizeRunInput } from '../core/runInput.js';
import { parentRunIn, readsParentRun, withParentRun } from '../core/memberRun.js';
import { requestOf } from '../core/requestOfRun.js';
import type { MemoryIdentity } from '../memory/identity/types.js';
import { typedEmit } from '../recorders/core/typedEmit.js';
import { carryVerdict, childOutcome, raiseChildVerdict } from './childOutcome.js';
import { composedInput, readsMessageFromIfAny } from '../core/messageFrom.js';
import { adoptMemberRedaction } from '../redaction/declared.js';

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
  /**
   * WHO this run is for — the same tuple as `AgentInput.identity`. Every
   * member runs for it: its memory, its tools' `ctx.identity`. Omitted, every
   * member runs under this run's own conversation (`{ conversationId: runId }`),
   * never a namespace another run shares (`core/memberRun.ts`).
   */
  readonly identity?: MemoryIdentity;
}

export type LoopOutput = string;

type BodyChild = Runner<{ message: string }, string>;

/**
 * Predicate evaluated AFTER each body iteration. Return true to exit the loop.
 *
 * `latestOutput` is the body's STRING output — by design (B15): the whole
 * core-flow layer composes `Runner<{ message: string }, string>`, and the
 * Loop chart's outputMapper coerces any non-string body output to `''`.
 * For structured exit conditions today, have the body emit JSON (e.g. an
 * Agent with `.outputSchema(...)`) and parse inside the guard:
 *
 * ```ts
 * .until(({ latestOutput }) => {
 *   try { return (JSON.parse(latestOutput) as { done: boolean }).done; }
 *   catch { return false; } // not JSON (yet) — keep looping
 * })
 * ```
 *
 * A typed guard (`Loop<T>` with a structured body output) would require
 * genericizing the Runner output contract shared by Sequence / Parallel /
 * Conditional — tracked as a future enhancement, not in core today.
 */
export type UntilGuard = (ctx: {
  readonly iteration: number;
  readonly latestOutput: string;
  readonly startMs: number;
}) => boolean;

import { clampIterations, HARD_ITERATION_CAP } from '../lib/iterationBudget.js';

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
    // A Loop whose body reads `messageFrom` reads it too (`core/messageFrom.ts`).
    readsMessageFromIfAny(this, [body]);
    // The body's redaction policy covers this composition's run — the body runs
    // on its executor (`src/redaction/declared.ts`).
    adoptMemberRedaction(this, [body]);
    // It hands the run it serves to its members (`core/memberRun.ts`).
    readsParentRun(this);
    // Eager chart construction — see `RunnerBase.initChart` JSDoc.
    this.initChart(() => this.buildChart(), {
      runnerId: this.id,
      compositionPath: [`Loop:${this.id}`],
      initialize: () => ({}),
    });
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

  async run(
    input: LoopInput | string,
    options?: RunOptions,
  ): Promise<LoopOutput | RunnerPauseOutcome> {
    return this.runExecution().withRun(async (invocation) => {
      const request = requestOf(options, 'Loop.run');
      const runInput = normalizeRunInput<LoopInput>(input, 'Loop.run');
      this.prepareCompositionRun(invocation, runInput.identity, request, 'Loop.run');
      const prepared = this.compositionRunSetup(invocation);
      const result = await invocation.execute(
        { kind: 'run', options: { ...options, input: { message: runInput.message } } },
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
  ): Promise<LoopOutput | RunnerPauseOutcome> {
    this.noteResumeTakenUp(checkpoint);
    return this.runExecution().withRun(async (invocation) => {
      const request = requestOf(options, 'Loop.resume');
      this.prepareCompositionResume(invocation, checkpoint, request, 'Loop.resume');
      const resumeLeg = this.emitPauseResume(checkpoint, input);
      const prepared = this.compositionRunSetup(invocation, resumeLeg);
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
  ): LoopOutput | RunnerPauseOutcome {
    const paused = this.detectPause(invocation, result);
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
      this.enterComposition(scope, args, 'Loop');
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
      // A body that ended on a verdict ends the loop with its error (`childOutcome.ts`).
      raiseChildVerdict((key) => scope.$getValue(key));
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
          durationMs: Date.now() - this.runExecution().forScope(scope).context.runStartMs,
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
    return flowChart<LoopState>('Initialize', seed, 'seed', {
      ...(this.opts.structureRecorders !== undefined && {
        structureRecorders: [...this.opts.structureRecorders],
      }),
      description: 'Loop: iterated body',
    })
      .addFunction('IterationStart', iterationStart, 'iteration-start', 'Loop iteration marker')
      .addSubFlowChartNext('body', body.getSpec(), 'body', {
        // After the first iteration the body is handed its OWN previous output —
        // another run's words, marked for a runner that reads the marker
        // (`core/messageFrom.ts` · `composedInput`); every other body gets the
        // input it always did.
        inputMapper: (parent) => {
          const input = { message: (parent.current as string) ?? '' };
          const mapped =
            ((parent.iteration as number | undefined) ?? 1) > 1 || parent.messageFrom === 'composed'
              ? composedInput(body, input)
              : input;
          // Every iteration runs for this run (`core/memberRun.ts`).
          return withParentRun(mapped, parentRunIn(parent), body);
        },
        // Body's string return becomes next iteration's input via `current`;
        // a body that ended on a verdict carries it onto the loop's state.
        outputMapper: (sfOutput) => {
          const outcome = childOutcome(body, sfOutput);
          if ('verdict' in outcome) return { current: '', ...carryVerdict(outcome.verdict) };
          return { current: typeof outcome.answer === 'string' ? outcome.answer : '' };
        },
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
   *
   * `latestOutput` is the body's string output. For structured exit
   * conditions, emit JSON from the body and parse it inside the guard —
   * see the `UntilGuard` JSDoc for the pattern and the design rationale.
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
