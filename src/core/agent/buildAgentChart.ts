/**
 * buildAgentChart — assemble the agent's full footprintjs FlowChart
 * from stage functions + slot subflows + memory wiring.
 *
 * This is the "chart composition" that used to live inline in
 * `Agent.buildChart()`. Extracted for v2.11.2 so:
 *
 *   1. Agent.ts focuses on Agent class lifecycle (constructor, run,
 *      attach, getSpec) instead of chart wiring details.
 *   2. The reliability gate chart (v2.11.x) wires into ONE focused
 *      file rather than surgically into Agent.ts's 250-line composition
 *      block.
 *   3. The composition is independently readable + reviewable —
 *      consumers building custom agent shapes have a reference.
 *
 * Chart shape:
 *
 *     Seed
 *       → [memory READ subflows for each .memory()]
 *       → InjectionEngine (subflow)
 *       → SystemPrompt (slot subflow)
 *       → Messages (slot subflow)
 *       → Tools (slot subflow)
 *       → CacheDecision (subflow)
 *       → UpdateSkillHistory
 *       → CacheGate (decider) → ApplyMarkers / SkipCaching
 *       → IterationStart
 *       → CallLLM
 *       → Route (decider) → tool-calls (pausable) / final (subflow)
 *                                                        |
 *                          ┌────── PrepareFinal           ▼
 *                          ├──── [memory WRITE subflows]
 *                          └──── BreakFinal ($break)
 *       loopTo(InjectionEngine)
 *
 * (When v2.11.x reliability is configured, the reliability gate chart
 * mounts as a subflow between IterationStart and CallLLM with a
 * TranslateFailFast stage after it. Lands in the next commit.)
 */

import { ArrayMergeMode } from 'footprintjs/advanced';
import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import type { LLMMessage } from '../../adapters/types.js';
import type { CachePolicy } from '../../cache/types.js';
import { STAGE_IDS, SUBFLOW_IDS } from '../../conventions.js';
import type { ActiveInjection, Injection } from '../../lib/injection-engine/types.js';
import type { MemoryDefinition } from '../../memory/define.types.js';
import { memoryInjectionKey } from '../../memory/define.types.js';
import { unwrapMemoryFlowChart } from '../../memory/define.js';
import { mountMemoryRead, mountMemoryWrite } from '../../memory/wire/mountMemoryPipeline.js';
import { breakFinalStage } from './stages/breakFinal.js';
import { prepareFinalStage } from './stages/prepareFinal.js';
import type { AgentState } from './types.js';

/**
 * Stage handlers + slot subflows the chart composer needs. Mostly
 * passed through verbatim from Agent.buildChart() — the chart shape
 * is identical to what was inline before.
 */
export interface AgentChartDeps {
  /** Memory READ/WRITE pipeline definitions (one per `.memory()`). */
  readonly memories: readonly MemoryDefinition[];

  /** Cache policy for the system-prompt slot, threaded into
   *  CacheDecision's inputMapper so its decision rules can match. */
  readonly systemPromptCachePolicy: CachePolicy;

  /** Hard ReAct iteration cap, threaded into CacheDecision's
   *  inputMapper for max-iteration policies. */
  readonly maxIterations: number;

  // ─ Stage handlers ───────────────────────────────────────────────
  readonly seed: (scope: never) => void;
  readonly iterationStart: (scope: never) => void;
  readonly callLLM: (scope: never) => Promise<void>;
  readonly routeDecider: (scope: never) => 'tool-calls' | 'final';
  readonly toolCallsHandler: import('footprintjs').PausableHandler<never>;

  // ─ Slot subflows ───────────────────────────────────────────────
  readonly injectionEngineSubflow: FlowChart;
  readonly systemPromptSubflow: FlowChart;
  readonly messagesSubflow: FlowChart;
  readonly toolsSubflow: FlowChart;

  // ─ Cache layer ──────────────────────────────────────────────────
  readonly cacheDecisionSubflow: FlowChart;
  readonly updateSkillHistoryStage: (scope: never) => void;
  readonly cacheGateDecide: (scope: never) => unknown;
}

/**
 * Build the agent's complete FlowChart from the supplied deps.
 */
export function buildAgentChart(deps: AgentChartDeps): FlowChart {
  // ── Final-branch subflow ─────────────────────────────────────
  // Split so memory-write subflows can mount BETWEEN setting
  // finalContent and breaking the ReAct loop. PrepareFinal captures
  // the turn payload; BreakFinal terminates the loop.
  let finalBranchBuilder = flowChart<AgentState>(
    'PrepareFinal',
    prepareFinalStage,
    'prepare-final',
    undefined,
    'Capture turn payload (finalContent + newMessages)',
  );
  for (const m of deps.memories) {
    if (m.write) {
      finalBranchBuilder = mountMemoryWrite(finalBranchBuilder, {
        pipeline: {
          read: unwrapMemoryFlowChart(m.read) as never,
          write: unwrapMemoryFlowChart(m.write) as never,
        },
        identityKey: 'runIdentity',
        turnNumberKey: 'turnNumber',
        contextTokensKey: 'contextTokensRemaining',
        newMessagesKey: 'newMessages',
        writeSubflowId: `sf-memory-write-${m.id}`,
      });
    }
  }
  const finalBranchChart = finalBranchBuilder
    .addFunction('BreakFinal', breakFinalStage, 'break-final', 'Terminate the ReAct loop')
    .build();

  // ── Main chart ──────────────────────────────────────────────
  // Description prefix `Agent:` is a taxonomy marker — consumers
  // (Lens + FlowchartRecorder) detect Agent-primitive subflows via
  // this prefix and flag them as true agent boundaries (separate
  // from LLMCall subflows which use `LLMCall:` prefix).
  let builder = flowChart<AgentState>(
    'Seed',
    deps.seed as never,
    STAGE_IDS.SEED,
    undefined,
    'Agent: ReAct loop',
  );

  // Memory READ subflows — mounted between Seed and InjectionEngine
  // for TURN_START timing (default). Each memory writes to its own
  // scope key (`memoryInjection_${id}`) so multiple `.memory()`
  // registrations layer without colliding.
  for (const m of deps.memories) {
    builder = mountMemoryRead(builder, {
      pipeline: {
        read: unwrapMemoryFlowChart(m.read) as never,
        ...(m.write !== undefined && { write: unwrapMemoryFlowChart(m.write) as never }),
      },
      identityKey: 'runIdentity',
      turnNumberKey: 'turnNumber',
      contextTokensKey: 'contextTokensRemaining',
      injectionKey: memoryInjectionKey(m.id),
      readSubflowId: `sf-memory-read-${m.id}`,
    });
  }

  builder = builder
    // Injection Engine — evaluates every Injection's trigger once
    // per iteration; writes activeInjections[] to parent scope for
    // the slot subflows to consume. Skipped if no injections were
    // registered (no observable difference, just one more no-op
    // subflow boundary).
    .addSubFlowChartNext(SUBFLOW_IDS.INJECTION_ENGINE, deps.injectionEngineSubflow, 'Injection Engine', {
      inputMapper: (parent) => ({
        iteration: parent.iteration as number | undefined,
        userMessage: parent.userMessage as string | undefined,
        history: parent.history as readonly LLMMessage[] | undefined,
        lastToolResult: parent.lastToolResult as
          | { toolName: string; result: string }
          | undefined,
        activatedInjectionIds:
          (parent.activatedInjectionIds as readonly string[] | undefined) ?? [],
      }),
      outputMapper: (sf) => ({ activeInjections: sf.activeInjections }),
      // CRITICAL: footprintjs's default `applyOutputMapping`
      // CONCATENATES arrays from subflow output with the parent's
      // existing array values. Without `Replace`, the parent's
      // `activeInjections` from iter N gets CONCATENATED with the
      // subflow's iter N+1 fresh evaluation — producing
      // 8 → 16 → 24 → 32 cumulative injections per turn.
      arrayMerge: ArrayMergeMode.Replace,
    })
    .addSubFlowChartNext(SUBFLOW_IDS.SYSTEM_PROMPT, deps.systemPromptSubflow, 'System Prompt', {
      inputMapper: (parent) => ({
        userMessage: parent.userMessage as string | undefined,
        iteration: parent.iteration as number | undefined,
        activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
      }),
      outputMapper: (sf) => ({ systemPromptInjections: sf.systemPromptInjections }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    .addSubFlowChartNext(SUBFLOW_IDS.MESSAGES, deps.messagesSubflow, 'Messages', {
      inputMapper: (parent) => ({
        messages: parent.history as readonly LLMMessage[] | undefined,
        iteration: parent.iteration as number | undefined,
        activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
      }),
      outputMapper: (sf) => ({ messagesInjections: sf.messagesInjections }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    .addSubFlowChartNext(SUBFLOW_IDS.TOOLS, deps.toolsSubflow, 'Tools', {
      inputMapper: (parent) => ({
        iteration: parent.iteration as number | undefined,
        activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
        // The slot subflow reads these to build the per-iteration
        // ToolDispatchContext when an external `.toolProvider()` is
        // configured. Without them the provider sees activeSkillId
        // = undefined every iteration, breaking skillScopedTools etc.
        activatedInjectionIds: parent.activatedInjectionIds as readonly string[] | undefined,
        runIdentity: parent.runIdentity as
          | { tenant?: string; principal?: string; conversationId: string }
          | undefined,
      }),
      outputMapper: (sf) => ({
        toolsInjections: sf.toolsInjections,
        // Pass merged tool schemas (registry + injection-supplied)
        // back up so callLLM uses the right list for THIS iteration.
        dynamicToolSchemas: sf.toolSchemas,
      }),
      // Same array-concat hazard as InjectionEngine — replace, don't
      // concatenate. Without Replace the deduped tool list re-acquires
      // duplicates that providers reject.
      arrayMerge: ArrayMergeMode.Replace,
    })
    // ── Cache layer (v2.6) ─────────────────────────────────────
    .addSubFlowChartNext(SUBFLOW_IDS.CACHE_DECISION, deps.cacheDecisionSubflow, 'CacheDecision', {
      inputMapper: (parent) => ({
        activeInjections: (parent.activeInjections as readonly Injection[] | undefined) ?? [],
        iteration: (parent.iteration as number | undefined) ?? 1,
        maxIterations: (parent.maxIterations as number | undefined) ?? deps.maxIterations,
        userMessage: (parent.userMessage as string | undefined) ?? '',
        ...(parent.lastToolResult !== undefined && {
          lastToolName: (parent.lastToolResult as { toolName: string } | undefined)?.toolName,
        }),
        cumulativeInputTokens: (parent.totalInputTokens as number | undefined) ?? 0,
        systemPromptCachePolicy: deps.systemPromptCachePolicy,
        cachingDisabled: (parent.cachingDisabled as boolean | undefined) ?? false,
      }),
      outputMapper: (sf) => ({ cacheMarkers: sf.cacheMarkers }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    .addFunction(
      'UpdateSkillHistory',
      deps.updateSkillHistoryStage as never,
      STAGE_IDS.UPDATE_SKILL_HISTORY,
      'Update skill-history rolling window for CacheGate churn detection',
    )
    .addDeciderFunction(
      'CacheGate',
      deps.cacheGateDecide as never,
      STAGE_IDS.CACHE_GATE,
      'Gate cache-marker application: kill switch / hit-rate / skill-churn',
    )
    .addFunctionBranch(
      STAGE_IDS.APPLY_MARKERS,
      'ApplyMarkers',
      // Pass-through stage — markers stay in scope as-is.
      // BuildLLMRequest (Phase 7+) reads them on the next stage.
      () => undefined,
      'Proceed with cache markers from CacheDecision',
    )
    .addFunctionBranch(
      STAGE_IDS.SKIP_CACHING,
      'SkipCaching',
      // Clear markers so BuildLLMRequest sees an empty list and
      // makes the request unmodified.
      (scope) => {
        (scope as { cacheMarkers: readonly unknown[] }).cacheMarkers = [];
      },
      'Skip caching this iteration',
    )
    .end()
    .addFunction(
      'IterationStart',
      deps.iterationStart as never,
      'iteration-start',
      'Iteration begin marker',
    )
    .addFunction('CallLLM', deps.callLLM as never, STAGE_IDS.CALL_LLM, 'LLM invocation')
    .addDeciderFunction('Route', deps.routeDecider as never, SUBFLOW_IDS.ROUTE, 'ReAct routing')
    .addPausableFunctionBranch(
      'tool-calls',
      'ToolCalls',
      deps.toolCallsHandler as never,
      'Tool execution (pausable via pauseHere)',
    )
    .addSubFlowChartBranch('final', finalBranchChart, 'Final', {
      // Pass through the read-only state the sub-chart needs;
      // OMIT keys the sub-chart writes (finalContent, newMessages)
      // — passing those via inputMapper would freeze them as args.
      inputMapper: (parent) => {
        const { finalContent: _f, newMessages: _nm, ...rest } = parent;
        void _f;
        void _nm;
        return rest;
      },
      outputMapper: (sf) => ({
        finalContent: sf.finalContent as string,
      }),
      // BreakFinal's $break() must reach the outer loopTo so the
      // ReAct iteration terminates; without this the inner break
      // only exits the sub-chart and the outer loop continues.
      propagateBreak: true,
    })
    .setDefault('final')
    .end()
    // Dynamic ReAct: loop back to the InjectionEngine so EVERY iteration
    // re-evaluates triggers (rule predicates, on-tool-return,
    // llm-activated) against the freshest context (the just-appended
    // tool result). Without this, the InjectionEngine runs ONCE per
    // turn — quietly breaking the framework's "Dynamic ReAct" claim.
    .loopTo(SUBFLOW_IDS.INJECTION_ENGINE);

  return builder.build();
}
