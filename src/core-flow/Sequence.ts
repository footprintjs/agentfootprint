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
import type { StructureRecorder } from 'footprintjs';
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

export interface SequenceOptions {
  /** Human-friendly name for events + topology. Default: 'Sequence'. */
  readonly name?: string;
  /** Stable id used for topology + events. Default: 'sequence'. */
  readonly id?: string;
  /**
   * Optional build-time recorders passed through to footprintjs's
   * `flowChart()` factory. Each recorder observes per-node build
   * events (`onStageAdded` / `onSubflowMounted` / etc.) for this
   * composition's internal chart (Seed + each step mount + Finalize).
   *
   * Cascade: each step runner attaches its OWN recorders at its own
   * construction time. footprintjs does NOT propagate StructureRecorders
   * into mounted subflows — attach the same recorders to every nested
   * composition for full coverage.
   *
   * When omitted, no build-time observation is wired up.
   */
  readonly structureRecorders?: readonly StructureRecorder[];
  /**
   * Optional per-COMPOSITION translator (UI-agnostic). See
   * `core/translator.ts`. When attached, `runner.getUIGroup()` invokes
   * it with the Sequence's `GroupMetadata` (kind `'Sequence'`, id,
   * name, ordered steps, no extras) and returns whatever shape the
   * translator produces. When omitted, `getUIGroup()` returns
   * `undefined`.
   */
  readonly groupTranslator?: GroupTranslator;
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
  /** Optional per-method translator override for THIS step only. */
  readonly groupTranslator?: GroupTranslator;
}

/**
 * Options bag accepted by `SequenceBuilder.step()` for per-method
 * overrides. Backwards-compatible — when omitted the legacy two-arg
 * `.step(id, runner)` signature still works.
 */
export interface SequenceStepOptions {
  /** Per-method translator override. See `StepEntry.groupTranslator`. */
  readonly groupTranslator?: GroupTranslator;
}

interface SequenceState {
  [k: string]: unknown;
}

export class Sequence extends RunnerBase<SequenceInput, SequenceOutput> {
  readonly name: string;
  readonly id: string;
  private readonly steps: readonly StepEntry[];
  private readonly opts: SequenceOptions;

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  constructor(opts: SequenceOptions, steps: readonly StepEntry[]) {
    super();
    this.opts = opts;
    this.name = opts.name ?? 'Sequence';
    this.id = opts.id ?? 'sequence';
    if (steps.length === 0) {
      throw new Error('Sequence: must have at least one .step()');
    }
    this.steps = steps;
    // Eager chart construction — see `RunnerBase.initChart` JSDoc.
    this.initChart(() => this.buildChart());
  }

  static create(opts: SequenceOptions = {}): SequenceBuilder {
    return new SequenceBuilder(opts);
  }

  // `getSpec()` inherited from RunnerBase — returns the cached chart.

  // ─── UI group translation (L1b) ───────────────────────────────
  protected override getGroupTranslator(): GroupTranslator | undefined {
    return this.opts.groupTranslator;
  }

  /** Sequence is a flat ordered list of steps. One member per step,
   *  preserving definition order so the consumer can render them
   *  linearly (default Lens UX). Per-method overrides (L1c) take
   *  precedence over the step runner's own translator. */
  protected override buildUIGroupMetadata(): GroupMetadata {
    const members: GroupMember[] = this.steps.map((s) => ({
      memberId: s.id,
      runner: s.runner,
      uiGroup:
        s.groupTranslator !== undefined
          ? s.runner.getUIGroupWith(s.groupTranslator)
          : s.runner.getUIGroup(),
    }));
    return {
      kind: 'Sequence',
      id: this.id,
      name: this.name,
      members,
    };
  }

  async run(
    input: SequenceInput,
    options?: RunOptions,
  ): Promise<SequenceOutput | RunnerPauseOutcome> {
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
      {
        ...(this.opts.structureRecorders !== undefined && {
          structureRecorders: [...this.opts.structureRecorders],
        }),
        description: `Sequence: ${steps.length}-step pipeline`,
      },
    );

    // Mount each step as a subflow via addSubFlowChartNext. The step's
    // input comes from parent.current (mapped via mapFromPrev); the
    // step's return becomes parent.current (via outputMapper).
    for (const step of steps) {
      builder = builder.addSubFlowChartNext(`step-${step.id}`, step.runner.getSpec(), step.id, {
        inputMapper: (parent) => step.mapFromPrev((parent.current as string) ?? ''),
        // `sfOutput` is the subflow's TraversalResult — for Runner-backed
        // subflows whose last stage returns a string, sfOutput IS that
        // string. We pipe it into parent.current for the next step's
        // inputMapper to pick up.
        outputMapper: (sfOutput) => ({
          current: typeof sfOutput === 'string' ? sfOutput : '',
        }),
      });
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
          name: compositionName,
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
   *
   * Optional third arg `opts.groupTranslator` overrides the runner's
   * own constructor-level translator for THIS step only — only its
   * `member.uiGroup` flips to the override's output.
   */
  step(id: string, runner: StepChild, opts?: SequenceStepOptions): this {
    if (this.seenIds.has(id)) {
      throw new Error(`Sequence.step(): duplicate step id '${id}'`);
    }
    this.seenIds.add(id);
    const mapFromPrev = this.pendingPipe ?? defaultMapBetween;
    this.pendingPipe = undefined;
    this.steps.push({
      id,
      runner,
      mapFromPrev,
      ...(opts?.groupTranslator !== undefined && {
        groupTranslator: opts.groupTranslator,
      }),
    });
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
