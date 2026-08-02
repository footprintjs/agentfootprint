/**
 * workflow() — sequential steps whose hand-offs are checked by the compiler.
 *
 * WHY this exists: `Sequence` is the workhorse for "A, then B, then C",
 * and every step it accepts has the same shape — takes `{ message }`,
 * returns `string`. That is exactly right for chaining LLM calls, and
 * exactly wrong the moment a step wants to hand the next one something
 * structured: `Sequence` coerces any non-string step output to `''`
 * (Sequence.ts, the step `outputMapper`), so a step that returns a parsed
 * ticket silently hands the next step nothing at all. The mistake shows up
 * as an empty prompt three steps later, at runtime, in production.
 *
 * `workflow()` closes that gap from both ends:
 *
 *   - **At compile time** — step N's OUTPUT type must be what step N+1
 *     accepts. A `Runner<{ message: string }, Ticket>` followed by a
 *     `Runner<{ orderId: string }, string>` does not compile. The chain is
 *     proven before you run it, not debugged after.
 *   - **At run time** — a step's value is handed to the next step
 *     UNCHANGED. Objects stay objects. The one convenience is the house
 *     convention: a step that returns a `string` feeds the next step's
 *     `{ message }`, because that is what every LLM runner here wants.
 *
 * Pattern: Adapter over footprintjs's `addSubFlowChartNext`, with the
 *          type-level handoff proof carried by overloads (1–8 steps).
 * Role:    core-flow/ layer, alongside Sequence/Parallel/Conditional/Loop.
 *          Pure control flow — no LLM dependency.
 * Emits:   agentfootprint.composition.enter / exit, reported as kind
 *          `'Sequence'` — a workflow IS a sequential composition, and
 *          widening the public `CompositionKind` union would break
 *          exhaustive switches in consumer code for no behavioural gain.
 *
 * THREE HONEST LIMITS, all inherited from the engine and all verified in
 * `test/core-flow/scenario/Workflow.test.ts` — worth knowing before you
 * put rich objects on the wire:
 *
 *   1. Only PLAIN DATA crosses a step boundary. A value with a prototype
 *      (Date, Map, Set, a class instance) arrives as `{}`, and `undefined`
 *      fields are dropped. Send strings, numbers, arrays and plain
 *      objects; send a timestamp as an ISO string, not a `Date`.
 *   2. A step must RETURN its output — the value handed forward is the
 *      step chart's traversal result. A step whose last stage returns
 *      nothing hands its whole scope forward instead.
 *   3. The workflow's own input keys stay visible to LATER steps too
 *      (footprintjs's `getArgs()` inherits the run's arguments). A key the
 *      previous step actually produced always wins; a key it did NOT
 *      produce can still be read from the original input rather than
 *      coming back `undefined`.
 *
 * @example  a typed three-step chain
 * ```ts
 * interface Ticket { orderId: string; angry: boolean }
 *
 * const parse: Runner<{ message: string }, Ticket> = …;
 * const lookup: Runner<Ticket, { refundUsd: number }> = …;
 * const reply: Runner<{ refundUsd: number }, string> = …;
 *
 * const intake = workflow(parse, lookup, reply);
 * const answer = await intake.run({ message: 'where is my refund?' });
 * //    ^? string — the chain's last output type
 *
 * workflow(parse, reply); // ✗ compile error: Ticket is not { refundUsd }
 * ```
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
import type { RunContext } from '../bridge/eventMeta.js';
import type { RunnerPauseOutcome } from '../core/pause.js';
import type { Runner } from '../core/runner.js';
import { RunnerBase, makeRunId } from '../core/RunnerBase.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { compositionRecorder } from '../recorders/core/CompositionRecorder.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { typedEmit } from '../recorders/core/typedEmit.js';

/**
 * What the NEXT step must accept, given what the previous one returns.
 *
 * A `string` output feeds `{ message }` — the convention every runner in
 * this library already speaks (LLMCall, Agent, Sequence, Swarm). Anything
 * else is handed over as-is, so the next step's input type must be that
 * same type.
 */
export type NextStepInput<TPreviousOutput> = TPreviousOutput extends string
  ? { message: string }
  : TPreviousOutput;

/** Any runner, viewed only as "a thing with a chart" — the workflow never
 *  needs a step's own input/output types at run time. */
type AnyStep = Runner<never, unknown>;

export interface WorkflowOptions {
  /** Human-friendly name for events + topology. Default `'Workflow'`. */
  readonly name?: string;
  /** Stable id used for topology + events. Default `'workflow'`. */
  readonly id?: string;
  /**
   * Optional build-time recorders passed through to footprintjs's
   * `flowChart()` factory — they observe this workflow's own nodes (Seed +
   * one mount per step + Finalize). Not propagated into the mounted step
   * charts; attach them to each step runner for full coverage.
   */
  readonly structureRecorders?: readonly StructureRecorder[];
}

interface WorkflowState {
  [k: string]: unknown;
}

/**
 * Hand the previous step's value to the next step as its input args.
 *
 * `string` → `{ message }` (the house convention). Plain object → itself.
 * Anything else is a broken hand-off and says so loudly: the alternative
 * is an empty input three steps downstream with nothing pointing back
 * here.
 */
function toStepArgs(value: unknown, stepNumber: number): Record<string, unknown> {
  if (typeof value === 'string') return { message: value };
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  const got = value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value;
  throw new Error(
    `workflow: step ${stepNumber - 1} handed forward ${got}, but step ${stepNumber} needs an ` +
      'object (or a string, which arrives as { message }). Make each step return its output.',
  );
}

/**
 * A sequential composition that passes values through untouched. Build one
 * with {@link workflow} — that factory carries the type-level chain proof.
 */
export class Workflow<TIn extends object = object, TOut = unknown> extends RunnerBase<TIn, TOut> {
  readonly name: string;
  readonly id: string;
  private readonly steps: readonly AnyStep[];
  private readonly opts: WorkflowOptions;

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  constructor(steps: readonly AnyStep[], opts: WorkflowOptions = {}) {
    super();
    if (steps.length === 0) {
      throw new Error('Workflow: must have at least one step');
    }
    this.opts = opts;
    this.name = opts.name ?? 'Workflow';
    this.id = opts.id ?? 'workflow';
    this.steps = steps;
    // Eager chart construction — see `RunnerBase.initChart` JSDoc.
    this.initChart(() => this.buildChart());
  }

  async run(input: TIn, options?: RunOptions): Promise<TOut | RunnerPauseOutcome> {
    const executor = this.createExecutor();
    this.lastExecutor = executor;
    const result = await executor.run({ input: { ...input }, ...(options ?? {}) });
    return this.finalizeResult(executor, result);
  }

  async resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<TOut | RunnerPauseOutcome> {
    this.emitPauseResume(checkpoint, input);
    const executor = this.createExecutor();
    this.lastExecutor = executor;
    const result = await executor.resume(checkpoint, input, options);
    return this.finalizeResult(executor, result);
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Workflow:${this.id}`],
    };

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

  private finalizeResult(executor: FlowChartExecutor, result: unknown): TOut | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    return result as TOut;
  }

  private buildChart(): FlowChart {
    const steps = this.steps;
    const compositionId = this.id;
    const compositionName = this.name;

    const seed = (scope: TypedScope<WorkflowState>) => {
      // The workflow's own input IS step 1's input — no unwrapping, no
      // re-wrapping; that is the whole point of the typed chain.
      scope.current = scope.$getArgs<Record<string, unknown>>();
      typedEmit(scope, 'agentfootprint.composition.enter', {
        kind: 'Sequence',
        id: compositionId,
        name: compositionName,
        childCount: steps.length,
      });
    };

    // Root description prefix `Sequence:` is the taxonomy marker every
    // consumer (Lens, FlowchartRecorder.mapTopologyToSteps) already reads.
    let builder = flowChart<WorkflowState>('Seed', seed, 'seed', {
      ...(this.opts.structureRecorders !== undefined && {
        structureRecorders: [...this.opts.structureRecorders],
      }),
      description: `Sequence: ${steps.length}-step typed workflow`,
    });

    steps.forEach((step, index) => {
      const stepNumber = index + 1;
      builder = builder.addSubFlowChartNext(
        `step-${stepNumber}`,
        step.getSpec(),
        `Step ${stepNumber}`,
        {
          inputMapper: (parent) => toStepArgs(parent.current, stepNumber),
          // Untouched: whatever the step's chart returned is what the next
          // step (or the caller) receives. No string coercion.
          outputMapper: (sfOutput) => ({ current: sfOutput }),
        },
      );
    });

    builder = builder.addFunction(
      'Finalize',
      (scope: TypedScope<WorkflowState>) => {
        typedEmit(scope, 'agentfootprint.composition.exit', {
          kind: 'Sequence',
          id: compositionId,
          name: compositionName,
          status: 'ok',
          durationMs: Date.now() - this.currentRunContext.runStartMs,
        });
        return scope.current;
      },
      'finalize',
      'Workflow finalize',
    );

    return builder.build();
  }
}

// ─── The typed factory ───────────────────────────────────────────────

/**
 * Chain 1–8 runners into one, with every hand-off checked by the compiler.
 *
 * Step N's output type must be what step N+1 accepts — a `string` output
 * feeds the next step's `{ message }` (the house convention), anything
 * else is handed over as-is. A chain that does not line up is a COMPILE
 * error, not a silent empty value at run time.
 *
 * @example  LLM steps chain as they always have
 * ```ts
 * const draft = LLMCall.create({ provider, model }).system('Draft it.').build();
 * const edit = LLMCall.create({ provider, model }).system('Tighten it.').build();
 *
 * const pipeline = workflow(draft, edit);
 * const text = await pipeline.run({ message: 'a note about refunds' });
 * ```
 *
 * @example  structured hand-offs survive
 * ```ts
 * const classify: Runner<{ message: string }, { topic: string }> = …;
 * const answer: Runner<{ topic: string }, string> = …;
 *
 * await workflow(classify, answer).run({ message: 'my card was declined' });
 * ```
 */
export function workflow<A extends object, B>(s1: Runner<A, B>): Workflow<A, B>;
export function workflow<A extends object, B, C>(
  s1: Runner<A, B>,
  s2: Runner<NextStepInput<B>, C>,
): Workflow<A, C>;
export function workflow<A extends object, B, C, D>(
  s1: Runner<A, B>,
  s2: Runner<NextStepInput<B>, C>,
  s3: Runner<NextStepInput<C>, D>,
): Workflow<A, D>;
export function workflow<A extends object, B, C, D, E>(
  s1: Runner<A, B>,
  s2: Runner<NextStepInput<B>, C>,
  s3: Runner<NextStepInput<C>, D>,
  s4: Runner<NextStepInput<D>, E>,
): Workflow<A, E>;
export function workflow<A extends object, B, C, D, E, F>(
  s1: Runner<A, B>,
  s2: Runner<NextStepInput<B>, C>,
  s3: Runner<NextStepInput<C>, D>,
  s4: Runner<NextStepInput<D>, E>,
  s5: Runner<NextStepInput<E>, F>,
): Workflow<A, F>;
export function workflow<A extends object, B, C, D, E, F, G>(
  s1: Runner<A, B>,
  s2: Runner<NextStepInput<B>, C>,
  s3: Runner<NextStepInput<C>, D>,
  s4: Runner<NextStepInput<D>, E>,
  s5: Runner<NextStepInput<E>, F>,
  s6: Runner<NextStepInput<F>, G>,
): Workflow<A, G>;
export function workflow<A extends object, B, C, D, E, F, G, H>(
  s1: Runner<A, B>,
  s2: Runner<NextStepInput<B>, C>,
  s3: Runner<NextStepInput<C>, D>,
  s4: Runner<NextStepInput<D>, E>,
  s5: Runner<NextStepInput<E>, F>,
  s6: Runner<NextStepInput<F>, G>,
  s7: Runner<NextStepInput<G>, H>,
): Workflow<A, H>;
export function workflow<A extends object, B, C, D, E, F, G, H, I>(
  s1: Runner<A, B>,
  s2: Runner<NextStepInput<B>, C>,
  s3: Runner<NextStepInput<C>, D>,
  s4: Runner<NextStepInput<D>, E>,
  s5: Runner<NextStepInput<E>, F>,
  s6: Runner<NextStepInput<F>, G>,
  s7: Runner<NextStepInput<G>, H>,
  s8: Runner<NextStepInput<H>, I>,
): Workflow<A, I>;
export function workflow(...steps: readonly AnyStep[]): Workflow<never, never> {
  if (steps.length === 0) {
    throw new Error('workflow(): needs at least one step');
  }
  return new Workflow(steps) as Workflow<never, never>;
}
