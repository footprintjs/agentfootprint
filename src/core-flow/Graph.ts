/**
 * graph() — a FIXED DAG of runners, levelized at build time.
 *
 * WHY this exists: `Sequence` and `workflow()` run steps in a line, and
 * `Parallel` fans out ONCE and merges. Real pipelines are neither: an
 * intake step feeds two independent lookups, and a writer waits for both.
 * Expressing that with the existing compositions means nesting a Parallel
 * inside a Sequence and threading values through by hand — and on this
 * codebase that hand-off silently loses structured data (see "The trap"
 * below). `graph()` states the shape once, as nodes and edges, and lets
 * the engine work out what can run at the same time.
 *
 * What it gives you:
 *   - **Concurrency you did not have to schedule.** Kahn levelization at
 *     BUILD time groups nodes with no dependency between them; every node
 *     in a level runs at the same time.
 *   - **A shape checked before it runs.** A cycle, an edge pointing at a
 *     node that does not exist, or a duplicate id is refused at BUILD
 *     time, naming the offender. You cannot construct a broken graph.
 *   - **No silent merges.** A node with two or more parents MUST declare
 *     a `join` — a silent merge is a wrong merge, so the build refuses
 *     and names the node.
 *   - **Values, not text.** An edge's payload is the producer's OUTPUT
 *     handed to the consumer, unchanged. There is no shared mutable scope
 *     between nodes: a node reads exactly what its parents produced.
 *
 * Pattern: Adapter over footprintjs's subflow mounts — a level with
 *          several nodes becomes stacked `addSubFlowChart` calls (a fork,
 *          run concurrently); a level with one node is mounted
 *          sequentially (`addSubFlowChartNext`, which resumes cleanly
 *          across a pause). One join stage between levels.
 * Role:    core-flow/ layer, alongside Sequence/Parallel/Conditional/
 *          Loop/Workflow. Pure control flow — no LLM dependency.
 * Emits:   agentfootprint.composition.enter / exit, reported as kind
 *          `'Sequence'`. See "Why kind 'Sequence'" below.
 *
 * ## The trap this was built around (verified against footprintjs, not docs)
 *
 * The obvious sketch — `graph = Sequence(Parallel(level0), Parallel(level1), …)`
 * — does NOT work on this codebase, for two independent reasons:
 *
 *   1. `Sequence`'s step contract is `{ message: string } -> string`, and
 *      its step `outputMapper` coerces a non-string step output to `''`.
 *      `workflow()` (v7.10.0) exists precisely because of this.
 *   2. `Parallel` has the SAME limit one layer down: its branch type is
 *      `Runner<{ message: string }, string>` and its branch `outputMapper`
 *      coerces a non-string branch output to `''` (`Parallel.ts`, the
 *      `typeof sfOutput === 'string' ? sfOutput : ''` mapper). So a
 *      Parallel level cannot carry a structured value either.
 *
 * So `graph()` is built on the pass-through model `workflow()` established
 * — its own composition, its own mappers, the same recorder wiring and the
 * same `composition.enter` / `exit` events — rather than on top of
 * Sequence/Parallel.
 *
 * ## Why kind 'Sequence'
 *
 * `CompositionKind` is a CLOSED public union (`'Sequence' | 'Parallel' |
 * 'Conditional' | 'Loop'`). Widening it would break exhaustive switches in
 * consumer code for no behavioural gain — the same call v7.10.0 made for
 * `workflow()`. A graph's LEVELS are a sequence (level 0, then level 1, …),
 * so `'Sequence'` is the honest member of that union: this composition runs
 * its levels in order. The fan-out WITHIN a level is visible in the chart
 * itself (a fork node per level), which is where a renderer reads it from.
 *
 * ## Honest limits (all verified against the engine, pinned in tests)
 *
 *   1. Only PLAIN DATA crosses a node boundary — the same limit
 *      `workflow()` documents. A value with a prototype (Date, Map, class
 *      instance) arrives as `{}`; `undefined` fields are dropped.
 *   2. A node must RETURN its output: the value handed to its children is
 *      the node chart's traversal result.
 *   3. A node that THROWS is always reported as
 *      `graph '<id>': node '<node>' failed: <reason>`, but it reaches that
 *      sentence by two different routes. In a CONCURRENT level footprintjs
 *      runs children under `Promise.allSettled`, so a failed child is
 *      simply ABSENT from the results and the level join turns that
 *      absence into the error. In a SEQUENTIAL (single-node) level the
 *      error rejects the run raw, and `rethrowWithNodeAttribution` renames
 *      it. Consumers see one shape either way.
 *   4. A node that PAUSES surfaces as a pause — the engine halts the
 *      traversal before the level's join runs, so `run()` returns a
 *      `RunnerPauseOutcome`. `resume()` then carries on through the REST
 *      of the graph only when the paused node was ALONE in its level (a
 *      sequential mount). Resuming into a fork child completes that child
 *      and stops: the remaining levels do not run. Give a node that asks a
 *      human a level of its own. Both halves are pinned in tests.
 *
 * @example  a diamond: A feeds B and C, D waits for both
 * ```ts
 * const pipeline = graph({
 *   nodes: [
 *     { id: 'intake', runner: intake },
 *     { id: 'orders', runner: lookupOrders },
 *     { id: 'billing', runner: lookupBilling },
 *     {
 *       id: 'reply',
 *       runner: writeReply,
 *       // Two parents ⇒ a join is REQUIRED. `upstream` is keyed by node id.
 *       join: (upstream) => ({
 *         orders: upstream.orders as OrderInfo,
 *         billing: upstream.billing as BillingInfo,
 *       }),
 *     },
 *   ],
 *   edges: [
 *     { from: 'intake', to: 'orders' },
 *     { from: 'intake', to: 'billing' },
 *     { from: 'orders', to: 'reply' },
 *     { from: 'billing', to: 'reply' },
 *   ],
 * });
 *
 * const out = await pipeline.run({ message: 'where is my refund?' });
 * // out = { intake: …, orders: …, billing: …, reply: … } — keyed by node id
 * ```
 */

import { assertUnreservedSubflowSegment } from '../conventions.js';
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
import type { RunContext } from '../bridge/eventMeta.js';
import type { RunnerPauseOutcome } from '../core/pause.js';
import type { Runner } from '../core/runner.js';
import { RunnerBase, makeRunId } from '../core/RunnerBase.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { compositionRecorder } from '../recorders/core/CompositionRecorder.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { typedEmit } from '../recorders/core/typedEmit.js';

// ─── Public shapes ───────────────────────────────────────────────────

/**
 * One node of the graph: an id, the runner that does the work, and — when
 * the node has more than one parent — how to merge what those parents
 * produced into this node's input.
 */
export interface GraphNode<I = unknown, O = unknown> {
  /** Unique within the graph. Used as the results key and the chart node id. */
  readonly id: string;
  /** The work. Any Runner: LLMCall, Agent, a Sequence, another graph. */
  readonly runner: Runner<I, O>;
  /**
   * Merge upstream outputs into this node's input. `upstream` is keyed by
   * PARENT NODE ID, and each value is that parent's output, unchanged.
   *
   * Optional for a node with 0 or 1 parents (a single parent's output is
   * passed through). **REQUIRED when a node has 2+ parents** — a silent
   * merge is a wrong merge, so the build refuses and names the node.
   */
  readonly join?: (upstream: Readonly<Record<string, unknown>>) => I;
  /** Human-friendly label for events + topology. Default: the node id. */
  readonly name?: string;
}

/** A directed dependency: `from` must finish before `to` starts. */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

export interface GraphOptions {
  /** The nodes. Ids must be unique; at least one is required. */
  // `any` erases each node's own I/O types at the collection level so
  // nodes with DIFFERENT input/output types can sit in one array. The
  // per-node type link (join returns what the runner accepts) is enforced
  // where a `GraphNode<I, O>` is authored, which is where it helps.
  readonly nodes: readonly GraphNode<any, any>[];
  /** The dependencies. Every endpoint must name a declared node. */
  readonly edges: readonly GraphEdge[];
  /** Human-friendly name for events + topology. Default `'Graph'`. */
  readonly name?: string;
  /** Stable id used for topology + events. Default `'graph'`. */
  readonly id?: string;
  /**
   * Optional build-time recorders passed through to footprintjs's
   * `flowChart()` factory — they observe this graph's OWN nodes (Seed +
   * one mount per graph node + one join per level + Finalize). Not
   * propagated into the mounted node charts; attach them to each node
   * runner for full coverage.
   */
  readonly structureRecorders?: readonly StructureRecorder[];
}

/** The graph's own input — handed to every ROOT node (one with no parents). */
export type GraphInput = Record<string, unknown>;

/** Outputs keyed by node id. Every node that ran contributes one entry. */
export type GraphOutput = Record<string, unknown>;

interface GraphState {
  [k: string]: unknown;
}

/**
 * A node's first failure. `raw` is the ORIGINAL thrown value, used to
 * correlate a raw rejection back to its node by identity; `message` is the
 * bare reason (no `TypeError:` prefix) printed in the attributed error.
 */
interface NodeErrorRecord {
  readonly message: string;
  readonly raw: unknown;
}

/**
 * The one sentence every node failure is reported with, whatever mount the
 * level used. A graph has two mount paths — a fork for concurrent levels, a
 * sequential mount for single-node ones — and footprintjs surfaces failures
 * differently through each (a fork child's error is swallowed into absence;
 * a sequential child's rejects the run raw). Consumers should not have to
 * know which one they got, so both are reported like this.
 */
function nodeFailureMessage(graphId: string, nodeId: string, reason: string): string {
  return `graph '${graphId}': node '${nodeId}' failed: ${reason}`;
}

// ─── Build-time validation + levelization ────────────────────────────

/**
 * Kahn levelization: group nodes so that everything in level N depends
 * only on levels < N. Nodes within a level are independent BY
 * CONSTRUCTION, which is exactly the licence to run them concurrently.
 *
 * Declaration order is preserved inside each level so a graph's chart —
 * and therefore its trace — is deterministic.
 *
 * Throws (naming the offender) on: an unknown edge endpoint, a duplicate
 * node id, a cycle, or a fan-in > 1 with no `join`.
 */
export function levelize(
  nodes: readonly GraphNode<any, any>[],
  edges: readonly GraphEdge[],
): readonly (readonly GraphNode<any, any>[])[] {
  if (nodes.length === 0) {
    throw new Error('graph: needs at least one node');
  }

  const byId = new Map<string, GraphNode<any, any>>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      throw new Error(
        `graph: duplicate node id '${node.id}' — every node id must be unique (it is the results key).`,
      );
    }
    // Node ids are mounted verbatim as subflow segments; an 'sf-' name would be
    // filtered as framework plumbing by every downstream reader.
    assertUnreservedSubflowSegment('graph()', 'node id', node.id);
    byId.set(node.id, node);
  }

  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    parents.set(node.id, []);
    children.set(node.id, []);
  }

  for (const edge of edges) {
    if (!byId.has(edge.from)) {
      throw new Error(
        `graph: edge '${edge.from}' -> '${edge.to}' references unknown node '${edge.from}'.`,
      );
    }
    if (!byId.has(edge.to)) {
      throw new Error(
        `graph: edge '${edge.from}' -> '${edge.to}' references unknown node '${edge.to}'.`,
      );
    }
    parents.get(edge.to)?.push(edge.from);
    children.get(edge.from)?.push(edge.to);
  }

  // Fan-in > 1 demands an explicit join. Checked BEFORE the cycle walk so
  // the more actionable error wins on a graph that has both problems.
  for (const node of nodes) {
    const up = parents.get(node.id) ?? [];
    if (up.length > 1 && node.join === undefined) {
      throw new Error(
        `graph: node '${node.id}' has ${up.length} parents (${up.join(', ')}) but no join — ` +
          'a silent merge is a wrong merge. Give the node a join(upstream) that returns its input; ' +
          'upstream is keyed by parent node id.',
      );
    }
  }

  // Kahn: repeatedly take every node whose parents have all been placed.
  const remainingParents = new Map<string, number>();
  for (const node of nodes) remainingParents.set(node.id, (parents.get(node.id) ?? []).length);

  const levels: GraphNode<any, any>[][] = [];
  let frontier = nodes.filter((n) => remainingParents.get(n.id) === 0);
  let placed = 0;

  while (frontier.length > 0) {
    levels.push(frontier);
    placed += frontier.length;
    const next: GraphNode<any, any>[] = [];
    for (const node of frontier) {
      for (const childId of children.get(node.id) ?? []) {
        const left = (remainingParents.get(childId) ?? 0) - 1;
        remainingParents.set(childId, left);
        if (left === 0) {
          const child = byId.get(childId);
          if (child !== undefined) next.push(child);
        }
      }
    }
    // Restore declaration order — `next` is built in parent-visit order.
    frontier = nodes.filter((n) => next.includes(n));
  }

  if (placed < nodes.length) {
    const stuck = new Set(
      nodes.filter((n) => (remainingParents.get(n.id) ?? 0) > 0).map((n) => n.id),
    );
    throw new Error(
      `graph: cycle detected — edge '${findBackEdge(
        stuck,
        edges,
      )}' closes a loop. A graph must be acyclic.`,
    );
  }

  return levels;
}

/**
 * Name ONE edge that closes a cycle, so the error can point at something
 * the author can delete. Depth-first over the nodes Kahn could not place;
 * the first edge back onto the current stack is the one reported.
 */
function findBackEdge(stuck: ReadonlySet<string>, edges: readonly GraphEdge[]): string {
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    if (stuck.has(edge.from) && stuck.has(edge.to)) {
      const list = out.get(edge.from) ?? [];
      list.push(edge.to);
      out.set(edge.from, list);
    }
  }

  const onStack = new Set<string>();
  const done = new Set<string>();
  let found: string | undefined;

  const walk = (id: string): void => {
    if (found !== undefined) return;
    onStack.add(id);
    for (const next of out.get(id) ?? []) {
      if (found !== undefined) return;
      if (onStack.has(next)) {
        found = `${id}' -> '${next}`;
        return;
      }
      if (!done.has(next)) walk(next);
    }
    onStack.delete(id);
    done.add(id);
  };

  for (const id of stuck) {
    if (!done.has(id)) walk(id);
    if (found !== undefined) break;
  }
  // Every unplaced node is on a cycle, so a back edge always exists; the
  // fallback keeps the error useful rather than throwing inside a thrower.
  return found ?? [...stuck].join("' -> '");
}

/**
 * Hand a producer's value to a consumer as its input args.
 *
 * `string` → `{ message }` (the house convention every LLM runner here
 * speaks, identical to `workflow()`'s hand-off rule). Plain object →
 * itself. Anything else is a broken hand-off and says so, naming both
 * ends — the alternative is an empty input inside the consumer with
 * nothing pointing back here.
 */
function toNodeArgs(value: unknown, nodeId: string, source: string): Record<string, unknown> {
  if (typeof value === 'string') return { message: value };
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  const got = value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value;
  throw new Error(
    `graph: ${source} handed node '${nodeId}' ${got}, but a node needs an object ` +
      '(or a string, which arrives as { message }). Make each node return its output.',
  );
}

// ─── The composition ─────────────────────────────────────────────────

/**
 * A fixed DAG of runners. Build one with {@link graph}.
 */
export class Graph extends RunnerBase<GraphInput, GraphOutput> {
  readonly name: string;
  readonly id: string;
  private readonly nodes: readonly GraphNode<any, any>[];
  private readonly levels: readonly (readonly GraphNode<any, any>[])[];
  private readonly parentsOf: ReadonlyMap<string, readonly string[]>;
  private readonly opts: GraphOptions;

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  /**
   * Per-node first-error records for the current run. footprintjs's
   * `SubflowExecutor` swallows a subflow error into the parent's debug
   * bag and skips the `outputMapper`, so the message never reaches parent
   * scope on its own. An internal recorder captures it here; the level
   * join reads it to name what actually went wrong. Mirrors Parallel's
   * `branchErrors`, epoch-guarded for the same reason.
   */
  private readonly nodeErrors = new Map<string, NodeErrorRecord>();

  /** Monotonic run token — see Parallel's `runEpoch`. */
  private runEpoch = 0;

  constructor(opts: GraphOptions) {
    super();
    this.opts = opts;
    this.name = opts.name ?? 'Graph';
    this.id = opts.id ?? 'graph';
    this.nodes = opts.nodes;
    // Levelization VALIDATES — a broken graph throws here, at construction.
    this.levels = levelize(opts.nodes, opts.edges);

    const parents = new Map<string, string[]>();
    for (const node of opts.nodes) parents.set(node.id, []);
    for (const edge of opts.edges) parents.get(edge.to)?.push(edge.from);
    this.parentsOf = parents;

    // Eager chart construction — see `RunnerBase.initChart` JSDoc.
    this.initChart(() => this.buildChart());
  }

  /** How the graph was levelized — level 0 first. Stable post-construction. */
  getLevels(): readonly (readonly string[])[] {
    return this.levels.map((level) => level.map((n) => n.id));
  }

  async run(input: GraphInput, options?: RunOptions): Promise<GraphOutput | RunnerPauseOutcome> {
    const executor = this.createExecutor();
    this.lastExecutor = executor;
    let result: unknown;
    try {
      result = await executor.run({ input: { ...input }, ...(options ?? {}) });
    } catch (err) {
      this.rethrowWithNodeAttribution(err);
    }
    return this.finalizeResult(executor, result);
  }

  async resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<GraphOutput | RunnerPauseOutcome> {
    this.emitPauseResume(checkpoint, input);
    const executor = this.createExecutor();
    this.lastExecutor = executor;
    let result: unknown;
    try {
      result = await executor.resume(checkpoint, input, options);
    } catch (err) {
      this.rethrowWithNodeAttribution(err);
    }
    return this.finalizeResult(executor, result);
  }

  /**
   * Give a RAW rejection the same node-naming shape the level join
   * produces.
   *
   * A node in a SEQUENTIAL (single-node) level rejects the run with its
   * own error — the level join never runs, so nothing has attributed it to
   * a node yet. The error recorder did see it, so correlate (by identity
   * first, then bare message) and rename. Anything that does not correlate
   * — including the join's own already-attributed error — is rethrown
   * untouched.
   */
  private rethrowWithNodeAttribution(err: unknown): never {
    const message = err instanceof Error ? err.message : String(err);
    for (const [nodeId, record] of this.nodeErrors) {
      if (record.raw === err || record.message === message) {
        throw new Error(nodeFailureMessage(this.id, nodeId, record.message), { cause: err });
      }
    }
    throw err;
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Graph:${this.id}`],
    };
    this.runEpoch += 1;
    this.nodeErrors.clear();

    const executor = new FlowChartExecutor(this.getSpec());
    const dispatcher = this.getDispatcher();
    const getRunCtx = (): RunContext => this.currentRunContext;

    executor.attachCombinedRecorder(new ContextRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(streamRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(agentRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(compositionRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(this.makeNodeErrorRecorder(this.runEpoch));
    for (const r of this.attachedRecorders) executor.attachCombinedRecorder(r);
    return executor;
  }

  /**
   * Capture the first error per node. The node id is the first segment of
   * the engine-prefixed `stageId` (`orders/call-llm` → node `orders`) —
   * the same correlation Parallel uses, and the only one that survives a
   * node mounting subflows of its own.
   */
  private makeNodeErrorRecorder(epoch: number): CombinedRecorder {
    const nodeIds = new Set(this.nodes.map((n) => n.id));
    return {
      id: 'graph-node-errors',
      onError: (event) => {
        if (epoch !== this.runEpoch) return; // straggler from a dead run
        if (!isFlowEvent(event)) return;
        const stageId = event.traversalContext?.stageId ?? '';
        const slash = stageId.indexOf('/');
        const nodeId = slash >= 0 ? stageId.slice(0, slash) : undefined;
        if (nodeId === undefined || !nodeIds.has(nodeId)) return;
        if (this.nodeErrors.has(nodeId)) return;
        const structured = event.structuredError;
        const message =
          structured?.message ??
          (event.message.startsWith('Error: ')
            ? event.message.slice('Error: '.length)
            : event.message);
        this.nodeErrors.set(nodeId, { message, raw: structured?.raw });
      },
    };
  }

  private finalizeResult(
    executor: FlowChartExecutor,
    result: unknown,
  ): GraphOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    return (result ?? {}) as GraphOutput;
  }

  private buildChart(): FlowChart {
    const compositionId = this.id;
    const compositionName = this.name;
    const nodeCount = this.nodes.length;
    const levels = this.levels;
    const nodeErrors = this.nodeErrors;

    const seed = (scope: TypedScope<GraphState>) => {
      // The graph's own input is what every ROOT node receives.
      scope.graphInput = scope.$getArgs<GraphInput>();
      scope.results = {};
      typedEmit(scope, 'agentfootprint.composition.enter', {
        kind: 'Sequence',
        id: compositionId,
        name: compositionName,
        childCount: nodeCount,
      });
    };

    // Root description prefix `Sequence:` is the taxonomy marker every
    // consumer (Lens, FlowchartRecorder.mapTopologyToSteps) already reads.
    let builder = flowChart<GraphState>('Seed', seed, 'seed', {
      ...(this.opts.structureRecorders !== undefined && {
        structureRecorders: [...this.opts.structureRecorders],
      }),
      description: `Sequence: ${nodeCount}-node DAG in ${levels.length} level(s)`,
    });

    levels.forEach((level, levelIndex) => {
      // A level with SEVERAL nodes is mounted on the SAME builder cursor —
      // stacked `addSubFlowChart` calls produce a fork node, which
      // footprintjs's ChildrenExecutor runs concurrently. That is the whole
      // reason to levelize.
      //
      // A level with ONE node is mounted SEQUENTIALLY instead
      // (`addSubFlowChartNext`). There is nothing to run it alongside, and
      // the sequential mount is strictly better across a pause: resuming
      // into a fork child completes THAT child and stops, whereas a
      // sequential mount resumes and carries on through the rest of the
      // graph. Verified against footprintjs; see the class JSDoc's
      // "Honest limits".
      const concurrent = level.length > 1;
      for (const node of level) {
        const mount = concurrent
          ? builder.addSubFlowChart.bind(builder)
          : builder.addSubFlowChartNext.bind(builder);
        builder = mount(node.id, node.runner.getSpec(), node.name ?? node.id, {
          // A THROW from an inputMapper (a broken hand-off, or a join that
          // rejects what it got) is caught by footprintjs's SubflowExecutor
          // and turned into a plain "this subflow did not run" — the reason
          // never reaches parent scope. Record it first, so the level join
          // can name what actually happened instead of 'unknown error'.
          inputMapper: (parent) => {
            try {
              return this.inputForNode(node, parent as Record<string, unknown>);
            } catch (err) {
              if (!nodeErrors.has(node.id)) {
                nodeErrors.set(node.id, {
                  message: err instanceof Error ? err.message : String(err),
                  raw: err,
                });
              }
              throw err;
            }
          },
          // Untouched: whatever the node's chart returned is what its
          // children (and the caller) receive. No string coercion — this
          // is exactly what Sequence and Parallel cannot do.
          outputMapper: (sfOutput) => ({ results: { [node.id]: sfOutput } }),
        });
      }

      // The join stage does two jobs: it ADVANCES the builder cursor (so
      // the next level forks from here instead of joining this level's
      // fork), and it turns a failed node's ABSENCE into a loud error.
      builder = builder.addFunction(
        `Level ${levelIndex} join`,
        (scope: TypedScope<GraphState>) => {
          // Read through `$getValue`, never `scope.results`: values merged
          // into parent state by a subflow outputMapper are present in
          // shared state but do NOT enumerate through TypedScope's nested
          // property proxy. Verified against footprintjs — the property
          // read returns `{}` while `$getValue` returns the real record.
          const results = (scope.$getValue('results') as Record<string, unknown>) ?? {};
          const missing = level.map((n) => n.id).filter((id) => !(id in results));
          if (missing.length > 0) {
            typedEmit(scope, 'agentfootprint.composition.exit', {
              kind: 'Sequence',
              id: compositionId,
              name: compositionName,
              status: 'err',
              durationMs: Date.now() - this.currentRunContext.runStartMs,
            });
            const reasonFor = (id: string): string =>
              nodeErrors.get(id)?.message ?? 'unknown error';
            const firstMissing = missing[0] ?? '';
            if (missing.length === 1) {
              throw new Error(
                nodeFailureMessage(compositionId, firstMissing, reasonFor(firstMissing)),
              );
            }
            const details = missing.map((id) => `  ${id}: ${reasonFor(id)}`).join('\n');
            throw new Error(
              `graph '${compositionId}': ${missing.length} nodes failed in level ${levelIndex}:\n${details}`,
            );
          }
          return undefined;
        },
        `level-${levelIndex}-join`,
        `Graph level ${levelIndex} join`,
      );
    });

    builder = builder.addFunction(
      'Finalize',
      (scope: TypedScope<GraphState>) => {
        typedEmit(scope, 'agentfootprint.composition.exit', {
          kind: 'Sequence',
          id: compositionId,
          name: compositionName,
          status: 'ok',
          durationMs: Date.now() - this.currentRunContext.runStartMs,
        });
        // `$getValue` for the same reason as the level join.
        return scope.$getValue('results') ?? {};
      },
      'finalize',
      'Graph finalize',
    );

    return builder.build();
  }

  /**
   * What one node receives. Roots get the graph's own input; a single
   * parent is passed through; 2+ parents go through the node's `join`
   * (which the build already guaranteed exists).
   *
   * `parent` here is the RAW parent state the engine hands an
   * `inputMapper` — not a TypedScope — so structured upstream values read
   * back intact.
   */
  private inputForNode(
    node: GraphNode<any, any>,
    parent: Record<string, unknown>,
  ): Record<string, unknown> {
    const results = (parent.results as Record<string, unknown>) ?? {};
    const upstreamIds = this.parentsOf.get(node.id) ?? [];

    if (upstreamIds.length === 0) {
      return { ...((parent.graphInput as Record<string, unknown>) ?? {}) };
    }

    if (node.join !== undefined) {
      const upstream: Record<string, unknown> = {};
      for (const id of upstreamIds) upstream[id] = results[id];
      return toNodeArgs(node.join(upstream), node.id, `join of node '${node.id}'`);
    }

    const only = upstreamIds[0] ?? '';
    return toNodeArgs(results[only], node.id, `node '${only}'`);
  }
}

// ─── The factory ─────────────────────────────────────────────────────

/**
 * Build a fixed DAG of runners. Independent nodes run concurrently; the
 * result is every node's output, keyed by node id.
 *
 * The shape is checked at BUILD time — a cycle, an edge pointing at an
 * unknown node, a duplicate id, or a 2+-parent node with no `join` throws
 * here, naming the offender, rather than misbehaving mid-run.
 *
 * @example  a fan-out with a merge
 * ```ts
 * const pipeline = graph({
 *   nodes: [
 *     { id: 'plan', runner: planner },
 *     { id: 'search', runner: searcher },
 *     { id: 'recall', runner: memory },
 *     { id: 'answer', runner: writer, join: (u) => ({ ...u }) },
 *   ],
 *   edges: [
 *     { from: 'plan', to: 'search' },
 *     { from: 'plan', to: 'recall' },
 *     { from: 'search', to: 'answer' },
 *     { from: 'recall', to: 'answer' },
 *   ],
 * });
 *
 * const out = await pipeline.run({ message: 'what changed last week?' });
 * console.log(out.answer);
 * ```
 */
export function graph(opts: GraphOptions): Graph {
  return new Graph(opts);
}
