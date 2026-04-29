/**
 * MapReduce — fan-out N LLMCalls over deterministic input shards, reduce.
 *
 * Origin: classic map-reduce (Dean & Ghemawat, 2004) applied to
 *         LLM context-window constraints. Seen in long-document
 *         summarization: split → summarize each → combine.
 *
 * Pattern: Factory → produces a Runner composing `Parallel` of N
 *          shard-aware branches. Each branch is an LLMCall wrapped so it
 *          extracts its shard index from the input by position.
 * Role:    patterns/ layer. Pure composition over existing primitives.
 *
 * Shard count is fixed at build time — consumer supplies `shardCount`
 * and a `split(input, shardCount)` function that MUST return exactly
 * `shardCount` strings. The extracted strings are packed into one
 * `message` at run time (delimiter `\u001F`) so each branch can pick
 * its own index. For run-time-variable shard counts, factor MapReduce
 * inside a wrapping Runner that rebuilds the Parallel per call.
 */

import type { LLMProvider } from '../adapters/types.js';
import { flowChart, FlowChartExecutor, type FlowChart, type TypedScope } from 'footprintjs';
import { LLMCall } from '../core/LLMCall.js';
import { RunnerBase } from '../core/RunnerBase.js';
import type { Runner } from '../core/runner.js';
import type { MergeFn, MergeWithLLMOptions } from '../core-flow/Parallel.js';
import { Parallel } from '../core-flow/Parallel.js';
import { Sequence } from '../core-flow/Sequence.js';

const SHARD_DELIMITER = '\u001F'; // ASCII Unit Separator — unlikely in real text.

export interface MapReduceOptions {
  readonly provider: LLMProvider;
  readonly model: string;
  /** System prompt applied to every shard's LLMCall. */
  readonly mapPrompt: string;
  /**
   * Number of shards to fan out. Must be >= 2 (for one-shard, use
   * `LLMCall` directly). Fixed at build time.
   */
  readonly shardCount: number;
  /**
   * Splitter invoked at run time with `(input, shardCount)`. MUST return
   * exactly `shardCount` strings. If it returns fewer, remaining shards
   * receive empty strings; more are truncated.
   */
  readonly split: (input: string, shardCount: number) => readonly string[];
  /**
   * Reducer — either a pure fn combining the N shard outputs, OR an LLM
   * synthesizer.
   */
  readonly reduce:
    | { readonly kind: 'fn'; readonly fn: MergeFn }
    | { readonly kind: 'llm'; readonly opts: MergeWithLLMOptions };
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly name?: string;
  readonly id?: string;
}

/**
 * Build a MapReduce Runner. At run time:
 *   1. The splitter runs the consumer's `split(input, shardCount)` and
 *      packs the resulting N shards into a delimited string.
 *   2. Parallel fans out to N branches. Each branch's wrapper extracts
 *      its own shard from the packed input and feeds it to the shared
 *      LLMCall.
 *   3. The reducer combines the N branch outputs into the final string.
 */
export function mapReduce(opts: MapReduceOptions): Runner<{ message: string }, string> {
  if (opts.shardCount < 2) {
    throw new Error('MapReduce: shardCount must be >= 2 (use LLMCall for 1 shard)');
  }
  const shardCount = opts.shardCount;

  // Step 1: split stage — takes the original input, runs split(), packs
  // the shards into a delimited string. Exposed as a Runner so it can
  // be the first step of a Sequence.
  const splitRunner = new ShardSplitRunner(opts.split, shardCount);

  // Step 2: per-branch wrappers + Parallel. Each branch's wrapper reads
  // the packed message, splits on the delimiter, picks index i, and
  // runs the shared LLMCall with just that shard.
  let par = Parallel.create({
    id: opts.id ? `${opts.id}-map` : 'mapreduce-map',
    name: `${opts.name ?? 'MapReduce'}-Map`,
  });
  for (let i = 0; i < shardCount; i++) {
    const branchRunner = new ShardBranchRunner(
      i,
      LLMCall.create({
        provider: opts.provider,
        model: opts.model,
        ...(opts.temperature !== undefined && { temperature: opts.temperature }),
        ...(opts.maxTokens !== undefined && { maxTokens: opts.maxTokens }),
      })
        .system(opts.mapPrompt)
        .build(),
    );
    par = par.branch(`shard-${i}`, branchRunner);
  }
  const mapRunner =
    opts.reduce.kind === 'fn'
      ? par.mergeWithFn(opts.reduce.fn).build()
      : par.mergeWithLLM(opts.reduce.opts).build();

  // Step 3: full pipeline — Sequence(split → Parallel+reduce).
  return Sequence.create({
    id: opts.id ?? 'mapreduce',
    name: opts.name ?? 'MapReduce',
  })
    .step('split', splitRunner)
    .step('map-reduce', mapRunner)
    .build();
}

/**
 * Runner that runs the consumer's `split()` and returns a packed string.
 * Implemented as a thin Runner (rather than inline Sequence step) so it
 * plugs into the existing Sequence.step API.
 */
class ShardSplitRunner extends RunnerBase<{ message: string }, string> {
  readonly name = 'ShardSplit';
  readonly id = 'shard-split';
  private readonly splitFn: (input: string, shardCount: number) => readonly string[];
  private readonly shardCount: number;

  constructor(
    splitFn: (input: string, shardCount: number) => readonly string[],
    shardCount: number,
  ) {
    super();
    this.splitFn = splitFn;
    this.shardCount = shardCount;
  }

  toFlowChart(): FlowChart {
    const splitFn = this.splitFn;
    const shardCount = this.shardCount;
    return flowChart<{ packed: string }>(
      'Split',
      (scope: TypedScope<{ packed: string }>) => {
        const args = scope.$getArgs<{ message: string }>();
        const shards = splitFn(args.message, shardCount);
        const normalized: string[] = [];
        for (let i = 0; i < shardCount; i++) normalized.push(shards[i] ?? '');
        scope.packed = normalized.join(SHARD_DELIMITER);
      },
      'split',
    )
      .addFunction('Return', (scope: TypedScope<{ packed: string }>) => scope.packed, 'return')
      .build();
  }

  async run(input: { message: string }): Promise<string> {
    const executor = new FlowChartExecutor(this.toFlowChart());
    const result = await executor.run({ input: { message: input.message } });
    if (typeof result === 'string') return result;
    throw new Error('ShardSplit: unexpected result shape');
  }

  async resume(): Promise<string> {
    throw new Error('ShardSplit does not support pause/resume');
  }
}

/**
 * Runner that extracts shard `i` from the packed message and runs the
 * wrapped LLMCall with just that shard.
 */
class ShardBranchRunner extends RunnerBase<{ message: string }, string> {
  readonly name: string;
  readonly id: string;
  private readonly shardIndex: number;
  private readonly inner: Runner<{ message: string }, string>;

  constructor(shardIndex: number, inner: Runner<{ message: string }, string>) {
    super();
    this.shardIndex = shardIndex;
    this.inner = inner;
    this.id = `shard-branch-${shardIndex}`;
    this.name = `Shard ${shardIndex}`;
  }

  toFlowChart(): FlowChart {
    // Build a wrapper chart that unpacks the shard and invokes the
    // inner chart. The inner LLMCall's chart runs as a subflow whose
    // input is the extracted shard.
    const shardIndex = this.shardIndex;
    const innerChart = this.inner.toFlowChart();

    interface WrapperState {
      shard: string;
      result: string;
    }

    return flowChart<WrapperState>(
      'Unpack',
      (scope: TypedScope<WrapperState>) => {
        const args = scope.$getArgs<{ message: string }>();
        const parts = (args.message ?? '').split(SHARD_DELIMITER);
        scope.shard = parts[shardIndex] ?? '';
        scope.result = '';
      },
      'unpack',
    )
      .addSubFlowChartNext('inner', innerChart, 'InnerCall', {
        inputMapper: (parent) => ({ message: parent.shard ?? '' }),
        outputMapper: (sfOutput) => ({
          result: typeof sfOutput === 'string' ? sfOutput : '',
        }),
      })
      .addFunction('Return', (scope: TypedScope<WrapperState>) => scope.result, 'return')
      .build();
  }

  async run(input: { message: string }): Promise<string> {
    const executor = new FlowChartExecutor(this.toFlowChart());
    const result = await executor.run({ input: { message: input.message } });
    if (typeof result === 'string') return result;
    throw new Error('ShardBranch: unexpected result shape');
  }

  async resume(): Promise<string> {
    throw new Error('ShardBranch does not support pause/resume');
  }
}
