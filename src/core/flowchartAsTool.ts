/**
 * flowchartAsTool — wrap a footprintjs `FlowChart` as an Agent `Tool`.
 *
 * The Block A7 piece. footprintjs is the substrate; agentfootprint is
 * the agent layer above it. When a multi-step procedure is already
 * expressed as a footprintjs flowchart (intake validation, refund
 * processing, claim adjudication — anything with branches, loops, or
 * decision evidence), let the LLM call it as ONE tool. The flowchart's
 * step-by-step recorders, narrative, and pause/resume continue to work
 * exactly as they do outside the agent.
 *
 * Why this matters:
 *
 *   1. **Composition over re-write.** A team with a non-trivial
 *      footprintjs flowchart shouldn't have to flatten it into N
 *      separate tools to expose it to an agent. Wrap it once.
 *
 *   2. **Observability stays free.** Every flowchart stage emits typed
 *      events. The Agent's recorders see the wrapping tool call;
 *      footprintjs's recorders see everything inside. Two layers,
 *      one observation tree. The `recorders` option bridges them:
 *      attach agent-layer observers (the causal-evidence bridge,
 *      `otel.decisionEvidenceRecorder()`, your own CombinedRecorder)
 *      to the tool's INTERNAL executor so decide()/select() evidence
 *      inside the flowchart reaches them too.
 *
 *   3. **Pause/resume composes.** A pausable handler inside the
 *      flowchart pauses the inner executor; the outer agent treats
 *      the pause as an unfinished tool call. Resume the agent and the
 *      inner flowchart resumes from its checkpoint. (Today: surfaces
 *      the pause as a thrown error with the checkpoint attached;
 *      polished agent-side pause integration in v2.6.)
 *
 * Pattern: Adapter (GoF) over `FlowChartExecutor.run()`. Translates
 *          `Tool.execute(args, ctx)` into `executor.run({ input: args,
 *          env: { signal: ctx.signal } })` and the result back to a
 *          string via `resultMapper` (or a default JSON stringify).
 *
 * Role:    Layer-6 (Agent) → Layer-1 (footprintjs) bridge. Pure
 *          interop; no new abstraction in either layer.
 *
 * @example  Single-stage flowchart as a tool
 *   import { flowChart } from 'footprintjs';
 *   import { Agent, flowchartAsTool } from 'agentfootprint';
 *
 *   const refundChart = flowChart<{ refundId: string }>(
 *     'RefundFlow',
 *     async (scope) => {
 *       const args = scope.$getArgs<{ orderId: string; reason: string }>();
 *       scope.refundId = await refundService.process(args.orderId);
 *     },
 *     'refund-flow',
 *   ).build();
 *
 *   const refundTool = flowchartAsTool({
 *     name: 'process_refund',
 *     description: 'Process a refund for an order. Returns refundId on success.',
 *     inputSchema: {
 *       type: 'object',
 *       properties: {
 *         orderId: { type: 'string' },
 *         reason: { type: 'string' },
 *       },
 *       required: ['orderId', 'reason'],
 *     },
 *     flowchart: refundChart,
 *     resultMapper: (snapshot) =>
 *       JSON.stringify({ refundId: snapshot.values.refundId, status: 'processed' }),
 *   });
 *
 *   const agent = Agent.create({ provider }).tool(refundTool).build();
 *
 * @example  Multi-stage flowchart with decide() + recorders
 *   const triageChart = flowChart<TriageState>('Triage', validateInput, 'validate')
 *     .addDeciderFunction('Classify', classifyDecider, 'classify')
 *       .addFunctionBranch('high', 'Escalate', escalate)
 *       .addFunctionBranch('low', 'Auto-handle', autoHandle)
 *       .end()
 *     .build();
 *
 *   // decide() evidence inside the chart fires `onDecision` on each
 *   // attached recorder — wire the agent's evidence consumers straight
 *   // into the tool instead of hand-mounting the chart.
 *   const evidence = causalEvidenceRecorder();
 *
 *   const triageTool = flowchartAsTool({
 *     name: 'triage_request',
 *     description: 'Triage an incoming request and return the decision.',
 *     inputSchema: { ... },
 *     flowchart: triageChart,
 *     recorders: [evidence],
 *   });
 */

import { FlowChartExecutor, type CombinedRecorder, type FlowChart } from 'footprintjs';
import { defineTool } from './tools.js';
import type { Tool, ToolExecutionContext } from './tools.js';

/**
 * Pruned snapshot view passed to `resultMapper`. We keep this minimal
 * (the values bag + the chart's narrative entries) to avoid leaking
 * internal scope plumbing. Consumers needing the full snapshot can
 * pass a `passthrough` resultMapper that ignores the prune.
 */
export interface FlowchartToolSnapshot {
  /**
   * Final scope state — the merged result of every stage's writes.
   * This is what `executor.getSnapshot().values` returns.
   */
  readonly values: Readonly<Record<string, unknown>>;
  /**
   * The flowchart's combined narrative entries (flow + data).
   * Useful for resultMappers that want to extract specific commit
   * artifacts or audit a decision path.
   */
  readonly narrative: readonly { readonly type?: string; readonly text?: string }[];
}

/**
 * Optional result mapper. Receives the flowchart's final snapshot
 * (pruned to `FlowchartToolSnapshot`) and returns the string the LLM
 * sees as the tool result.
 *
 * If omitted, the default behavior is `JSON.stringify(snapshot.values)`.
 *
 * Errors thrown from the mapper become the tool result with a
 * `[mapper-error: ...]` prefix so the LLM sees a useful diagnostic.
 */
export type FlowchartResultMapper = (snapshot: FlowchartToolSnapshot) => string;

/**
 * Options for `flowchartAsTool`.
 */
export interface FlowchartAsToolOptions {
  /** Tool name the LLM dispatches by. Must be unique across the agent's tools. */
  readonly name: string;
  /** Tool description shown to the LLM. */
  readonly description: string;
  /**
   * JSON Schema describing the input args the LLM must produce.
   * Becomes `flowchart.run({ input: args })`. Default: `{ type: 'object', properties: {} }`.
   */
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  /**
   * The footprintjs flowchart to mount as the tool's body.
   * The chart's stages receive args via `scope.$getArgs()`.
   */
  readonly flowchart: FlowChart;
  /**
   * Optional shaping function. Default: `JSON.stringify(snapshot.values)`.
   * Errors throw into the tool's `[mapper-error: ...]` envelope.
   */
  readonly resultMapper?: FlowchartResultMapper;
  /**
   * Observers to attach to the tool's INTERNAL `FlowChartExecutor`
   * before each run. This is the hook that lets decide()/select()
   * evidence (and every other footprintjs event) inside a tool-mounted
   * flowchart reach agent-layer evidence consumers — e.g. the causal
   * `causalEvidenceRecorder()` bridge or `otel.decisionEvidenceRecorder()`.
   * Without it, the internal executor is unobservable from outside.
   *
   * Each entry is a footprintjs `CombinedRecorder`, attached via
   * `executor.attachCombinedRecorder` and routed by runtime
   * method-shape detection — so ONE array covers all three observer
   * channels (scope data-flow `onRead`/`onWrite`/`onCommit`/…,
   * control-flow `onDecision`/`onSelected`/`onLoop`/…, and emit
   * `onEmit`). Implement only the hooks you care about.
   *
   * **Per-invocation semantics:** the tool builds a FRESH executor per
   * call (flowchart state never leaks between invocations) and attaches
   * every recorder in this array to EACH invocation's executor before
   * `run()`. The recorder INSTANCES are yours and are shared across
   * invocations — a stateful recorder therefore accumulates events from
   * EVERY invocation of the tool. Each invocation is a distinct run
   * with a fresh `runId`; recorders needing per-invocation bookkeeping
   * detect the boundary via `event.traversalContext.runId !== lastRunId`
   * (Convention 4) rather than assuming one run per recorder lifetime.
   */
  readonly recorders?: ReadonlyArray<CombinedRecorder>;
}

/**
 * Wrap a footprintjs `FlowChart` as a `Tool` the Agent's LLM can call.
 *
 * On execute:
 *   1. Constructs a fresh `FlowChartExecutor(flowchart)` per call (so
 *      consecutive invocations don't share state).
 *   2. Attaches each `opts.recorders` entry via
 *      `executor.attachCombinedRecorder` — the SAME recorder instances
 *      attach to every invocation's fresh executor (see the option's
 *      JSDoc for the shared-state / runId implications).
 *   3. Calls `executor.run({ input: args, env: { signal } })` with the
 *      LLM-supplied args + the agent's abort signal.
 *   4. If the run paused, throws an Error with the checkpoint attached
 *      (`error.checkpoint`) so the agent loop can surface it. Polished
 *      agent-side pause integration is v2.6 work.
 *   5. If the run completed, calls `resultMapper(snapshot)` (or the
 *      default JSON.stringify) and returns the string.
 *   6. If the run threw, the error propagates — the Agent's
 *      tool-call handler converts it to a synthetic error string for
 *      the LLM to see + recover from.
 */
export function flowchartAsTool(opts: FlowchartAsToolOptions): Tool {
  if (!opts.name || opts.name.trim().length === 0) {
    throw new Error('flowchartAsTool: `name` is required and must be non-empty.');
  }
  if (!opts.description || opts.description.length === 0) {
    throw new Error(`flowchartAsTool(${opts.name}): \`description\` is required.`);
  }
  if (!opts.flowchart) {
    throw new Error(`flowchartAsTool(${opts.name}): \`flowchart\` is required.`);
  }

  const mapper: FlowchartResultMapper =
    opts.resultMapper ?? ((snapshot) => JSON.stringify(snapshot.values));

  return defineTool<Record<string, unknown>, string>({
    name: opts.name,
    description: opts.description,
    inputSchema: opts.inputSchema,
    execute: async (args, ctx: ToolExecutionContext) => {
      const executor = new FlowChartExecutor(opts.flowchart);
      for (const recorder of opts.recorders ?? []) {
        executor.attachCombinedRecorder(recorder);
      }
      const env: { signal?: AbortSignal } = {};
      if (ctx.signal) env.signal = ctx.signal;
      await executor.run({ input: args, env });
      if (executor.isPaused()) {
        const err = new Error(
          `flowchartAsTool(${opts.name}): inner flowchart paused. ` +
            `Agent-side pause integration lands in v2.6. The checkpoint is on err.checkpoint.`,
        );
        (err as Error & { checkpoint?: unknown }).checkpoint = executor.getCheckpoint();
        throw err;
      }
      const raw = executor.getSnapshot();
      // footprintjs's RuntimeSnapshot exposes `sharedState` for the
      // merged scope. Older betas used `values`; we accept either to
      // remain robust against minor drift.
      const sharedState =
        (raw as { sharedState?: Readonly<Record<string, unknown>> }).sharedState ??
        (raw as { values?: Readonly<Record<string, unknown>> }).values ??
        {};
      const snapshot: FlowchartToolSnapshot = {
        values: sharedState,
        narrative: extractNarrative(raw, executor),
      };
      try {
        return mapper(snapshot);
      } catch (e) {
        // Preserve the consumer's error string but mark the envelope
        // so the LLM can see it was a result-mapper error and not the
        // flowchart itself.
        const reason = e instanceof Error ? e.message : String(e);
        return `[mapper-error: ${reason}]`;
      }
    },
  });
}

/**
 * Pull the narrative entries off the snapshot or executor in a
 * defensive way — footprintjs's snapshot shape is RuntimeSnapshot but
 * the public field names vary across minor versions. We probe known
 * shapes and fall back to an empty array.
 *
 * The executor exposes `getNarrativeEntries()` which is the canonical
 * source today; we prefer that, then fall back to snapshot fields.
 */
function extractNarrative(
  raw: unknown,
  executor: { getNarrativeEntries?: () => readonly unknown[] } | undefined,
): readonly { readonly type?: string; readonly text?: string }[] {
  if (executor && typeof executor.getNarrativeEntries === 'function') {
    try {
      const entries = executor.getNarrativeEntries();
      if (Array.isArray(entries)) {
        return entries as readonly { readonly type?: string; readonly text?: string }[];
      }
    } catch {
      // fall through to snapshot probe
    }
  }
  if (!raw || typeof raw !== 'object') return [];
  const candidate =
    (raw as { narrative?: unknown }).narrative ??
    (raw as { narrativeEntries?: unknown }).narrativeEntries;
  if (Array.isArray(candidate)) {
    return candidate as readonly { readonly type?: string; readonly text?: string }[];
  }
  return [];
}
