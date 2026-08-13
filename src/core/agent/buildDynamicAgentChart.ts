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
import { memoryInjectionKey, retrievalEvidenceKey } from '../../memory/define.types.js';
import { unwrapMemoryFlowChart } from '../../memory/define.js';
import { mountMemoryRead, mountMemoryWrite } from '../../memory/wire/mountMemoryPipeline.js';
import { withMemoryRecall } from './memoryRecallInjections.js';
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
    priorHistory?: readonly LLMMessage[];
    priorDeliveredMessageKeys?: readonly string[];
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

  // The WINDOW, as a writable working key (7.21). It used to arrive as the
  // read-only `history` input, which was fine while nothing inside the
  // subflow changed it — the Deliver stage does. Seeding it here from
  // `priorHistory` (and bubbling it out at the boundary) is what makes the
  // one-past law hold in the grouped shape too: what this iteration sends is
  // what the next iteration's window stage sees. The delivery ledger takes
  // the same trip so a delivered message is not re-delivered next turn.
  scope.history = args.priorHistory ?? [];
  scope.deliveredMessageKeys = args.priorDeliveredMessageKeys ?? [];

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
  // Memory ids whose recall must be bridged into the slot composers (see
  // memoryRecallInjections). Empty → withMemoryRecall is a no-op.
  // Carries the flavor too (8.8.0): a corpus retrieval composes as
  // `source: 'rag'`, conversation recall as `source: 'memory'`.
  const memoryIds = deps.memories.map((m) => ({
    id: m.id,
    ...(m.flavor !== undefined && { flavor: m.flavor }),
  }));
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
        ...(m.corpus !== undefined && { identityOverride: m.corpus }),
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
  }).addSubFlowChartNext(
    SUBFLOW_IDS.INJECTION_ENGINE,
    deps.injectionEngineSubflow,
    'Injection Engine',
    {
      // NOTE: `history` here is the writable working key `dynamicTurnSeed`
      // sets from `priorHistory` — not the frozen boundary input. See the
      // Deliver mount below for why that indirection exists.
      inputMapper: (parent) => ({
        iteration: parent.iteration as number | undefined,
        userMessage: parent.userMessage as string | undefined,
        history: parent.history as readonly LLMMessage[] | undefined,
        lastToolResult: parent.lastToolResult as { toolName: string; result: string } | undefined,
        // The WHOLE batch, in call order (9.16.0) — crossed into sf-llm-call by
        // the outer boundary below, same as lastToolResult.
        toolResults: parent.toolResults as
          | ReadonlyArray<{ toolName: string; result: string; toolCallId: string }>
          | undefined,
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
        // The `read_skill` pick the gate accepted last iteration — the model's own
        // move through the graph (one-shot; the tool-calls stage rewrites it).
        pendingSkillPick: parent.pendingSkillPick as string | undefined,
        // Relevance entry ranking (from an entry scorer) — read by defineRelevanceHint.
        entryScores: parent.entryScores as
          | ReadonlyArray<{ id: string; score: number; relevance: number }>
          | undefined,
        entryScorer: parent.entryScorer as string | undefined,
        // The turn-start verdict (SG-C) — crossed into sf-llm-call by the outer
        // boundary below; the resolver consumes it on iteration 1.
        turnRoute: parent.turnRoute as
          | import('../../lib/injection-engine/routingPolicy.js').TurnRoute
          | undefined,
        // The step pointer as of the previous iteration (9.18.0) — the
        // sf-llm-call boundary's readonly input, for the Evaluate re-key.
        ...(deps.hasSteps === true && { stepPointer: parent.stepPointer }),
        // The typed tool-effects carriers (9.19.0) — value-conditional (the
        // `resolvedModel` precedent): present only after a tool granted one,
        // crossed into sf-llm-call by the outer boundary below.
        ...(parent.pendingToolTransition !== undefined && {
          pendingToolTransition: parent.pendingToolTransition,
        }),
        ...(parent.instructionLeases !== undefined && {
          instructionLeases: parent.instructionLeases,
        }),
      }),
      outputMapper: (sf) => ({
        activeInjections: sf.activeInjections,
        activeByslot: sf.activeByslot,
        // Advanced cursor — bubbled up under its own key (sf-llm-call's
        // `currentSkillId` is a readonly input here), then mapped onto the
        // ReAct parent's mutable currentSkillId by the outer outputMapper.
        nextSkillCursor: sf.nextSkillCursor,
        // The re-keyed step pointer (9.18.0) — same alias discipline as the
        // cursor one line up, same round trip: out under its own key, mapped
        // onto the ReAct parent's `stepPointer` by the outer outputMapper.
        // A top-level ARRAY on purpose (Replace sets it wholesale; a bare
        // object would shallow-merge — see StepPointerCarrier).
        ...(deps.hasSteps === true && { nextStepPointer: sf.nextStepPointer }),
        // The lease tenure sweep's survivors (9.19.0) — first hop of the
        // same round trip (the outer boundary maps them onto the ReAct
        // parent's `instructionLeases`). The sweep makes lease death
        // PERMANENT: a cyclic graph must not resurrect a dead lease when
        // the cursor re-enters the skill that granted it. Value-conditional
        // — never written before a first grant.
        ...(sf.nextInstructionLeases !== undefined && {
          nextInstructionLeases: sf.nextInstructionLeases,
        }),
      }),
      arrayMerge: ArrayMergeMode.Replace,
    },
  );

  // ── Messages-slot delivery — conditional mount (7.21) ───────────
  // Same placement as the flat chart (after the engine, before anything reads
  // the window) but it forced a structural change here: until now `history`
  // crossed the sf-llm-call boundary as a READ-ONLY input, and a stage inside
  // could not write it (`ScopeFacade.setValue` throws on an inputMapper key).
  // Delivery has to write it — a delivered message that lived only inside the
  // subflow would be discarded at the boundary and the next iteration would
  // send a window the recording never described. So `history` now takes the
  // same `prior*` round-trip the token accumulators take: in as
  // `priorHistory`, copied to a writable `history` by `dynamicTurnSeed`,
  // bubbled back out below.
  if (deps.deliverStage) {
    inner = inner.addFunction(
      'Deliver',
      deps.deliverStage as never,
      STAGE_IDS.DELIVER,
      'Deliver messages-slot injections into the window (role-checked, sequence-checked)',
    );
  }

  inner = inner
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
        // `.configure()`'s per-run system prompt, carried into sf-llm-call by
        // the boundary mapper below. Spread in only when one was resolved.
        ...(parent.resolvedInstructions !== undefined && {
          instructions: parent.resolvedInstructions as string,
        }),
        activeInjections: withMemoryRecall(
          parent.activeInjections as readonly ActiveInjection[] | undefined,
          parent,
          memoryIds,
        ),
      }),
      outputMapper: (sf) => ({ systemPromptInjections: sf.systemPromptInjections }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    .addSubFlowChartBranch(SUBFLOW_IDS.MESSAGES, deps.messagesSubflow, 'Messages', {
      inputMapper: (parent) => ({
        messages: parent.history as readonly LLMMessage[] | undefined,
        iteration: parent.iteration as number | undefined,
        activeInjections: withMemoryRecall(
          parent.activeInjections as readonly ActiveInjection[] | undefined,
          parent,
          memoryIds,
        ),
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
        // The skill-graph cursor, for the per-iteration `read_skill` offer (8.5.0).
        // Inside sf-llm-call the advanced cursor lands under `nextSkillCursor` (the
        // boundary's `currentSkillId` is a readonly INPUT here and still holds the
        // PREVIOUS iteration's value, which would offer a stale menu). The Injection
        // Engine mounts before this branch, so `nextSkillCursor` is already written.
        currentSkillId: (parent.nextSkillCursor ?? parent.currentSkillId) as string | undefined,
        // The turn-start verdict (SG-C) — the Compose stage leads read_skill's
        // description with the menu while it is outstanding.
        turnRoute: parent.turnRoute as
          | import('../../lib/injection-engine/routingPolicy.js').TurnRoute
          | undefined,
        // The step pointer (9.18.0) — the exact cursor pattern three lines
        // up: the FRESH value lives under `nextStepPointer` (the engine
        // wrote it this iteration; always a defined carrier when steps are
        // on), the boundary's `stepPointer` is the previous iteration's
        // readonly input. Threaded like this so the offer narrows on the
        // very iteration a tenure begins — not one late.
        ...(deps.hasSteps === true && {
          stepPointer: parent.nextStepPointer ?? parent.stepPointer,
        }),
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
        // The window as it will be sent — a messages marker's index is a
        // position in THAT array. See buildAgentChart's mount for the why.
        history: (parent.history as readonly LLMMessage[] | undefined) ?? [],
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
      // The retrieval record, lifted into ROOT state so a backward slice
      // can reach the passage instead of stopping at this mount.
      evidenceKey: retrievalEvidenceKey(m.id),
      readSubflowId: `sf-memory-read-${m.id}`,
      // A corpus reads under its OWN namespace, not the run's identity.
      ...(m.corpus !== undefined && { identityOverride: m.corpus }),
    });
  }

  // The turn-start slot — once per turn on the OUTER scope, before the
  // sf-llm-call loop (its loop target). ONE stage, two possible occupants,
  // same id (recorded structures stay stable): RouteTurn is the SG-C cascade;
  // PickEntry the 9.x relevance router, byte-identical without the new options.
  if (deps.routeTurnStage) {
    builder = builder.addFunction(
      'RouteTurn',
      deps.routeTurnStage as never,
      STAGE_IDS.PICK_ENTRY,
      'Route the turn start: declared rules, then the scorer, else offer a menu (cascade)',
    );
  } else if (deps.pickEntryStage) {
    builder = builder.addFunction(
      'PickEntry',
      deps.pickEntryStage as never,
      STAGE_IDS.PICK_ENTRY,
      'Pick the starting skill by relevance to the message (entryByRelevance)',
    );
  }

  // Window strategy — the OUTER chart, immediately before sf-llm-call, and it
  // becomes the loop target below. It cannot live inside sf-llm-call: the
  // window crosses that boundary as a read-only inputMapper arg and is not in
  // the outputMapper, so a change written in there would be discarded every
  // iteration. Out here it edits the window the next turn is seeded from.
  if (deps.windowStage) {
    builder = builder.addFunction(
      'Compact',
      deps.windowStage.run as never,
      STAGE_IDS.COMPACT,
      `Apply the '${deps.windowStage.strategyName}' window strategy to the live window`,
    );
  }
  const loopTarget: string = deps.windowStage ? STAGE_IDS.COMPACT : SUBFLOW_IDS.LLM_CALL;

  let decider = builder
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
          maxIterations: p.maxIterations,
          runIdentity: p.runIdentity,
          cachingDisabled: p.cachingDisabled,
          recentHitRate: p.recentHitRate,
          activatedInjectionIds: p.activatedInjectionIds,
          lastToolResult: p.lastToolResult,
          // The iteration's whole tool batch (9.16.0) — same direct
          // cross-iteration read as lastToolResult, of which it is the plural.
          toolResults: p.toolResults,
          // Skill-graph cursor carried into sf-llm-call (like activatedInjectionIds
          // / lastToolResult — a direct cross-iteration read, not a prior* alias).
          currentSkillId: p.currentSkillId,
          // The model's accepted `read_skill` pick — written by tool-calls on the
          // OUTER chart, read by the injection engine inside this boundary.
          pendingSkillPick: p.pendingSkillPick,
          // Relevance entry ranking — carried in so defineRelevanceHint can read it.
          entryScores: p.entryScores,
          entryScorer: p.entryScorer,
          // The turn-start verdict (SG-C) — written once by RouteTurn on the
          // OUTER scope, read inside by the engine mapper and the tools slot.
          turnRoute: p.turnRoute,
          // The step pointer (9.18.0) — a direct cross-iteration read, like
          // currentSkillId one block up: the outer key holds the value the
          // LAST iteration's boundary bubbled out (plus tool-calls' moves).
          ...(deps.hasSteps === true && { stepPointer: p.stepPointer }),
          // The typed tool-effects carriers (9.19.0) — written by tool-calls
          // on the OUTER scope, read inside by the engine mapper. Value-
          // conditional: the keys exist only after a tool granted one.
          ...(p.pendingToolTransition !== undefined && {
            pendingToolTransition: p.pendingToolTransition,
          }),
          ...(p.instructionLeases !== undefined && {
            instructionLeases: p.instructionLeases,
          }),
          // The escalation flip (9.19.0) — written by tool-calls on the
          // OUTER scope, read by callLLM INSIDE this boundary (`brainFor`'s
          // second argument). Gated on the policy being declared, so every
          // other agent's boundary args are the exact bytes they always
          // were; seed writes the key from turn start, so the value-spread
          // is stable within a run.
          ...(deps.hasEscalation === true &&
            p.skillEscalated !== undefined && { skillEscalated: p.skillEscalated }),
          // `.configure()` results, resolved + committed by seed on the OUTER
          // chart. callLLM and the System Prompt slot both live in here, so
          // the values have to cross the boundary. Read-only inside (nothing
          // in the turn re-decides them), and the keys are omitted entirely
          // for an agent without `.configure()`.
          ...(p.resolvedModel !== undefined && { resolvedModel: p.resolvedModel }),
          ...(p.resolvedInstructions !== undefined && {
            resolvedInstructions: p.resolvedInstructions,
          }),
          ...memoryKeys,
          // Cross-iteration accumulators under prior* aliases — frozen
          // here, copied to writable working keys by dynamicTurnSeed.
          // `history` joined them in 7.21: the Deliver stage writes the
          // window, so it can no longer arrive under its own name.
          priorHistory: p.history,
          priorDeliveredMessageKeys: p.deliveredMessageKeys,
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
          // The window this turn actually sent, back to the outer scope — so
          // the next iteration's window stage and the ToolCalls stage extend
          // the SAME past the model was given, not the one before delivery.
          // `arrayMerge: Replace` below is what makes this an overwrite
          // instead of a doubling concat.
          history: s.history,
          deliveredMessageKeys: s.deliveredMessageKeys,
          // The delivery record travels with them. It is the committed answer
          // to "why is my declaration not on the wire?", and its own docs send
          // the reader to `snapshot.sharedState` — which is the OUTER scope. A
          // record that only exists inside the subflow would answer the
          // question everywhere except where it tells you to look.
          messagesDelivery: s.messagesDelivery,
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
          // The re-keyed step pointer (9.18.0), back onto the outer key the
          // tool-calls stage advances — the cursor's round trip, one line up.
          // Top-level ARRAY + `arrayMerge: Replace` = set wholesale.
          ...(deps.hasSteps === true && { stepPointer: s.nextStepPointer }),
          // The lease tenure sweep's survivors (9.19.0) — second hop, onto
          // the outer key the tool-calls stage appends to. Permanent lease
          // death (no cyclic resurrection); value-conditional, so agents
          // that never saw a grant keep byte-identical mapper output.
          ...(s.nextInstructionLeases !== undefined && {
            instructionLeases: s.nextInstructionLeases,
          }),
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
      { loopTo: loopTarget },
    );

  // ── The schema re-ask — conditional mount (7.26) ────────────────
  // Byte-twin of the flat chart's mount, loop target and all: the second
  // looping branch, going back to the same place the tool branch does, so a
  // re-ask is one more ordinary turn through sf-llm-call. Absent unless the
  // agent asked for retries.
  if (deps.outputRetryStage) {
    decider = decider.addFunctionBranch(
      STAGE_IDS.OUTPUT_RETRY,
      'SchemaRetry',
      deps.outputRetryStage as never,
      'Answer failed the output schema — put the correction back and ask again',
      { loopTo: loopTarget },
    );
  }

  // ── The unfinished-steps nudge — conditional mount (9.18.0) ─────────
  // Byte-twin of the flat chart's mount: same loop target, same
  // "one more ordinary turn" mechanism, absent without a stepped skill.
  if (deps.stepNudgeStage) {
    decider = decider.addFunctionBranch(
      STAGE_IDS.STEP_NUDGE,
      'StepNudge',
      deps.stepNudgeStage as never,
      'Answer left declared steps unrun — one teaching nudge goes back (once per turn)',
      { loopTo: loopTarget },
    );
  }

  const chart = decider
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

  return chart.build();
}
