import type { AgentChartDeps } from '../buildAgentChart.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import {
  EMPTY_ACTIVE_BY_SLOT,
  type ActiveBySlot,
} from '../../../injection-engine/buildInjectionEngineSubflow.js';
import { memberRunArg } from '../../memberRun.js';

/** Whole boundary mappers, owned by the grouped chart facade. */
export function groupedEngineBoundary(deps: AgentChartDeps) {
  return {
    input: (parent: Record<string, unknown>) => ({
      iteration: parent.iteration as number | undefined,
      // The turn's action budget (9.57.0) — the same line the flat chart
      // and the cache mount carry, so `ctx` is one shape in both charts.
      maxIterations: (parent.maxIterations as number | undefined) ?? deps.maxIterations,
      userMessage: parent.userMessage as string | undefined,
      history: parent.history as readonly LLMMessage[] | undefined,
      lastToolResult: parent.lastToolResult as { toolName: string; result: string } | undefined,
      // The WHOLE batch, in call order (9.16.0) — crossed into sf-llm-call by
      // the outer boundary below, same as lastToolResult.
      toolResults: parent.toolResults as
        | ReadonlyArray<{ toolName: string; result: string; toolCallId: string }>
        | undefined,
      activatedInjectionIds: (parent.activatedInjectionIds as readonly string[] | undefined) ?? [],
      // Last turn's per-slot active set for the engine's Delta stage. In the
      // grouped chart the sf-llm-call scope re-seeds each turn, so this is
      // not yet carried across turns — Delta degrades to "all added" here
      // (the flat/default chart carries it via the persistent parent scope).
      priorActiveByslot: (parent.activeByslot as ActiveBySlot | undefined) ?? EMPTY_ACTIVE_BY_SLOT,
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
        | import('../../../injection-engine/routingPolicy.js').TurnRoute
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
      // The mount kernel's engagement state (9.58.0) — the sf-llm-call
      // boundary's readonly input, for the Evaluate advance (the
      // stepPointer discipline verbatim).
      ...(deps.engagementPlan !== undefined &&
        parent.mapEngagement !== undefined && {
          mapEngagement: parent.mapEngagement,
        }),
      // The kernel's PER-PASS pick feed (9.59.0) — every read_skill pick the
      // gate accepted last iteration. Threaded beside the engagement state and
      // under the same gate, so an agent without `.maps()` is unchanged.
      ...(deps.engagementPlan !== undefined && {
        acceptedSkillPicks: (parent.acceptedSkillPicks as readonly string[] | undefined) ?? [],
      }),
      // The kernel's SERVED carrier (9.59.0) — what actually reached the
      // wire last pass, feeding the idle test's first clause. Its own key,
      // because the Delta round-trip is empty in the grouped chart.
      ...(deps.engagementPlan !== undefined && {
        servedInjectionIds: (parent.servedInjectionIds as readonly string[] | undefined) ?? [],
      }),
      // A composition member's run, for the Gather stage's skill-visibility
      // check (`memberRun.ts`) — value-conditional: the agent's own runs
      // cross no key.
      ...memberRunArg(parent.memberRun),
    }),
    output: (sf: Record<string, unknown>) => ({
      activeInjections: sf.activeInjections,
      activeByslot: sf.activeByslot,
      // Advanced cursor — bubbled up under its own key (sf-llm-call's
      // `currentSkillId` is a readonly input here), then mapped onto the
      // ReAct parent's mutable currentSkillId by the outer outputMapper.
      nextSkillCursor: sf.nextSkillCursor,
      // The role-hidden skill ids this iteration (9.86.0) — first hop, onto
      // the sf-llm-call scope (the tools slot reads them there); the
      // boundary's own outputMapper carries them the rest of the way to the
      // ToolCalls stage. Resolved by the engine's Gather stage before it
      // decided anything. Value-conditional.
      ...(sf.hiddenSkillIds !== undefined && { hiddenSkillIds: sf.hiddenSkillIds }),
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
      // The advanced engagement state (9.58.0) — first hop of the same
      // alias round trip; the outer boundary maps it onto the ReAct
      // parent's `mapEngagement`. Value-conditional — never written
      // unless `.maps()` is mounted.
      ...(sf.nextMapEngagement !== undefined && {
        nextMapEngagement: sf.nextMapEngagement,
      }),
      // The kernel's SERVED carrier (9.59.0) — first hop.
      ...(sf.nextServedInjectionIds !== undefined && {
        nextServedInjectionIds: sf.nextServedInjectionIds,
      }),
      // The engagement axis's TOOL suppression (9.59.0) — first hop of the
      // same round trip. Value-conditional, like everything beside it.
      ...(sf.parkedToolNames !== undefined && {
        parkedToolNames: sf.parkedToolNames,
      }),
    }),
  };
}
