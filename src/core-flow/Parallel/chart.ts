import { flowChart, type FlowChart, type StructureRecorder, type TypedScope } from 'footprintjs';
import { parentRunIn, withParentRun } from '../../core/memberRun.js';
import { composedInput } from '../../core/messageFrom.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import { childError, childOutcome } from '../childOutcome.js';
import { wrapBranchOutputMapper } from './mapper.js';
import { mergeWithLLM, truncate } from './merge.js';
import type {
  BranchEntry,
  BranchErrorRecord,
  BranchOutcome,
  MergeStrategy,
  ParallelState,
  ParallelInput,
} from './types.js';

export interface ParallelChartContext {
  readonly branches: readonly BranchEntry[];
  readonly merge: MergeStrategy;
  readonly id: string;
  readonly name: string;
  readonly structureRecorders?: readonly StructureRecorder[];
  readonly requiredIds: ReadonlySet<string>;
  readonly failFastEngaged: boolean;
  readonly enterComposition: (scope: TypedScope<ParallelState>, args: ParallelInput) => void;
  readonly errorsFor: (scope: unknown) => Map<string, BranchErrorRecord>;
  readonly runStartFor: (scope: unknown) => number;
}

export function buildParallelChart(context: ParallelChartContext): FlowChart {
  const branches = context.branches;
  const merge = context.merge;
  const compositionId = context.id;
  const compositionName = context.name;

  const seed = (scope: TypedScope<ParallelState>) => {
    const args = scope.$getArgs<ParallelInput>();
    context.enterComposition(scope, args);
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
  let builder = flowChart<ParallelState>('Initialize', seed, 'seed', {
    ...(context.structureRecorders !== undefined && {
      structureRecorders: [...context.structureRecorders],
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
  //
  // The outputMapper itself is wrapped (`wrapBranchOutputMapper`) so a
  // MAPPER throw is also attributed to its branch — see the helper's
  // JSDoc for why footprintjs can't attribute that class on its own.
  for (const branch of branches) {
    builder = builder.addSubFlowChart(branch.id, branch.runner.getSpec(), branch.name, {
      inputMapper: (parent) => {
        // The caller's own message — composed only when this composition was
        // handed a composed one (`core/messageFrom.ts`).
        const input = { message: (parent.userMessage as string) ?? '' };
        const mapped =
          parent.messageFrom === 'composed' ? composedInput(branch.runner, input) : input;
        // Every branch runs for this run (`core/memberRun.ts`).
        return withParentRun(mapped, parentRunIn(parent), branch.runner);
      },
      // The child reads its own outcome (`childOutcome.ts`). A branch that
      // ended on a verdict is a FAILED branch: its mapper throws the child's
      // own error, which the wrapper attributes.
      outputMapper: wrapBranchOutputMapper(
        branch.id,
        (binding) => context.errorsFor(binding),
        (sfOutput) => {
          const outcome = childOutcome(branch.runner, sfOutput);
          if ('verdict' in outcome) throw childError(outcome.verdict);
          return {
            branchResults: {
              [branch.id]: typeof outcome.answer === 'string' ? outcome.answer : '',
            },
          };
        },
      ),
    });
  }

  // The merge reads this actual runtime's error map, including mounted use.
  const requiredIds = context.requiredIds;
  const mergeStage = async (scope: TypedScope<ParallelState>): Promise<string> => {
    const branchErrors = context.errorsFor(scope);
    const results = (scope.branchResults as Record<string, string>) ?? {};

    // Detect failures by absence: any expected branch id missing
    // from `branchResults` is a branch whose `outputMapper` didn't
    // fire — i.e., one whose subflow errored. The specific error
    // message comes from the recorder-captured `branchErrors` map.
    //
    // footprintjs does NOT fire `FlowRecorder.onError` for errors
    // thrown INSIDE `applyOutputMapping` (those are caught separately
    // in `SubflowExecutor` and routed to
    // `parentContext.addError('outputMapperError', ...)`), so the
    // recorder alone would miss mapper-class failures. The
    // `wrapBranchOutputMapper` wrapper on every branch mount records
    // those into `branchErrors` before rethrowing, so both strict-mode
    // aggregation and tolerant-mode `BranchOutcome.error` print the
    // real message instead of `unknown error`.
    const failedIds = branches.map((b) => b.id).filter((id) => !(id in results));
    const isTolerant = merge.kind === 'outcomes-fn';
    const failedRequired = failedIds.filter((id) => requiredIds.has(id));
    if (failedIds.length > 0 && (!isTolerant || failedRequired.length > 0)) {
      typedEmit(scope, 'agentfootprint.composition.exit', {
        kind: 'Parallel',
        id: compositionId,
        name: compositionName,
        status: 'err',
        durationMs: Date.now() - context.runStartFor(scope),
      });
      // A REQUIRED branch failed under a tolerant merge: required
      // overrides tolerance — reject the run, naming the branch(es).
      // (Strict merges below already reject on ANY failure, required
      // or not, with the pre-existing aggregate message.)
      if (isTolerant) {
        const details = failedRequired
          .map((id) => `  ${id}: ${branchErrors.get(id)?.message ?? 'unknown error'}`)
          .join('\n');
        throw new Error(
          `Parallel '${compositionId}': ${failedRequired.length} required branch(es) failed:\n${details}`,
        );
      }
      const details = failedIds
        .map((id) => `  ${id}: ${branchErrors.get(id)?.message ?? 'unknown error'}`)
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
              error: branchErrors.get(b.id)?.message ?? 'unknown error',
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
        durationMs: Date.now() - context.runStartFor(scope),
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
      durationMs: Date.now() - context.runStartFor(scope),
    });
    return merged;
  };

  builder = builder.addFunction('Merge', mergeStage, 'merge', 'Parallel merge');

  const chart = builder.build();

  // Required-branch fail-fast: when EVERY branch is required, engage
  // footprintjs's fork-level `failFast` (`Promise.all` — first branch
  // error rejects the whole run, aborting before the Merge join).
  //
  // The fan-out node here is the SEED node — stacked `addSubFlowChart`
  // calls fork from the builder cursor, which is the chart root.
  // footprintjs only exposes a `failFast` option on its selector/list
  // builders, so for a plain stacked-subflow fork we stamp the public
  // `StageNode.failFast` field on the built chart's root directly
  // (the exact field `ChildrenExecutor.executeNodeChildren` reads).
  //
  // Deliberately NOT engaged for a MIXED required/optional set:
  // fork-level failFast is all-or-nothing, so an OPTIONAL sibling's
  // throw would also abort the run. Mixed sets are enforced at the
  // Merge join instead (see `mergeStage`).
  if (context.failFastEngaged) {
    chart.root.failFast = true;
  }

  return chart;
}
