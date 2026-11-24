import { groupedFinalBranch } from './buildDynamicAgentChart/finalBranch.js';
import { groupedTurnBoundary } from './buildDynamicAgentChart/boundary.js';
import { groupedEngineBoundary } from './buildDynamicAgentChart/engineBoundary.js';
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
import type { LLMMessage } from '../../provider-contract/types.js';
import { STAGE_IDS, SUBFLOW_IDS, milestoneTagsFor } from '../../lib/conventions.js';
import type { ActiveInjection } from '../../injection-engine/types.js';
import { integrityRail, integrityRailInto } from './integrityFindings.js';
import { withMemoryRecall } from './memoryRecallInjections.js';
import { finalBranchInput, finalBranchOutput } from './stages/breakFinal.js';
import { buildCacheSubflow, cacheMountInput } from './buildCacheSubflow.js';
import { mountAgentMemoryReads } from './memoryReads.js';
import {
  timeClockArg,
  timeLimitsArg,
  timeWindowsArg,
  type AgentChartDeps,
} from './buildAgentChart.js';
import { mountInputsLayer, mountResultsLayer, RESULTS_LOOP_TARGET } from './honesty/mounts.js';
import type { AgentState } from './types.js';
import { dynamicTurnSeed } from './dynamicTurnSeed.js';

/**
 * Build the Dynamic-ReAct agent chart from the shared `AgentChartDeps`.
 */
export function buildDynamicAgentChart(deps: AgentChartDeps): FlowChart {
  const boundary = groupedTurnBoundary(deps);
  const engineBoundary = groupedEngineBoundary(deps);
  // Memory ids whose recall must be bridged into the slot composers (see
  // memoryRecallInjections). Empty → withMemoryRecall is a no-op.
  // Carries the flavor too (8.8.0): a corpus retrieval composes as
  // `source: 'rag'`, conversation recall as `source: 'memory'`.
  const memoryIds = deps.memories.map((m) => ({
    id: m.id,
    ...(m.flavor !== undefined && { flavor: m.flavor }),
  }));
  const finalBranchChart = groupedFinalBranch(deps);

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
        // NOTE: `history` here is the writable working key `dynamicTurnSeed`
        // sets from `priorHistory` — not the frozen boundary input. See the
        // Deliver mount below for why that indirection exists.
        inputMapper: engineBoundary.input,
        outputMapper: engineBoundary.output,
        arrayMerge: ArrayMergeMode.Replace,
      },
    )
    // Declared milestone (9.90.0): on the inner (drilled) log this mount is the
    // iteration boundary, exactly as `milestoneFor` classifies it.
    .tag(...milestoneTagsFor(SUBFLOW_IDS.INJECTION_ENGINE));

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
    //
    // Declared milestones (9.90.0): each slot mount carries `milestone:slot`
    // via `SubflowMountOptions.tags` (footprintjs 9.21.1), on its FIRST bundle
    // of the inner (drilled) log.
    .addSubFlowChartBranch(SUBFLOW_IDS.SYSTEM_PROMPT, deps.systemPromptSubflow, 'System Prompt', {
      tags: milestoneTagsFor(SUBFLOW_IDS.SYSTEM_PROMPT),
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
      tags: milestoneTagsFor(SUBFLOW_IDS.MESSAGES),
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
      tags: milestoneTagsFor(SUBFLOW_IDS.TOOLS),
      inputMapper: (parent) => ({
        iteration: parent.iteration as number | undefined,
        activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
        // The parked maps' tool names (9.59.0) — the tools slot holds these
        // out of the STATIC list, which is the only place a parked map's
        // tools can be reached on the default `scopeTools` posture.
        parkedToolNames: parent.parkedToolNames as readonly string[] | undefined,
        // Integrity findings already filed this run (9.60.0) — the dedup
        // seen-list, in under the alias (inputMapper keys are frozen inside
        // the subflow; the slot writes the fresh list under the base key).
        ...integrityRailInto(parent),
        // The reader's settled windows (step T6b) — the flat chart's line, read INSIDE
        // sf-llm-call off the boundary's `findingsLedger`. See `AgentChartDeps.timeWindows`.
        ...(deps.timeWindows === true && timeWindowsArg(parent.findingsLedger)),
        ...(deps.timeWindows === true && timeClockArg(parent.findingsLedger)),
        // The role-hidden skill ids the Injection Engine resolved THIS iteration
        // (owner: `buildInjectionEngineSubflow.ts` · `hiddenSkillIdsOf`) — the
        // menu is composed from the same answer the activation was refused by.
        // Value-conditional: an agent without per-role visibility crosses no key.
        ...(parent.hiddenSkillIds !== undefined && {
          hiddenSkillIds: parent.hiddenSkillIds as readonly string[],
        }),
        // The turn's result-check lines (step T8). See `AgentChartDeps.timeLimits`.
        ...(deps.timeLimits === true && timeLimitsArg(parent.findingsLedger)),
        // Tool choice by classifier (9.105.0) — the flat chart's three args,
        // read INSIDE sf-llm-call: `userMessage` and `wrapUpAsked` are the
        // boundary's own inputs, `toolChoices` is `dynamicTurnSeed`'s copy
        // of the boundary's `priorToolChoices`. See `AgentChartDeps.hasToolChoice`.
        ...(deps.hasToolChoice === true && {
          userMessage: parent.userMessage as string | undefined,
          ...(parent.toolChoices !== undefined && { priorToolChoices: parent.toolChoices }),
          ...(parent.wrapUpAsked === true && { wrapUpAsked: true }),
          ...(parent.toolsOffAfterRevision === true && { toolsOffAfterRevision: true }),
        }),
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
          | import('../../injection-engine/routingPolicy.js').TurnRoute
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
        ...integrityRail(sf),
        // The classifier's pick (9.105.0) — first hop, onto the sf-llm-call
        // working key the call-llm stage appends to; the boundary's own
        // outputMapper carries it the rest of the way. Value-conditional.
        ...(sf.toolChoices !== undefined && { toolChoices: sf.toolChoices }),
        // The time layer's late line (step T6b), onto the key `callLLM` appends last to the
        // request — under the reader's arm only (the slot writes it every composition then).
        ...(sf.timeLine !== undefined && { timeLine: sf.timeLine }),
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
    // The findings offer re-decorates every tool per call — see
    // buildAgentChart's mount. Closed over at build time.
    .addSubFlowChartNext(SUBFLOW_IDS.CACHE, buildCacheSubflow(), 'Cache', {
      inputMapper: (parent) => cacheMountInput(parent, deps),
      outputMapper: (sf) => ({ cacheMarkers: sf.cacheMarkers }),
      arrayMerge: ArrayMergeMode.Replace,
    })
    // CallLLM emits the per-iteration `iteration_start` marker itself (no
    // dedicated IterationStart stage — emitting is passive observability).
    .addFunction('CallLLM', deps.callLLM as never, STAGE_IDS.CALL_LLM, 'LLM invocation')
    // Declared milestone (9.90.0): the LLM turn, on the inner log.
    .tag(...milestoneTagsFor(STAGE_IDS.CALL_LLM));

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

  builder = mountAgentMemoryReads(builder, deps.memories);

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

  // ── The results layer — conditional mount at the LOOP HEAD (honesty layer 3).
  // The flat chart's twin, through the same helper: on the OUTER chart, before
  // the window strategy, and the loop target below. Absent → untouched.
  builder = mountResultsLayer(builder, deps.resultsLayer);

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
  // The results layer (honesty layer 3) heads the loop when armed: every
  // tool-calls loop enters it first, so it reads the batch just run before any
  // window strategy folds it away (`honesty/mounts.ts` · `mountResultsLayer`).
  const loopTarget: string =
    deps.resultsLayer !== undefined
      ? RESULTS_LOOP_TARGET
      : deps.windowStage
      ? STAGE_IDS.COMPACT
      : SUBFLOW_IDS.LLM_CALL;

  const withLlmCall = builder
    .addSubFlowChartNext(SUBFLOW_IDS.LLM_CALL, llmCallSubflow, 'LLM', {
      inputMapper: boundary.input,
      outputMapper: boundary.output,
      // llmLatestToolCalls / thinkingBlocks / skillHistory are arrays —
      // REPLACE (not concat) so each turn overwrites the prior value.
      arrayMerge: ArrayMergeMode.Replace,
      // A break inside the turn ends the RUN, as it does in the flat chart,
      // where `callLLM` sits on the run's own traversal. The one stage in here
      // that breaks is the reliability loop's fail-fast exit; without this the
      // break stopped only the turn and the outer loop went on to `Final`.
      propagateBreak: true,
    })
    // Declared milestones (9.90.0): the mount is the iteration boundary on the
    // OUTER log; the decider and its branches declare in their own `tags`.
    .tag(...milestoneTagsFor(SUBFLOW_IDS.LLM_CALL));
  // ── The inputs layer — conditional mount (honesty layer 2) ───────────
  // The flat chart's twin, through the same helper: OUTSIDE `sf-llm-call`, at
  // the same place — after the LLM call, before Route. Absent → untouched.
  let decider = mountInputsLayer(withLlmCall, deps.inputsLayer)
    .addDeciderFunction('Route', deps.routeDecider as never, SUBFLOW_IDS.ROUTE, 'ReAct routing', {
      tags: milestoneTagsFor(SUBFLOW_IDS.ROUTE),
    })
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
      { loopTo: loopTarget, tags: milestoneTagsFor('tool-calls') },
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
      { loopTo: loopTarget, tags: milestoneTagsFor(STAGE_IDS.OUTPUT_RETRY) },
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
      { loopTo: loopTarget, tags: milestoneTagsFor(STAGE_IDS.STEP_NUDGE) },
    );
  }

  // ── The evidence recheck — conditional mount (9.35.0) ───────────────
  // Byte-twin of the flat chart's mount: same loop target, same "one more
  // ordinary turn" mechanism, absent under `posture: 'assist'` and absent
  // entirely without the gate.
  if (deps.negativeRecheckStage) {
    decider = decider.addFunctionBranch(
      STAGE_IDS.NEGATIVE_RECHECK,
      'NegativeCitationCorrection',
      deps.negativeRecheckStage as never,
      'Correct a citation once with tools disabled',
      { loopTo: loopTarget, tags: milestoneTagsFor(STAGE_IDS.NEGATIVE_RECHECK) },
    );
  }

  if (deps.evidenceRecheckStage) {
    decider = decider.addFunctionBranch(
      STAGE_IDS.EVIDENCE_RECHECK,
      'EvidenceRecheck',
      deps.evidenceRecheckStage as never,
      'Answer stated values no tool result carried — naming them back for one revision',
      { loopTo: loopTarget, tags: milestoneTagsFor(STAGE_IDS.EVIDENCE_RECHECK) },
    );
  }

  // ── The out-of-budget wrap-up — conditional mount (9.56.0) ─────────
  // Byte-twin of the flat chart's mount: same loop target, same "one more
  // ordinary turn" mechanism, absent on an agent with no tool surface and on
  // one that set `wrapUpAtMaxIterations: false`.
  if (deps.wrapUpStage) {
    decider = decider.addFunctionBranch(
      STAGE_IDS.WRAP_UP,
      'WrapUp',
      deps.wrapUpStage as never,
      'Action budget exhausted — one last call with the tools withheld, for a real answer',
      { loopTo: loopTarget, tags: milestoneTagsFor(STAGE_IDS.WRAP_UP) },
    );
  }

  const chart = decider
    .addSubFlowChartBranch(SUBFLOW_IDS.FINAL, finalBranchChart, 'Final', {
      tags: milestoneTagsFor(SUBFLOW_IDS.FINAL),
      inputMapper: (parent) => finalBranchInput(parent, deps.hasAnswerValidation === true),
      outputMapper: (sf) => finalBranchOutput(sf, deps.hasAnswerValidation === true),
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
