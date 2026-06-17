/**
 * buildDynamicAgentChart — the Dynamic-ReAct agent chart, where the
 * whole LLM turn (context engineering + the call) is ONE `sf-llm-call`
 * subflow, exactly like the `LLMCall` primitive produces.
 *
 * WHY a second builder (vs `buildAgentChart`)
 * ───────────────────────────────────────────
 * `buildAgentChart` mounts the LLM as a flat `call-llm` STAGE with the
 * slot subflows as its siblings. That renders as nothing in Lens — a
 * bare stage is dropped by the subflow-level collapser, so the slots
 * have no LLM card to fold into and the chart comes up empty.
 *
 * This builder wraps that same region in an `sf-llm-call` SUBFLOW. The
 * payoff is purely structural — Lens already maps `sf-llm-call → LLM
 * group` (same boundary `LLMCall` produces), so the Dynamic agent
 * renders as an LLM group with its slots inside, a peer Tool node, and
 * the loop arc, with ZERO Lens-specific special-casing.
 *
 * The data flow is IDENTICAL to `buildAgentChart` — every stage handler
 * + slot subflow is reused verbatim from the same `AgentChartDeps`. The
 * ONLY new thing is the subflow boundary, which means:
 *
 *   • A small inner seed (`dynamicTurnSeed`) initialises the per-turn
 *     working keys the OUTER seed used to set, since the inner subflow
 *     gets a fresh scope each loop re-entry.
 *   • Cross-iteration accumulators (token totals, cost counters,
 *     skill-history) round-trip out→in: the boundary `outputMapper`
 *     bubbles them to the outer scope, and the next iteration's
 *     `inputMapper` feeds them back under `prior*` aliases (because
 *     keys passed via `inputMapper` are FROZEN inside the subflow —
 *     `ScopeFacade.setValue` throws on them — so the writable working
 *     key must have a different name from the read-only input).
 *
 * Chart shape (mirrors the diagram the team locked):
 *
 *     Initialize
 *       → [memory READ subflows]
 *       → sf-llm-call  (SUBFLOW — same boundary LLMCall produces)
 *           dynamicTurnSeed → InjectionEngine
 *           → Context (selector, PARALLEL fan-out, failFast)
 *               ⇉ {System Prompt ‖ Messages ‖ Tools} → converge
 *           → UpdateSkillHistory → Cache (sf-cache subflow)
 *           → CallLLM (emits iteration_start) → [NormalizeThinking]
 *       → Route (decider)
 *            ├─ tool-calls (pausable) → loopTo(sf-llm-call)   ← branch-sourced loop
 *            └─ sf-final (the answer) → terminal leaf
 *
 * Classic ReAct keeps using `buildAgentChart` until its own shape is
 * designed — this builder is Dynamic-only.
 */

import { ArrayMergeMode } from 'footprintjs/advanced';
import { flowChart, select } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../adapters/types.js';
import { STAGE_IDS, SUBFLOW_IDS } from '../../conventions.js';
import {
  EMPTY_ACTIVE_BY_SLOT,
  type ActiveBySlot,
} from '../../lib/injection-engine/buildInjectionEngineSubflow.js';
import type { ActiveInjection, Injection } from '../../lib/injection-engine/types.js';
import { memoryInjectionKey } from '../../memory/define.types.js';
import { unwrapMemoryFlowChart } from '../../memory/define.js';
import { mountMemoryRead, mountMemoryWrite } from '../../memory/wire/mountMemoryPipeline.js';
import { breakFinalStage } from './stages/breakFinal.js';
import { prepareFinalStage } from './stages/prepareFinal.js';
import { buildCacheSubflow } from './buildCacheSubflow.js';
import type { AgentChartDeps } from './buildAgentChart.js';
import type { AgentState } from './types.js';

/**
 * Inner seed for the `sf-llm-call` subflow. Initialises the per-turn
 * working keys (the ones the OUTER seed set on the flat chart) and
 * copies the cross-iteration accumulators from their read-only `prior*`
 * inputs into the writable working keys.
 *
 * Why the `prior*` indirection: `inputMapper` values are frozen inside
 * the subflow (any `scope.set` on them throws). callLLM does
 * `scope.totalInputTokens += usage` — so `totalInputTokens` must be a
 * writable working key, seeded here from the frozen `priorTotalInputTokens`.
 */
function dynamicTurnSeed(scope: TypedScope<AgentState>): void {
  const args = scope.$getArgs<{
    priorTotalInputTokens?: number;
    priorTotalOutputTokens?: number;
    priorCumTokensInput?: number;
    priorCumTokensOutput?: number;
    priorCumEstimatedUsd?: number;
    priorCostBudgetHit?: boolean;
    priorSkillHistory?: readonly (string | undefined)[];
  }>();

  // Cross-iteration accumulators — seed working keys from prior totals
  // so they continue to accumulate across loop re-entries.
  scope.totalInputTokens = args.priorTotalInputTokens ?? 0;
  scope.totalOutputTokens = args.priorTotalOutputTokens ?? 0;
  scope.cumTokensInput = args.priorCumTokensInput ?? 0;
  scope.cumTokensOutput = args.priorCumTokensOutput ?? 0;
  scope.cumEstimatedUsd = args.priorCumEstimatedUsd ?? 0;
  scope.costBudgetHit = args.priorCostBudgetHit ?? false;
  scope.skillHistory = args.priorSkillHistory ?? [];

  // Per-iteration working keys — fresh each turn (slots + cache + callLLM
  // populate these inside the subflow; nothing outside reads the
  // injection arrays, so they stay subflow-internal).
  scope.activeInjections = [];
  scope.systemPromptInjections = [];
  scope.messagesInjections = [];
  scope.toolsInjections = [];
  scope.cacheMarkers = [];
  scope.llmLatestContent = '';
  scope.llmLatestToolCalls = [];
  scope.thinkingBlocks = [];
}

/**
 * Build the Dynamic-ReAct agent chart from the shared `AgentChartDeps`.
 */
export function buildDynamicAgentChart(deps: AgentChartDeps): FlowChart {
  // ── Final-branch subflow ─────────────────────────────────────
  // Identical to buildAgentChart: PrepareFinal captures the turn
  // payload, memory-write subflows persist it, BreakFinal terminates
  // the ReAct loop. Lives in the OUTER chart (the final answer is a
  // peer of the LLM turn, not part of it).
  let finalBranchBuilder = flowChart<AgentState>(
    'PrepareFinal',
    prepareFinalStage,
    'prepare-final',
    {
      ...(deps.structureRecorders !== undefined && {
        structureRecorders: [...deps.structureRecorders],
      }),
      description: 'Capture turn payload (finalContent + newMessages)',
    },
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
        // Evidence bridge (#5): only CAUSAL pipelines consume run evidence.
        ...(m.type === 'causal' &&
          deps.causalEvidenceSource && { evidenceSource: deps.causalEvidenceSource }),
      });
    }
  }
  const finalBranchChart = finalBranchBuilder
    .addFunction('BreakFinal', breakFinalStage, 'break-final', 'Terminate the ReAct loop')
    .build();

  // ── Inner sf-llm-call subflow ────────────────────────────────
  // The full context-engineering + call region. Every mount below is
  // copied verbatim from buildAgentChart — only the PARENT scope is
  // now the sf-llm-call scope instead of the flat agent scope, and
  // the keys those mappers read are all present there (read-only keys
  // via the boundary inputMapper, working keys via dynamicTurnSeed).
  let inner = flowChart<AgentState>('TurnSeed', dynamicTurnSeed, 'turn-seed', {
    ...(deps.structureRecorders !== undefined && {
      structureRecorders: [...deps.structureRecorders],
    }),
    // The `LLMCall:` prefix is DELIBERATE and load-bearing: Lens reads it
    // to render this subflow as an LLM group (the keystone goal), mirroring
    // the marker LLMCall.ts emits. The agent-ness is carried by the OUTER
    // chart's `Agent: ReAct loop` description — so this does NOT mislabel
    // the agent boundary (confirmed in the proposal's 7-person review).
    description: 'LLMCall: invocation internals',
  })
    .addSubFlowChartNext(
      SUBFLOW_IDS.INJECTION_ENGINE,
      deps.injectionEngineSubflow,
      'Injection Engine',
      {
        inputMapper: (parent) => ({
          iteration: parent.iteration as number | undefined,
          userMessage: parent.userMessage as string | undefined,
          history: parent.history as readonly LLMMessage[] | undefined,
          lastToolResult: parent.lastToolResult as { toolName: string; result: string } | undefined,
          activatedInjectionIds:
            (parent.activatedInjectionIds as readonly string[] | undefined) ?? [],
          // Last turn's per-slot active set for the engine's Delta stage. In the
          // grouped chart the sf-llm-call scope re-seeds each turn, so this is
          // not yet carried across turns — Delta degrades to "all added" here
          // (the flat/default chart carries it via the persistent parent scope).
          priorActiveByslot:
            (parent.activeByslot as ActiveBySlot | undefined) ?? EMPTY_ACTIVE_BY_SLOT,
          // Skill-graph cursor from the previous iteration (carried into sf-llm-call
          // by its outer boundary below). The `from`-gate for the route triggers.
          currentSkillId: parent.currentSkillId as string | undefined,
        }),
        outputMapper: (sf) => ({
          activeInjections: sf.activeInjections,
          activeByslot: sf.activeByslot,
          // Advanced cursor — bubbled up under its own key (sf-llm-call's
          // `currentSkillId` is a readonly input here), then mapped onto the
          // ReAct parent's mutable currentSkillId by the outer outputMapper.
          nextSkillCursor: sf.nextSkillCursor,
        }),
        arrayMerge: ArrayMergeMode.Replace,
      },
    )
    // ── Context assembly: the 3 slots run in PARALLEL (selector fan-out) ──
    // Identical to buildAgentChart's fork, just nested inside the sf-llm-call
    // inner chart. The slots are independent (each reads only InjectionEngine's
    // activeInjections + turn-seed state, each writes a disjoint output key),
    // so concurrent execution is faithful. failFast: true — a required slot
    // that throws aborts the turn (the default allSettled would swallow it).
    .addSelectorFunction(
      'Context',
      ((scope: TypedScope<AgentState>) =>
        select(scope, [
          { when: () => true, then: SUBFLOW_IDS.SYSTEM_PROMPT, label: 'engineer system-prompt' },
          { when: () => true, then: SUBFLOW_IDS.MESSAGES, label: 'engineer messages' },
          { when: () => true, then: SUBFLOW_IDS.TOOLS, label: 'engineer tools' },
        ])) as never,
      STAGE_IDS.CONTEXT,
      'Assemble request context: system-prompt + messages + tools (parallel)',
      { failFast: true },
    )
    // Branch mappers + arrayMerge:Replace VERBATIM from the former sequential
    // mounts (Replace is load-bearing — loopTo would otherwise accumulate).
    .addSubFlowChartBranch(SUBFLOW_IDS.SYSTEM_PROMPT, deps.systemPromptSubflow, 'System Prompt', {
      inputMapper: (parent) => ({
        userMessage: parent.userMessage as string | undefined,
        iteration: parent.iteration as number | undefined,
        activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
      }),
      outputMapper: (sf) => ({ systemPromptInjections: sf.systemPromptInjections }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    .addSubFlowChartBranch(SUBFLOW_IDS.MESSAGES, deps.messagesSubflow, 'Messages', {
      inputMapper: (parent) => ({
        messages: parent.history as readonly LLMMessage[] | undefined,
        iteration: parent.iteration as number | undefined,
        activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
      }),
      outputMapper: (sf) => ({ messagesInjections: sf.messagesInjections }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    .addSubFlowChartBranch(SUBFLOW_IDS.TOOLS, deps.toolsSubflow, 'Tools', {
      inputMapper: (parent) => ({
        iteration: parent.iteration as number | undefined,
        activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
        activatedInjectionIds: parent.activatedInjectionIds as readonly string[] | undefined,
        runIdentity: parent.runIdentity as
          | { tenant?: string; principal?: string; conversationId: string }
          | undefined,
      }),
      outputMapper: (sf) => ({
        toolsInjections: sf.toolsInjections,
        dynamicToolSchemas: sf.toolSchemas,
      }),
      arrayMerge: ArrayMergeMode.Replace,
      // STRUCTURE-ONLY merge target. When skills are off, UpdateSkillHistory
      // is omitted, so the fan-out must converge onto sf-cache instead — the
      // convergeAt target has to be a node that actually exists.
      convergeAt: deps.hasSkills ? STAGE_IDS.UPDATE_SKILL_HISTORY : SUBFLOW_IDS.CACHE,
    })
    .end();

  // ── Skill-churn window (cache concern) — conditional mount ───────
  // Mounted only when skills are registered (see buildAgentChart for the full
  // rationale: with no skills the window can never show churn, so the stage is
  // dead weight). UpdateSkillHistory stays in the loop (skillHistory must
  // persist across iterations); sf-cache is the pure decision layer.
  if (deps.hasSkills) {
    inner = inner.addFunction(
      'UpdateSkillHistory',
      deps.updateSkillHistoryStage as never,
      STAGE_IDS.UPDATE_SKILL_HISTORY,
      'Update skill-history rolling window for CacheGate churn detection',
    );
  }

  inner = inner
    .addSubFlowChartNext(SUBFLOW_IDS.CACHE, buildCacheSubflow(), 'Cache', {
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
        recentHitRate: parent.recentHitRate as number | undefined,
        skillHistory: (parent.skillHistory as readonly (string | undefined)[] | undefined) ?? [],
      }),
      outputMapper: (sf) => ({ cacheMarkers: sf.cacheMarkers }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    // CallLLM emits the per-iteration `iteration_start` marker itself (no
    // dedicated IterationStart stage — emitting is passive observability).
    .addFunction('CallLLM', deps.callLLM as never, STAGE_IDS.CALL_LLM, 'LLM invocation');

  if (deps.thinkingSubflow) {
    inner = inner.addSubFlowChartNext(
      SUBFLOW_IDS.THINKING,
      deps.thinkingSubflow,
      'NormalizeThinking',
      {
        inputMapper: (parent) => ({
          rawThinking: parent.rawThinking as unknown,
          iteration: parent.iteration as number | undefined,
        }),
        outputMapper: (sf) => ({ thinkingBlocks: sf.thinkingBlocks }),
        arrayMerge: ArrayMergeMode.Replace,
      },
    );
  }

  const llmCallSubflow = inner.build();

  // ── Outer chart ──────────────────────────────────────────────
  // Description prefix `Agent:` is the taxonomy marker Lens reads to
  // flag this as a true agent boundary.
  let builder = flowChart<AgentState>('Initialize', deps.seed as never, STAGE_IDS.SEED, {
    ...(deps.structureRecorders !== undefined && {
      structureRecorders: [...deps.structureRecorders],
    }),
    description: 'Agent: ReAct loop',
  });

  // Memory READ subflows — TURN_START timing (once per turn, OUTSIDE
  // the LLM-call loop body). Each writes `memoryInjection_${id}` to the
  // outer scope; the boundary inputMapper below threads those into the
  // subflow so the slots consume them.
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

  // Relevance entry router (`entryByRelevance`) — once per turn on the OUTER scope,
  // before the sf-llm-call loop (its loop target), so the chosen cursor is set on
  // the parent before the boundary inputMapper carries `currentSkillId` inward.
  if (deps.pickEntryStage) {
    builder = builder.addFunction(
      'PickEntry',
      deps.pickEntryStage as never,
      STAGE_IDS.PICK_ENTRY,
      'Pick the starting skill by relevance to the message (entryByRelevance)',
    );
  }

  builder = builder
    .addSubFlowChartNext(SUBFLOW_IDS.LLM_CALL, llmCallSubflow, 'LLM', {
      inputMapper: (parent) => {
        const p = parent as Record<string, unknown>;
        // Per-memory injection content the slots consume inside.
        const memoryKeys: Record<string, unknown> = {};
        for (const m of deps.memories) {
          const key = memoryInjectionKey(m.id);
          memoryKeys[key] = p[key];
        }
        return {
          // Read-only working inputs (stages read, never write these).
          userMessage: p.userMessage,
          iteration: p.iteration,
          history: p.history,
          maxIterations: p.maxIterations,
          runIdentity: p.runIdentity,
          cachingDisabled: p.cachingDisabled,
          recentHitRate: p.recentHitRate,
          activatedInjectionIds: p.activatedInjectionIds,
          lastToolResult: p.lastToolResult,
          // Skill-graph cursor carried into sf-llm-call (like activatedInjectionIds
          // / lastToolResult — a direct cross-iteration read, not a prior* alias).
          currentSkillId: p.currentSkillId,
          ...memoryKeys,
          // Cross-iteration accumulators under prior* aliases — frozen
          // here, copied to writable working keys by dynamicTurnSeed.
          priorTotalInputTokens: p.totalInputTokens,
          priorTotalOutputTokens: p.totalOutputTokens,
          priorCumTokensInput: p.cumTokensInput,
          priorCumTokensOutput: p.cumTokensOutput,
          priorCumEstimatedUsd: p.cumEstimatedUsd,
          priorCostBudgetHit: p.costBudgetHit,
          priorSkillHistory: p.skillHistory,
        };
      },
      outputMapper: (sf) => {
        const s = sf as Record<string, unknown>;
        return {
          // LLM result the outer Route / tool-calls / final read.
          llmLatestContent: s.llmLatestContent,
          llmLatestToolCalls: s.llmLatestToolCalls,
          thinkingBlocks: s.thinkingBlocks,
          // NOTE: dynamicToolSchemas is intentionally NOT bubbled out — it
          // is written by the Tools slot and read ONLY by callLLM, both
          // inside sf-llm-call. The outer Route reads llmLatestToolCalls
          // (which IS bubbled above), not the schemas.
          // Accumulators bubbled back for the next iteration's inputMapper.
          totalInputTokens: s.totalInputTokens,
          totalOutputTokens: s.totalOutputTokens,
          cumTokensInput: s.cumTokensInput,
          cumTokensOutput: s.cumTokensOutput,
          cumEstimatedUsd: s.cumEstimatedUsd,
          costBudgetHit: s.costBudgetHit,
          skillHistory: s.skillHistory,
          // Advanced skill-graph cursor bubbled back for the next iteration
          // (the inner injection engine wrote it under nextSkillCursor).
          currentSkillId: s.nextSkillCursor,
        };
      },
      // llmLatestToolCalls / thinkingBlocks / skillHistory are arrays —
      // REPLACE (not concat) so each turn overwrites the prior value.
      arrayMerge: ArrayMergeMode.Replace,
    })
    .addDeciderFunction('Route', deps.routeDecider as never, SUBFLOW_IDS.ROUTE, 'ReAct routing')
    .addPausableFunctionBranch(
      'tool-calls',
      'ToolCalls',
      deps.toolCallsHandler as never,
      'Tool execution (pausable via pauseHere)',
      // Branch-sourced loop: tool-calls loops back to the LLM-call subflow so
      // every iteration re-runs the full context-engineering + call against the
      // freshest outer state. Sourced from the BRANCH (not the decider) so the
      // chart reads honestly — `ToolCalls → LLM` loops, `Final` terminates.
      // Survives pause/resume (human-in-the-loop tool approval): the engine
      // resolves the subflow loop target on resume — footprintjs
      // FlowChartExecutor.resume + test/lib/pause/resume-branch-loop-subflow.
      { loopTo: SUBFLOW_IDS.LLM_CALL },
    )
    .addSubFlowChartBranch(SUBFLOW_IDS.FINAL, finalBranchChart, 'Final', {
      inputMapper: (parent) => {
        const { finalContent: _f, newMessages: _nm, ...rest } = parent;
        void _f;
        void _nm;
        return rest;
      },
      outputMapper: (sf) => ({
        finalContent: sf.finalContent as string,
      }),
      // `final` is a terminal LEAF under the branch-sourced loop; propagateBreak
      // is kept for the terminal onBreak signal (observability), not loop control.
      propagateBreak: true,
    })
    .setDefault(SUBFLOW_IDS.FINAL)
    .end();
  // The ReAct loop is now sourced from the `tool-calls` branch (the
  // `{ loopTo }` above), not the decider — so `Final` is a plain terminal leaf
  // and the chart draws `ToolCalls → LLM` for the loop edge.

  return builder.build();
}
