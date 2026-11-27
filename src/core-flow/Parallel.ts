/**
 * Parallel — fan-out composition: N branches run concurrently, then merge.
 *
 * Builder over native fork children.
 * Role:    core-flow/ layer. All branches receive the same input
 *          `{ message }`. Each returns a string. A merge step combines
 *          them: either a pure function OR an LLM.
 * Emits:   agentfootprint.composition.enter / exit +
 *          composition.fork_start / branch_complete / merge_end
 *          (via compositionRecorder).
 */

import {
  isFlowEvent,
  type CombinedRecorder,
  type FlowChart,
  type FlowchartCheckpoint,
  type RedactionPolicy,
} from 'footprintjs';
import type { RunOptions } from '../core/runner.js';
import type { GroupMember, GroupMetadata, GroupTranslator } from '../core/translator.js';
import type { RunnerPauseOutcome } from '../core/pause.js';
import { RunnerBase } from '../core/RunnerBase.js';
import type { RunnerInvocation } from '../core/runnerExecution.js';
import { normalizeRunInput } from '../core/runInput.js';
import { readsParentRun } from '../core/memberRun.js';
import { requestOf } from '../core/requestOfRun.js';
import { buildEventMeta } from '../bridge/eventMeta.js';
import { resilienceRecorder } from '../recorders/core/ResilienceRecorder.js';
import { readsMessageFromIfAny } from '../core/messageFrom.js';
import { adoptMemberRedaction } from '../redaction/declared.js';
import { ParallelBuilder } from './Parallel/builder.js';
import { buildParallelChart } from './Parallel/chart.js';
import type {
  ParallelOptions,
  ParallelInput,
  ParallelOutput,
  BranchEntry,
  MergeStrategy,
  ParallelRunValues,
  BranchErrorRecord,
} from './Parallel/types.js';
export type {
  ParallelOptions,
  ParallelInput,
  ParallelOutput,
  MergeFn,
  BranchOutcome,
  MergeOutcomesFn,
  MergeWithLLMOptions,
  ParallelBranchOptions,
  BranchErrorRecord,
} from './Parallel/types.js';
export { ParallelBuilder } from './Parallel/builder.js';
export { wrapBranchOutputMapper } from './Parallel/mapper.js';

export class Parallel extends RunnerBase<ParallelInput, ParallelOutput, ParallelRunValues> {
  readonly name: string;
  readonly id: string;
  private readonly branches: readonly BranchEntry[];
  private readonly merge: MergeStrategy;
  private readonly opts: ParallelOptions;

  /** Ids of branches declared `{ required: true }`. See `ParallelBranchOptions.required`. */
  private readonly requiredIds: ReadonlySet<string>;

  /**
   * True when EVERY branch is required — the fork node carries
   * footprintjs's `failFast` flag, so the first branch failure rejects
   * `executor.run()` with the RAW branch error before the Merge stage
   * can attribute it. `run()`/`resume()` re-attribute via
   * `rethrowWithBranchAttribution()`.
   */
  private readonly failFastEngaged: boolean;

  constructor(opts: ParallelOptions, branches: readonly BranchEntry[], merge: MergeStrategy) {
    super();
    this.opts = opts;
    this.name = opts.name ?? 'Parallel';
    this.id = opts.id ?? 'parallel';
    if (branches.length < 2) {
      throw new Error('Parallel: must have at least 2 branches (use Sequence for a single runner)');
    }
    this.branches = branches;
    // Holding a branch that reads `messageFrom`, it reads it too (`core/messageFrom.ts`).
    readsMessageFromIfAny(
      this,
      branches.map((b) => b.runner),
    );
    // A branch's redaction policy covers this composition's run — every branch
    // runs on its executor (`src/redaction/declared.ts`).
    adoptMemberRedaction(
      this,
      branches.map((b) => b.runner),
    );
    this.merge = merge;
    // Set BEFORE initChart — buildChart reads both fields.
    this.requiredIds = new Set(branches.filter((b) => b.required === true).map((b) => b.id));
    this.failFastEngaged = branches.every((b) => b.required === true);
    // Eager chart construction — see `RunnerBase.initChart` JSDoc.
    // It hands the run it serves to its members (`core/memberRun.ts`).
    readsParentRun(this);
    this.initChart(() => this.buildChart(), {
      runnerId: this.id,
      compositionPath: [`Parallel:${this.id}`],
      initialize: () => ({ branchErrors: new Map<string, BranchErrorRecord>() }),
    });
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
    input: ParallelInput | string,
    options?: RunOptions,
  ): Promise<ParallelOutput | RunnerPauseOutcome> {
    return this.runExecution().withRun(async (invocation) => {
      const request = requestOf(options, 'Parallel.run');
      const runInput = normalizeRunInput<ParallelInput>(input, 'Parallel.run');
      this.prepareCompositionRun(invocation, runInput.identity, request, 'Parallel.run');
      const prepared = this.createRunSetup(invocation);
      let result: unknown;
      try {
        result = await invocation.execute(
          { kind: 'run', options: { ...options, input: { message: runInput.message } } },
          prepared.setup,
          prepared.binding,
        );
      } catch (error) {
        this.rethrowWithBranchAttribution(error, invocation);
      }
      return this.finalizeResult(invocation, result);
    });
  }

  async resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<ParallelOutput | RunnerPauseOutcome> {
    this.noteResumeTakenUp(checkpoint);
    return this.runExecution().withRun(async (invocation) => {
      const request = requestOf(options, 'Parallel.resume');
      this.prepareCompositionResume(invocation, checkpoint, request, 'Parallel.resume');
      const resumeLeg = this.emitPauseResume(checkpoint, input);
      const prepared = this.createRunSetup(invocation, resumeLeg);
      let result: unknown;
      try {
        result = await invocation.execute(
          { kind: 'resume', mode: 'fresh', checkpoint, input, options },
          prepared.setup,
          prepared.binding,
        );
      } catch (error) {
        this.rethrowWithBranchAttribution(error, invocation);
      }
      return this.finalizeResult(invocation, result);
    });
  }

  /**
   * Re-attribute a fail-fast abort to its originating branch.
   *
   * When `failFastEngaged` (every branch required), a failing branch
   * rejects `executor.run()` with the RAW branch error — the Merge stage,
   * which normally attributes failures by branch id, never runs. The
   * internal `parallel-branch-errors` recorder DID see the failure
   * (FlowRecorder.onError fires before the fork rejects), so correlate
   * the rejection against that map and wrap it in a branch-naming error.
   * Also emit the `composition.exit` (status `'err'`) the aborted Merge
   * stage could not, preserving enter/exit pairing for dashboards.
   *
   * Correlation is by error IDENTITY first (`record.raw === err` — the
   * recorder stores the ORIGINAL error object from
   * `FlowErrorEvent.structuredError.raw`), with bare-message equality as
   * a fallback for throws whose identity doesn't survive an engine
   * boundary (e.g. non-Error values). Identity matching is what makes
   * attribution work for ANY named Error subclass — `TypeError`, provider
   * SDK errors like `RateLimitError`, etc. — where message-only matching
   * would silently fail against name-prefixed strings.
   *
   * Rejections that don't correlate (engine errors, merge-stage errors,
   * non-fail-fast runs) are rethrown untouched.
   *
   * Only engaged on the `run()` / `resume()` path — a Parallel chart
   * MOUNTED into an outer composition rejects raw (see
   * `ParallelBranchOptions.required` JSDoc, "Nested-mounting limitation").
   */
  private rethrowWithBranchAttribution(
    err: unknown,
    invocation: RunnerInvocation<ParallelRunValues>,
  ): never {
    if (this.failFastEngaged) {
      const match = this.correlateBranchError(err, invocation.value.branchErrors);
      if (match !== undefined) {
        const [branchId, recorded] = match;
        this.emitFailFastAbortExit(invocation);
        throw new Error(
          `Parallel '${this.id}': required branch '${branchId}' failed: ${recorded.message}`,
          {
            cause: err,
          },
        );
      }
    }
    throw err;
  }

  /**
   * Find the branch whose recorded first error corresponds to `err`:
   * identity match on the original thrown value first, bare-message
   * equality second. Returns `undefined` when nothing correlates.
   */
  private correlateBranchError(
    err: unknown,
    branchErrors: ReadonlyMap<string, BranchErrorRecord>,
  ): readonly [string, BranchErrorRecord] | undefined {
    for (const entry of branchErrors) {
      if (entry[1].raw === err) return entry;
    }
    const message = err instanceof Error ? err.message : String(err);
    for (const entry of branchErrors) {
      if (entry[1].message === message) return entry;
    }
    return undefined;
  }

  /**
   * Synthetic `composition.exit` for fail-fast aborts (no stage scope to
   * emit from). Meta is built from the SAME run context the paired
   * `composition.enter` used (the captured invocation's native context), so
   * the pair shares one real `runId` — Convention 4 run-scoping. Only the
   * `runtimeStageId` degrades (`'unknown#0'`): the abort happens outside
   * any stage, so there is no stage origin to attach.
   */
  private emitFailFastAbortExit(invocation: RunnerInvocation<ParallelRunValues>): void {
    this.dispatcher.dispatch({
      type: 'agentfootprint.composition.exit',
      payload: {
        kind: 'Parallel',
        id: this.id,
        name: this.name,
        status: 'err',
        durationMs: Date.now() - invocation.context().runStartMs,
      },
      meta: buildEventMeta(undefined, invocation.context()),
    });
  }

  private createRunSetup(
    invocation: RunnerInvocation<ParallelRunValues>,
    resumeLeg?: RedactionPolicy,
  ) {
    const dispatcher = this.getDispatcher();
    return this.compositionRunSetup(invocation, resumeLeg, [
      resilienceRecorder({ dispatcher, getRunContext: () => invocation.context() }),
      this.makeBranchErrorRecorder(invocation.value.branchErrors),
    ]);
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
   *
   * The captured map belongs to this invocation. A late failure can only
   * update its old map; no later invocation or mounted runtime shares it.
   */
  private makeBranchErrorRecorder(branchErrors: Map<string, BranchErrorRecord>): CombinedRecorder {
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
        if (!branchErrors.has(branchId)) {
          // `structuredError` preserves both the BARE message (no
          // `TypeError:` / `RateLimitError:` name prefix — consumers
          // expect the original `throw new X(msg)` reason exactly) and
          // the ORIGINAL error object (`raw`) used for identity-based
          // fail-fast re-attribution. Fall back to the flat
          // `event.message` (stripping the standard `Error: ` prefix)
          // only if a future footprintjs shape omits `structuredError`.
          const structured = event.structuredError;
          const message =
            structured?.message ??
            (event.message.startsWith('Error: ')
              ? event.message.slice('Error: '.length)
              : event.message);
          branchErrors.set(branchId, { message, raw: structured?.raw });
        }
      },
    };
  }

  private finalizeResult(
    invocation: RunnerInvocation<ParallelRunValues>,
    result: unknown,
  ): ParallelOutput | RunnerPauseOutcome {
    const paused = this.detectPause(invocation, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    if (typeof result === 'string') return result;
    throw new Error('Parallel: unexpected result shape — expected string');
  }

  private buildChart(): FlowChart {
    return buildParallelChart({
      branches: this.branches,
      merge: this.merge,
      id: this.id,
      name: this.name,
      structureRecorders: this.opts.structureRecorders,
      requiredIds: this.requiredIds,
      failFastEngaged: this.failFastEngaged,
      enterComposition: (scope, args) => this.enterComposition(scope, args, 'Parallel'),
      errorsFor: (scope) => this.runExecution().forScope(scope).value.branchErrors,
      runStartFor: (scope) => this.runExecution().forScope(scope).context.runStartMs,
    });
  }
}
