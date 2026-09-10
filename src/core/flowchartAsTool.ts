/**
 * flowchartAsTool — wrap a footprintjs `FlowChart` as an Agent `Tool`.
 *
 * NOTE (9.76.0): for NEW procedures prefer `runbookAsTool` (core/runbook/) —
 * the standard bridge whose every answer carries the honesty envelope
 * (coverage, provenance, rule version, the recorded walk). This thin wrapper
 * stays for compatibility; `resultMapper` users stay put and nothing here
 * changes.
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
 *   3. **The record can go THROUGH the boundary.** `keepRecord: true`
 *      retains each invocation's inner record under the `toolCallId` that
 *      named the call, so a `.selfExplain()` agent asked "why did you say
 *      it will rain?" does not stop at *"⚠ what happened inside the tool
 *      is not traced"* — it descends with `inspect_tool_run` and cites the
 *      inner stage and the field that decided it. Off by default: a
 *      retained record is retained memory (bounded LRU, default 20
 *      invocations, `keepRecordLimit` to change it).
 *
 *   4. **Pause/resume composes.** A pausable handler inside the
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
 *
 * @example  A tool whose inner run the agent can explain later
 *   const adviceTool = flowchartAsTool({
 *     name: 'weather_advice',
 *     description: 'Fetch tomorrow’s forecast and advise on biking.',
 *     inputSchema: { ... },
 *     flowchart: adviceChart,
 *     keepRecord: true,               // keep each invocation's inner record
 *     keepRecordLimit: 20,            // …bounded (default; LRU)
 *     redact: { keys: ['apiKey'] },   // …one rule: the log, the result, the kept record
 *   });
 *
 *   const agent = Agent.create({ provider })
 *     .tool(adviceTool)
 *     .selfExplain()   // inspect_tool_call now teaches inspect_tool_run
 *     .build();
 */

import {
  FlowChartExecutor,
  type CombinedRecorder,
  type FlowChart,
  type RedactionPolicy,
} from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';

import {
  DEFAULT_INNER_RUN_LIMIT,
  INNER_RUN_RECORDS,
  innerRunStore,
  type InnerRunOutcome,
  type InnerRunStore,
  type KeepsInnerRuns,
} from '../lib/trace-toolpack/innerRunRecords.js';
import { servableSnapshot } from './servableSnapshot.js';
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
   * Final scope state — the merged result of every stage's writes, as the
   * tool may SHOW it: `executor.getSnapshot().sharedState` without a
   * `redact` policy, the redacted mirror with one (`servableSnapshot`).
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
  /**
   * KEEP the inner run's record, so the agent's trace can go THROUGH this
   * tool boundary instead of stopping at it.
   *
   * Off by default, and the default is the honest one: a retained record
   * is a retained snapshot, and a tool called every turn would pin one per
   * call forever. Turning it on is the caller agreeing to that memory.
   *
   * With it on, each invocation's record is filed under the `toolCallId`
   * the outer run already uses to name the call — so `inspect_tool_call`
   * gains a line teaching the descent, and `inspect_tool_run` opens the
   * inner chart with the same drill vocabulary (overview → step → value →
   * why). Records are bounded: the last {@link keepRecordLimit}
   * invocations, least-recently-used dropped first, and a session that
   * dropped some says so rather than answering "not found".
   *
   * What it costs when ON: one `controlDepRecorder()` attached per
   * invocation (so inner slices carry the `[control: rule]` edges a
   * serialized recording can never carry back), and the invocation's
   * snapshot held by reference until it ages out.
   *
   * What it costs when OFF: nothing. No store, no extra recorder, no
   * capture — the byte-identical path this tool had before the option
   * existed.
   *
   * **One store per `flowchartAsTool(...)` call**, held on the returned
   * tool — the same scoping as the `recorders` array above. Mount that one
   * tool object on two agents and they share it, which is usually what you
   * want (the id is the agent's own tool-call id) but is worth knowing if
   * the two agents can mint the same id: build the tool twice instead.
   */
  readonly keepRecord?: boolean;
  /**
   * How many invocations `keepRecord` retains. Default
   * {@link DEFAULT_INNER_RUN_LIMIT} (20) — a debugging window, not an
   * archive. Only meaningful with `keepRecord: true`; passing it alone is
   * refused rather than silently ignored.
   */
  readonly keepRecordLimit?: number;
  /**
   * Redaction policy for the INNER run, applied before every invocation
   * (`executor.setRedactionPolicy`).
   *
   * footprintjs scrubs at COMMIT time, so a redacted key never reaches the
   * inner COMMIT LOG at all — through every path, since footprintjs 9.19.0
   * (see 3 below). Same mechanism, same placeholders, and the same
   * `(redacted by policy)` flag as the outer run; the trace tools pass
   * placeholders through verbatim and never reconstruct around them.
   *
   * ONE RULE FOR EVERYTHING THE TOOL SHOWS (9.89.1). With a policy set, every
   * state-bearing thing this tool hands outward is footprintjs's REDACTED
   * view — `getSnapshot({ redact: true })`, the mirror the engine maintains
   * beside the raw heap for exactly this — taken through one owner,
   * `servableSnapshot`:
   *
   * - the string this tool RETURNS: `resultMapper` is handed `snapshot.values`
   *   from that view (`'REDACTED'` where the log says so), so the default
   *   `JSON.stringify` and a custom mapper see the same thing the log holds;
   * - a kept record's `sharedState`, `commitLog` and every subflow's final
   *   state (`subflowResults[*].treeContext.globalContext`, refolded from that
   *   subflow's own scrubbed `history` — the level footprintjs does not mirror);
   * - on every exit — ok, error, paused — the record is filed from that view.
   *
   * Independent of `keepRecord` — a chart handling secrets should carry a
   * policy whether or not anyone keeps its record. Without this option the
   * raw snapshot is served, byte for byte as before.
   *
   * WHAT IT DOES NOT GOVERN — said here so nobody has to rediscover it:
   *
   * 1. Fold bases. The redacted view OMITS `initialState` (footprintjs
   *    `ExecutionRuntime.getSnapshot`: the raw pre-run seed never passed a
   *    policy, so it is dropped rather than served), and the served view
   *    drops a subflow's by the same law. A fold of a kept record therefore
   *    reports `basis: 'log-only'` — partial, and saying so.
   * 2. The resume checkpoint. A paused run throws with `err.checkpoint`,
   *    which holds real values because resumption must replay against them;
   *    it goes to the agent loop, never to a model.
   * 3. What the LOG itself carries — footprintjs's law, not this option's,
   *    and since footprintjs 9.19.0 (this package's floor from 9.89.2) that
   *    law is one rule: a policy covers everything the run retains or serves
   *    — the log in both encodings, the mirror, `stageReads`/`stageWrites`,
   *    the narrative, a subflow's `inputMapper` seed (its `history[0]` and
   *    its `Input:` line), its `outputMapper` merge-back, `fields` dot-paths
   *    — and never the live heap or the checkpoint. The five places 9.18
   *    left plaintext in the record (dot-path fields, merge-back, seed, seed
   *    narrative, tracked reads) are closed at the root, and each is asserted
   *    closed in `test/core/flowchartAsTool.redact.test.ts` §6 (red on 9.18).
   *    So "every field" means every field, and the log agrees. ONE surface
   *    footprintjs's redacted view still leaves raw —
   *    `subflowResults[*].treeContext.globalContext` and its `#n` twin, the
   *    subflow's own heap, since only the run-level runtime keeps a mirror —
   *    and THIS option answers it: `servableSnapshot` refolds that state from
   *    the subflow's scrubbed `history` (§7 of the same file pins both the
   *    limit and the answer). A consumer reading footprintjs's snapshot
   *    directly, not through this tool, still sees that heap raw.
   */
  readonly redact?: RedactionPolicy;
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
 *      default JSON.stringify) and returns the string. The snapshot is
 *      the SERVED view (`servableSnapshot`): redacted when `redact` is
 *      set, raw otherwise — the same view the kept record holds.
 *   6. If the run threw, the error propagates — the Agent's
 *      tool-call handler converts it to a synthetic error string for
 *      the LLM to see + recover from.
 *   7. With `keepRecord: true`, files the inner record under
 *      `ctx.toolCallId` on ALL THREE exits (ok / error / paused) —
 *      "why did it fail?" is the question most likely to come next.
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
  if (opts.keepRecordLimit !== undefined) {
    if (opts.keepRecord !== true) {
      throw new Error(
        `flowchartAsTool(${opts.name}): \`keepRecordLimit\` caps records that are never kept — ` +
          `\`keepRecord\` is not on, so nothing is retained and the cap governs nothing. Add ` +
          `\`keepRecord: true\` to keep the inner run's record (and let inspect_tool_run open ` +
          `it), or drop \`keepRecordLimit\`.`,
      );
    }
    if (!Number.isInteger(opts.keepRecordLimit) || opts.keepRecordLimit < 1) {
      throw new Error(
        `flowchartAsTool(${opts.name}): \`keepRecordLimit\` must be a whole number of ` +
          `invocations, at least 1 — got ${String(opts.keepRecordLimit)}. A limit of 0 is ` +
          `\`keepRecord: false\`, and saying it with a zero is config that lies.`,
      );
    }
  }

  const mapper: FlowchartResultMapper =
    opts.resultMapper ?? ((snapshot) => JSON.stringify(snapshot.values));

  // Built only when asked for. `undefined` here is what makes the whole
  // feature free when it is off: no store, no extra recorder, no capture.
  const store: InnerRunStore | undefined =
    opts.keepRecord === true
      ? innerRunStore(opts.keepRecordLimit ?? DEFAULT_INNER_RUN_LIMIT)
      : undefined;

  const tool = defineTool<Record<string, unknown>, string>({
    name: opts.name,
    description: opts.description,
    inputSchema: opts.inputSchema,
    execute: async (args, ctx: ToolExecutionContext) => {
      const executor = new FlowChartExecutor(opts.flowchart);
      if (opts.redact) executor.setRedactionPolicy(opts.redact);
      for (const recorder of opts.recorders ?? []) {
        executor.attachCombinedRecorder(recorder);
      }
      // A fresh control-dependence recorder PER INVOCATION, only when the
      // record is being kept. Live in process, so unlike a serialized
      // recording the inner slices can carry `[control: rule]` edges.
      const ctrl = store ? controlDepRecorder() : undefined;
      if (ctrl) executor.attachCombinedRecorder(ctrl as unknown as CombinedRecorder);

      /**
       * File this invocation's record. Called on ALL THREE exits — a run
       * that threw and a run that paused are complete records of what
       * happened, and "why did it fail?" is the question most likely to
       * come next.
       *
       * Capture failure never fails the tool call: the call already
       * succeeded (or already failed on its own terms), and losing the
       * record is not a reason to change that. It is not swallowed either
       * — the record is filed carrying the reason, so `inspect_tool_run`
       * says what went wrong instead of behaving like the call never
       * happened.
       */
      const keepRecordOf = (outcome: InnerRunOutcome, known?: unknown): void => {
        if (!store) return;
        try {
          const snapshot = known ?? servableSnapshot(executor, opts.redact);
          const commitLog = (snapshot as { commitLog?: readonly unknown[] }).commitLog;
          const narrative = extractNarrative(snapshot, executor)
            .map((entry) => (typeof entry.text === 'string' ? entry.text : ''))
            .filter((text) => text.length > 0);
          store.keep({
            toolCallId: ctx.toolCallId,
            toolName: opts.name,
            outcome,
            steps: Array.isArray(commitLog) ? commitLog.length : 0,
            recording: {
              snapshot,
              structure: (opts.flowchart as { buildTimeStructure?: unknown }).buildTimeStructure,
            },
            ...(ctrl !== undefined && { controlDeps: ctrl.asLookup() }),
            ...(narrative.length > 0 && { narrative }),
          });
        } catch (e) {
          store.keep({
            toolCallId: ctx.toolCallId,
            toolName: opts.name,
            outcome,
            steps: 0,
            problem: e instanceof Error ? e.message : String(e),
          });
        }
      };

      const env: { signal?: AbortSignal } = {};
      if (ctx.signal) env.signal = ctx.signal;
      try {
        await executor.run({ input: args, env });
      } catch (e) {
        keepRecordOf('error');
        throw e;
      }
      if (executor.isPaused()) {
        keepRecordOf('paused');
        const err = new Error(
          `flowchartAsTool(${opts.name}): inner flowchart paused. Agent-side pause ` +
            `integration lands with the runbook program's approval-gate phase (see ` +
            `runbookAsTool). The checkpoint is on err.checkpoint.`,
        );
        (err as Error & { checkpoint?: unknown }).checkpoint = executor.getCheckpoint();
        throw err;
      }
      // ONE view for the record AND the result: with a policy set this is
      // the redacted mirror (subflow states refolded), otherwise the raw
      // snapshot — see `servableSnapshot`.
      const served = servableSnapshot(executor, opts.redact);
      // Kept BEFORE the mapper runs: a mapper that throws still leaves a
      // complete record of the run it was mapping.
      keepRecordOf('ok', served);
      // footprintjs's RuntimeSnapshot exposes `sharedState` for the
      // merged scope. Older betas used `values`; we accept either to
      // remain robust against minor drift.
      const sharedState =
        (served as { sharedState?: Readonly<Record<string, unknown>> }).sharedState ??
        (served as { values?: Readonly<Record<string, unknown>> }).values ??
        {};
      const snapshot: FlowchartToolSnapshot = {
        values: sharedState,
        narrative: extractNarrative(served, executor),
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

  // The store rides the Tool under a registry symbol — invisible to the
  // LLM, invisible to `Tool`'s shape, and found by `innerRunsOf()`. The
  // Agent builder collects it at `.build()` and hands it to the trace
  // artifacts, so the descent needs no wiring from the consumer.
  if (store === undefined) return tool;
  const keepsRecords: Tool & KeepsInnerRuns = { ...tool, [INNER_RUN_RECORDS]: store };
  return keepsRecords;
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
