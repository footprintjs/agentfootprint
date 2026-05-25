/**
 * Parallel — fan-out composition: N branches run concurrently, then merge.
 *
 * Pattern: Builder (GoF) + Adapter over footprintjs's `addSubFlowChart`
 *          (fork children).
 * Role:    core-flow/ layer. All branches receive the same input
 *          `{ message }`. Each returns a string. A merge step combines
 *          them: either a pure function OR an LLM.
 * Emits:   agentfootprint.composition.enter / exit +
 *          composition.fork_start / branch_complete / merge_end
 *          (via compositionRecorder).
 */

import {
  FlowChartExecutor,
  flowChart,
  isFlowEvent,
  type CombinedRecorder,
  type FlowChart,
  type FlowchartCheckpoint,
  type RunOptions,
  type StructureRecorder,
  type TypedScope,
} from 'footprintjs';
import type { GroupMember, GroupMetadata, GroupTranslator } from '../core/translator.js';
import type { RunnerPauseOutcome } from '../core/pause.js';
import type { LLMMessage, LLMProvider } from '../adapters/types.js';
import type { Runner } from '../core/runner.js';
import { RunnerBase, makeRunId } from '../core/RunnerBase.js';
import type { RunContext } from '../bridge/eventMeta.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { compositionRecorder } from '../recorders/core/CompositionRecorder.js';
import { typedEmit } from '../recorders/core/typedEmit.js';

export interface ParallelOptions {
  readonly name?: string;
  readonly id?: string;
  /**
   * Optional build-time recorders passed through to footprintjs's
   * `flowChart()` factory. Each recorder observes per-node build
   * events (`onStageAdded` / `onSubflowMounted` / etc.) for this
   * composition's internal chart (Seed + each branch mount + Merge).
   *
   * Cascade: each branch runner attaches its OWN recorders at its
   * own construction time. footprintjs does NOT propagate
   * StructureRecorders into mounted subflows — so for full coverage,
   * attach the same recorders to every nested composition. See the
   * core-flow README's "StructureRecorder cascade" section.
   *
   * When omitted, no build-time observation is wired up.
   */
  readonly structureRecorders?: readonly StructureRecorder[];
  /**
   * Optional per-COMPOSITION translator (UI-agnostic). When attached,
   * `runner.getUIGroup()` invokes it with the Parallel's
   * `GroupMetadata` (kind, id, name, branches list, merge strategy)
   * and returns whatever shape the translator produces.
   *
   * Independent of `structureRecorders` — those observe per-node spec
   * events, this shapes whole-composition UI groups. Common case is to
   * thread the SAME `GroupTranslator` reference through every nested
   * composition so `member.uiGroup` is populated recursively; L1c
   * per-method overrides add finer control.
   *
   * When omitted, `getUIGroup()` returns `undefined`.
   */
  readonly groupTranslator?: GroupTranslator;
}

export interface ParallelInput {
  readonly message: string;
}

export type ParallelOutput = string;

type BranchChild = Runner<{ message: string }, string>;

export type MergeFn = (branchResults: Readonly<Record<string, string>>) => string;

/**
 * Outcome per branch in tolerant mode. One of:
 *   - `{ ok: true, value: string }` — branch succeeded; `value` is the returned string
 *   - `{ ok: false, error: string }` — branch threw; `error` is the error message
 *
 * Consumers in tolerant mode receive `Record<branchId, BranchOutcome>` and
 * decide how to handle partial failure (e.g., fall back to a default,
 * log, retry, or surface a user-facing message).
 */
export type BranchOutcome =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

export type MergeOutcomesFn = (outcomes: Readonly<Record<string, BranchOutcome>>) => string;

export interface MergeWithLLMOptions {
  readonly provider: LLMProvider;
  readonly model: string;
  /** Prompt prepended to the branch results when feeding the merge LLM. */
  readonly prompt: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

interface BranchEntry {
  readonly id: string;
  readonly name: string;
  readonly runner: BranchChild;
  /**
   * Optional per-method translator override for THIS branch only.
   * When set, the branch's `member.uiGroup` is produced by invoking
   * this translator against the runner's own `GroupMetadata`, instead
   * of calling `branch.runner.getUIGroup()` (which would use the
   * runner's own constructor-level translator).
   */
  readonly groupTranslator?: GroupTranslator;
}

/**
 * Options bag accepted by `ParallelBuilder.branch()` for per-method
 * overrides. Backwards-compatible with the legacy
 * `.branch(id, runner, name?)` signature: when the third arg is a
 * string it's still treated as `name`.
 */
export interface ParallelBranchOptions {
  /** Human-friendly name for this branch. Default: the branch id. */
  readonly name?: string;
  /** Per-method translator override. See `BranchEntry.groupTranslator`. */
  readonly groupTranslator?: GroupTranslator;
}

type MergeStrategy =
  | { readonly kind: 'fn'; readonly fn: MergeFn }
  | { readonly kind: 'llm'; readonly opts: MergeWithLLMOptions }
  | { readonly kind: 'outcomes-fn'; readonly fn: MergeOutcomesFn };

interface ParallelState {
  [k: string]: unknown;
}

export class Parallel extends RunnerBase<ParallelInput, ParallelOutput> {
  readonly name: string;
  readonly id: string;
  private readonly branches: readonly BranchEntry[];
  private readonly merge: MergeStrategy;
  private readonly opts: ParallelOptions;

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  /**
   * Per-branch first-error messages captured during the current run.
   *
   * Filled by an internal CombinedRecorder attached in `createExecutor()`
   * that observes footprintjs `FlowErrorEvent`s. Errors are keyed by the
   * branch id (the first segment of `traversalContext.subflowPath`); only
   * the first error per branch is kept so the surface mirrors the wrapper
   * `try/catch` semantics that preceded the v0.x architectural refactor.
   *
   * Read by the Merge stage to populate strict-mode error messages and
   * tolerant-mode `BranchOutcome.error` strings. Cleared at the start of
   * every `run()` / `resume()`.
   */
  private readonly branchErrors = new Map<string, string>();

  constructor(opts: ParallelOptions, branches: readonly BranchEntry[], merge: MergeStrategy) {
    super();
    this.opts = opts;
    this.name = opts.name ?? 'Parallel';
    this.id = opts.id ?? 'parallel';
    if (branches.length < 2) {
      throw new Error('Parallel: must have at least 2 branches (use Sequence for a single runner)');
    }
    this.branches = branches;
    this.merge = merge;
    // Eager chart construction — see `RunnerBase.initChart` JSDoc.
    // Safe: the merge stage's closure captures `this.branchErrors`
    // (an instance field initialized at declaration time, line 130),
    // which is set BEFORE the constructor body runs.
    this.initChart(() => this.buildChart());
  }

  static create(opts: ParallelOptions = {}): ParallelBuilder {
    return new ParallelBuilder(opts);
  }

  // `getSpec()` inherited from RunnerBase — returns the cached chart.

  // ─── UI group translation (L1b) ───────────────────────────────
  protected override getGroupTranslator(): GroupTranslator | undefined {
    return this.opts.groupTranslator;
  }

  /**
   * Build the Parallel's `GroupMetadata` — kind `'Parallel'`, with one
   * `GroupMember` per branch. Each member exposes its `runner` plus
   * the runner's own `getUIGroup()` output (when the consumer
   * threaded the same translator through that branch's construction).
   */
  protected override buildUIGroupMetadata(): GroupMetadata {
    const members: GroupMember[] = this.branches.map((b) => ({
      memberId: b.id,
      runner: b.runner,
      // Per-method override (L1c) takes precedence over the branch
      // runner's own constructor-level translator. When present, the
      // override runs against the branch runner's own GroupMetadata
      // and its output becomes `member.uiGroup`. When absent, fall
      // back to `branch.runner.getUIGroup()` which applies the
      // runner's own translator (if any).
      uiGroup:
        b.groupTranslator !== undefined
          ? b.runner.getUIGroupWith(b.groupTranslator)
          : b.runner.getUIGroup(),
    }));
    return {
      kind: 'Parallel',
      id: this.id,
      name: this.name,
      members,
      extra: {
        mergeStrategy: this.merge.kind,
      },
    };
  }

  async run(
    input: ParallelInput,
    options?: RunOptions,
  ): Promise<ParallelOutput | RunnerPauseOutcome> {
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
  ): Promise<ParallelOutput | RunnerPauseOutcome> {
    this.emitPauseResume(checkpoint, input);
    const executor = this.createExecutor();
    const result = await executor.resume(checkpoint, input, options);
    return this.finalizeResult(executor, result);
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Parallel:${this.id}`],
    };

    // Reset per-run branch-error capture. Fork children now mount the
    // branch runner's own chart (no try/catch wrapper); errors are
    // captured via FlowRecorder.onError correlation by subflow path.
    this.branchErrors.clear();

    // Reuse the cached chart built at constructor time.
    const executor = new FlowChartExecutor(this.getSpec());

    const dispatcher = this.getDispatcher();
    const getRunCtx = (): RunContext => this.currentRunContext;

    executor.attachCombinedRecorder(new ContextRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(streamRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(agentRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(compositionRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(this.makeBranchErrorRecorder());
    for (const r of this.attachedRecorders) executor.attachCombinedRecorder(r);
    return executor;
  }

  /**
   * Build the internal recorder that captures first-error-per-branch.
   *
   * footprintjs's `SubflowExecutor` swallows subflow errors into
   * `parentContext.debug.addError(...)` and skips the `outputMapper`,
   * so the failed branch's error message never lands in parent scope.
   * To preserve the per-branch error surface the wrapper-based design
   * provided, we observe `FlowRecorder.onError` and correlate by the
   * first segment of `traversalContext.subflowPath`.
   *
   * Only the FIRST error per branch is kept. Errors fired outside any
   * branch (e.g., a Merge-stage error) are ignored.
   */
  private makeBranchErrorRecorder(): CombinedRecorder {
    const branchIds = new Set(this.branches.map((b) => b.id));
    return {
      id: 'parallel-branch-errors',
      onError: (event) => {
        if (!isFlowEvent(event)) return;
        const ctx = event.traversalContext;
        if (!ctx) return;
        // The branch id is the first segment of the engine-prefixed
        // `stageId` (e.g. `bad/call-llm` → branch `bad`). `subflowPath`
        // is sometimes empty for first-level subflows, and `subflowId`
        // can be deeper than the branch when LLMCall/Agent mount their
        // own internal subflows. The stageId prefix is the canonical
        // origin path.
        const stageId = ctx.stageId ?? '';
        const slash = stageId.indexOf('/');
        const branchId = slash >= 0 ? stageId.slice(0, slash) : undefined;
        if (branchId === undefined || !branchIds.has(branchId)) return;
        if (!this.branchErrors.has(branchId)) {
          // Strip the leading "Error: " that `error.toString()` adds
          // for standard `Error` instances so the captured message
          // matches the original `throw new Error(msg)` reason exactly
          // (consumers expect the bare message). Non-Error throws
          // never carry this prefix, so the strip is a no-op there.
          const m = event.message.startsWith('Error: ')
            ? event.message.slice('Error: '.length)
            : event.message;
          this.branchErrors.set(branchId, m);
        }
      },
    };
  }

  private finalizeResult(
    executor: FlowChartExecutor,
    result: unknown,
  ): ParallelOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    if (typeof result === 'string') return result;
    throw new Error('Parallel: unexpected result shape — expected string');
  }

  private buildChart(): FlowChart {
    const branches = this.branches;
    const merge = this.merge;
    const compositionId = this.id;
    const compositionName = this.name;

    const seed = (scope: TypedScope<ParallelState>) => {
      const args = scope.$getArgs<ParallelInput>();
      scope.userMessage = args.message;
      scope.branchResults = {};
      typedEmit(scope, 'agentfootprint.composition.enter', {
        kind: 'Parallel',
        id: compositionId,
        name: compositionName,
        childCount: branches.length,
      });
      typedEmit(scope, 'agentfootprint.composition.fork_start', {
        parentId: compositionId,
        branches: branches.map((b) => ({ id: b.id, name: b.name })),
      });
    };

    // Root description prefix `Parallel:` is the taxonomy marker — see
    // FlowchartRecorder.mapTopologyToSteps for the consumer side.
    // The 4th arg threads the consumer's `structureRecorders` (when set)
    // into footprintjs's builder so every node in this chart is observed
    // by them at construction time.
    let builder = flowChart<ParallelState>('Seed', seed, 'seed', {
      ...(this.opts.structureRecorders !== undefined && {
        structureRecorders: [...this.opts.structureRecorders],
      }),
      description: `Parallel: ${branches.length}-way fanout`,
    });

    // Fork children — each branch is mounted as a proper subflow via
    // footprintjs's native fork mode. Multiple `addSubFlowChart` calls
    // on the same builder cursor produce a fork node (`type: 'fork'`);
    // `ChildrenExecutor` runs them concurrently via `Promise.allSettled`.
    //
    // The branch's OWN chart (its `getSpec()`) is mounted directly — no
    // wrapper. This preserves the parent's `runtimeStageId` address
    // space across branch internals: every LLM call, tool execution,
    // and commit inside a branch appears in the parent executor's
    // commitLog with a globally-unique id. Recorder events flow
    // naturally — no `scope.$emit` forwarding needed.
    //
    // Error handling: a failing branch's `outputMapper` does NOT fire
    // (footprintjs convention: `subflowError` skips output mapping).
    // The branch id is absent from `branchResults`. The merge stage
    // detects this via `branches.map(b => b.id) \ keys(branchResults)`
    // and either throws (strict mode) or synthesizes `BranchOutcome`
    // entries for the tolerant `outcomes-fn` merge.
    for (const branch of branches) {
      builder = builder.addSubFlowChart(branch.id, branch.runner.getSpec(), branch.name, {
        inputMapper: (parent) => ({ message: (parent.userMessage as string) ?? '' }),
        outputMapper: (sfOutput) => ({
          branchResults: {
            [branch.id]: typeof sfOutput === 'string' ? sfOutput : '',
          },
        }),
      });
    }

    // Merge stage — runs after all fork children complete (join point).
    // Closes over `this.branchErrors` (populated by the internal
    // `parallel-branch-errors` recorder) so per-branch error messages
    // survive subflow boundary swallowing in footprintjs.
    const branchErrors = this.branchErrors;
    const mergeStage = async (scope: TypedScope<ParallelState>): Promise<string> => {
      const results = (scope.branchResults as Record<string, string>) ?? {};

      // Detect failures by absence: any expected branch id missing
      // from `branchResults` is a branch whose `outputMapper` didn't
      // fire — i.e., one whose subflow errored. The specific error
      // message comes from the recorder-captured `branchErrors` map.
      //
      // Caveat: footprintjs does NOT fire `FlowRecorder.onError` for
      // errors thrown INSIDE `applyOutputMapping` (those are caught
      // separately in `SubflowExecutor` and routed to
      // `parentContext.addError('outputMapperError', ...)`). A branch
      // whose subflow completed cleanly but whose outputMapper threw
      // will therefore show up here as a missing id with no entry in
      // `branchErrors` — strict-mode aggregation prints `unknown
      // error` for it and tolerant-mode synthesizes the same string.
      // This is a known gap; see `core-flow/README.md` Decision 8.
      const failedIds = branches.map((b) => b.id).filter((id) => !(id in results));
      const isTolerant = merge.kind === 'outcomes-fn';
      if (failedIds.length > 0 && !isTolerant) {
        typedEmit(scope, 'agentfootprint.composition.exit', {
          kind: 'Parallel',
          id: compositionId,
          name: compositionName,
          status: 'err',
          durationMs: Date.now() - this.currentRunContext.runStartMs,
        });
        const details = failedIds
          .map((id) => `  ${id}: ${branchErrors.get(id) ?? 'unknown error'}`)
          .join('\n');
        throw new Error(
          `Parallel '${compositionId}': ${failedIds.length} branch(es) failed:\n${details}\n` +
            `(use .mergeOutcomesWithFn() for tolerant-mode partial-failure handling)`,
        );
      }

      // Run the merge strategy. Wrap in try/catch so that a merge-stage
      // failure (e.g., merge LLM throws) still produces a
      // `composition.exit` event with `status: 'err'` — without this the
      // event stream would have a `composition.enter` without a matching
      // `composition.exit`, breaking dashboards that pair the two.
      let merged: string;
      try {
        if (merge.kind === 'fn') {
          merged = merge.fn(results);
        } else if (merge.kind === 'llm') {
          merged = await mergeWithLLM(scope, merge.opts, results);
        } else {
          // Tolerant-mode: synthesize BranchOutcome map for the consumer.
          const outcomes: Record<string, BranchOutcome> = {};
          for (const b of branches) {
            if (b.id in results) {
              outcomes[b.id] = { ok: true, value: results[b.id]! };
            } else {
              outcomes[b.id] = {
                ok: false,
                error: branchErrors.get(b.id) ?? 'unknown error',
              };
            }
          }
          merged = merge.fn(outcomes);
        }
      } catch (err) {
        typedEmit(scope, 'agentfootprint.composition.exit', {
          kind: 'Parallel',
          id: compositionId,
          name: compositionName,
          status: 'err',
          durationMs: Date.now() - this.currentRunContext.runStartMs,
        });
        throw err;
      }
      const succeededCount = Object.keys(results).length;
      typedEmit(scope, 'agentfootprint.composition.merge_end', {
        parentId: compositionId,
        // Emit the merge.kind verbatim so consumers can distinguish
        // tolerant (`outcomes-fn`) from strict (`fn` / `llm`).
        strategy: merge.kind,
        resultSummary: truncate(merged, 80),
        // Number of branches that actually contributed a result to the
        // merge. Equals `totalBranchCount` on full success; smaller in
        // tolerant-mode runs where some branches failed.
        mergedBranchCount: succeededCount,
        totalBranchCount: branches.length,
      });
      typedEmit(scope, 'agentfootprint.composition.exit', {
        kind: 'Parallel',
        id: compositionId,
        name: compositionName,
        status: 'ok',
        durationMs: Date.now() - this.currentRunContext.runStartMs,
      });
      return merged;
    };

    builder = builder.addFunction('Merge', mergeStage, 'merge', 'Parallel merge');

    return builder.build();
  }
}

/** Fluent builder. Requires at least 2 branches + one merge strategy. */
export class ParallelBuilder {
  private readonly opts: ParallelOptions;
  private readonly branches: BranchEntry[] = [];
  private merge: MergeStrategy | undefined;
  private readonly seenIds = new Set<string>();

  constructor(opts: ParallelOptions) {
    this.opts = opts;
  }

  /**
   * Add a branch. All branches run concurrently with the same input.
   *
   * Third arg accepts EITHER a legacy bare `name` string (back-compat
   * with pre-L1c callers) OR a `ParallelBranchOptions` bag containing
   * `name` and/or a per-method `groupTranslator` override. The
   * override applies ONLY to this branch's `member.uiGroup` and does
   * not affect any other branch or the runner's own translator.
   */
  branch(id: string, runner: BranchChild, nameOrOpts?: string | ParallelBranchOptions): this {
    if (this.seenIds.has(id)) {
      throw new Error(`Parallel.branch(): duplicate branch id '${id}'`);
    }
    // Branch errors are correlated back to the originating branch by the
    // first `/`-separated segment of footprintjs's engine-prefixed
    // `traversalContext.stageId` (e.g., `legal/call-llm` → branch
    // `legal`). A branch id containing `/` would silently shadow that
    // mapping and drop the error message into 'unknown error' fallback.
    if (id.includes('/')) {
      throw new Error(
        `Parallel.branch(): id '${id}' must not contain '/' — it collides with footprintjs's subflow-path separator used for per-branch error correlation`,
      );
    }
    this.seenIds.add(id);
    const opts =
      typeof nameOrOpts === 'string'
        ? ({ name: nameOrOpts } satisfies ParallelBranchOptions)
        : nameOrOpts ?? {};
    const entry: BranchEntry = {
      id,
      runner,
      name: opts.name ?? id,
      ...(opts.groupTranslator !== undefined && {
        groupTranslator: opts.groupTranslator,
      }),
    };
    this.branches.push(entry);
    return this;
  }

  /**
   * Merge branch results via a pure function.
   * `fn` receives `{ [branchId]: string }` and returns the merged string.
   */
  mergeWithFn(fn: MergeFn): this {
    if (this.merge !== undefined) {
      throw new Error('Parallel: merge strategy already set');
    }
    this.merge = { kind: 'fn', fn };
    return this;
  }

  /** Merge branch results by feeding them to an LLM for synthesis. */
  mergeWithLLM(opts: MergeWithLLMOptions): this {
    if (this.merge !== undefined) {
      throw new Error('Parallel: merge strategy already set');
    }
    this.merge = { kind: 'llm', opts };
    return this;
  }

  /**
   * Tolerant merge — receives `{ [branchId]: BranchOutcome }` including
   * both successes (`{ ok: true, value }`) and failures (`{ ok: false, error }`).
   * Parallel does NOT throw on partial failure when this merge variant is
   * used; the consumer's `fn` decides how to handle it (fall back, surface
   * a warning, retry at a higher level, etc.).
   *
   * Use the default `mergeWithFn` / `mergeWithLLM` variants when you want
   * a single failing branch to abort the whole Parallel loudly.
   */
  mergeOutcomesWithFn(fn: MergeOutcomesFn): this {
    if (this.merge !== undefined) {
      throw new Error('Parallel: merge strategy already set');
    }
    this.merge = { kind: 'outcomes-fn', fn };
    return this;
  }

  build(): Parallel {
    if (this.merge === undefined) {
      throw new Error(
        'Parallel.build(): no merge strategy — call .mergeWithFn() or .mergeWithLLM() before build()',
      );
    }
    return new Parallel(this.opts, this.branches, this.merge);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function mergeWithLLM(
  scope: TypedScope<ParallelState>,
  opts: MergeWithLLMOptions,
  results: Readonly<Record<string, string>>,
): Promise<string> {
  // XML-escape branch content to avoid prompt-injection via branch output.
  const sections = Object.entries(results)
    .map(([id, content]) => `<${id}>${xmlEscape(content)}</${id}>`)
    .join('\n');
  const userContent = `${opts.prompt}\n\n${sections}`;
  const messages: LLMMessage[] = [{ role: 'user', content: userContent }];

  typedEmit(scope, 'agentfootprint.stream.llm_start', {
    iteration: 1,
    provider: opts.provider.name,
    model: opts.model,
    systemPromptChars: 0,
    messagesCount: 1,
    toolsCount: 0,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
  });
  const startMs = Date.now();
  const response = await opts.provider.complete({
    messages,
    model: opts.model,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    ...(opts.maxTokens !== undefined && { maxTokens: opts.maxTokens }),
  });
  const durationMs = Date.now() - startMs;
  typedEmit(scope, 'agentfootprint.stream.llm_end', {
    iteration: 1,
    content: response.content,
    toolCallCount: response.toolCalls.length,
    usage: response.usage,
    stopReason: response.stopReason,
    durationMs,
  });
  return response.content;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
