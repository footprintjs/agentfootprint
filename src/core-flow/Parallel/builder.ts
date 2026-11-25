import { assertUnreservedSubflowSegment } from '../../lib/conventions.js';
import { Parallel } from '../Parallel.js';
import type {
  ParallelOptions,
  ParallelBranchOptions,
  BranchChild,
  BranchEntry,
  MergeStrategy,
  MergeFn,
  MergeOutcomesFn,
  MergeWithLLMOptions,
} from './types.js';

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
    // The branch id is mounted VERBATIM as the subflow segment (see the
    // `addSubFlowChart(branch.id, …)` call in buildChart), so an `sf-` name
    // lands inside the framework's reserved namespace and is filtered out as
    // plumbing by every downstream reader instead of colliding loudly.
    assertUnreservedSubflowSegment('Parallel.branch()', 'branch id', id);
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
      ...(opts.required !== undefined && { required: opts.required }),
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
