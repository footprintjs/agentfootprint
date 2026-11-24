import {
  memoryInjectionKey,
  memoryRecallOutcomesKey,
  retrievalEvidenceKey,
} from '../../memory/define.types.js';
import type { AgentChartDeps } from './buildAgentChart.js';
import { integrityRailInto } from './integrityFindings.js';
import { llmCallReadsInto } from './llmCallReads.js';

type TurnInputDeps = Pick<
  AgentChartDeps,
  | 'memories'
  | 'evidenceRecheckStage'
  | 'negativeRecheckStage'
  | 'hasSteps'
  | 'engagementPlan'
  | 'hasOntology'
  | 'sourceNotConsulted'
  | 'hasEscalation'
>;

/** The outer state handed to the grouped LLM turn, with writable working keys aliased for its seed. */
export function dynamicTurnInput(p: Readonly<Record<string, unknown>>, deps: TurnInputDeps) {
  // Per-memory injection content the slots consume inside.
  const memoryKeys: Record<string, unknown> = {};
  for (const m of deps.memories) {
    const key = memoryInjectionKey(m.id);
    memoryKeys[key] = p[key];
    const evidence = retrievalEvidenceKey(m.id);
    if (p[evidence] !== undefined) memoryKeys[evidence] = p[evidence];
    const outcomes = memoryRecallOutcomesKey(m.id);
    if (p[outcomes] !== undefined) memoryKeys[outcomes] = p[outcomes];
  }
  return {
    // Read-only working inputs (stages read, never write these).
    userMessage: p.userMessage,
    ...((deps.evidenceRecheckStage !== undefined || deps.negativeRecheckStage !== undefined) &&
      p.evidenceRecovery !== undefined && {
        evidenceRecovery: p.evidenceRecovery,
        priorEvidenceRecoveryUsed: p.evidenceRecoveryUsed,
      }),
    iteration: p.iteration,
    maxIterations: p.maxIterations,
    runIdentity: p.runIdentity,
    // A composition member's run, crossed into sf-llm-call so the engine's
    // Gather stage checks skill visibility under the MEMBER's caller, not
    // under no identity at all. Value-conditional: the agent's own runs
    // cross no key.
    ...(p.memberRun !== undefined && { memberRun: p.memberRun }),
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
    // The mount kernel's engagement state (9.58.0) — a direct
    // cross-iteration read like the step pointer one block up.
    ...(deps.engagementPlan !== undefined &&
      p.mapEngagement !== undefined && { mapEngagement: p.mapEngagement }),
    // The integrity dedup seen-list (9.60.0) — crosses into
    // sf-llm-call so the tools slot's compose backstop files one
    // finding per defect per RUN, not per pass. Value-conditional.
    ...integrityRailInto(p),
    // The run records CallLLM reads inside this boundary, written outside
    // it: the window ledger, the findings ledger and the ticket receipt.
    ...llmCallReadsInto(p),
    // The declared ontology (9.106.0) — the same lesson: `callLLM`
    // composes the ontology piece from the run constant `ontology`,
    // which seed wrote on the OUTER scope, and `callLLM` lives INSIDE
    // this boundary. Gated on the arm AND value-conditional, so an
    // unarmed agent crosses no new key and reads none. Read-only
    // inside, so no outputMapper line is needed.
    ...(deps.hasOntology === true && p.ontology !== undefined && { ontology: p.ontology }),
    ...(deps.sourceNotConsulted === true &&
      p.userMessageFrom === 'composed' && {
        userMessageFrom: 'composed',
      }),
    ...(deps.sourceNotConsulted === true &&
      p.sourceConsultationInterrupted === true && {
        sourceConsultationInterrupted: true,
      }),
    // The classifier's rows (9.105.0) — in under the alias, because the
    // call-llm stage WRITES the key inside this boundary (the `history`
    // shape, not the read-only `findingsLedger` one). Value-conditional.
    ...(p.toolChoices !== undefined && { priorToolChoices: p.toolChoices }),
    ...(p.llmLatestReplay !== undefined && { priorLatestReplay: p.llmLatestReplay }),
    ...(p.requestReplay !== undefined && { priorRequestReplay: p.requestReplay }),
    ...(p.llmLatestStopReason !== undefined && {
      priorLatestStopReason: p.llmLatestStopReason,
    }),
    // The kernel's PER-PASS pick feed (9.59.0) — written by tool-calls
    // on the OUTER scope, read by the engine mapper INSIDE this
    // boundary. Same gate as the engagement state above.
    ...(deps.engagementPlan !== undefined && {
      acceptedSkillPicks: (p.acceptedSkillPicks as readonly string[] | undefined) ?? [],
    }),
    // The kernel's SERVED carrier (9.59.0) — outer key into
    // sf-llm-call, so the inner engine mapper one level down can read
    // it. Same gate as the engagement state above.
    ...(deps.engagementPlan !== undefined && {
      servedInjectionIds: (p.servedInjectionIds as readonly string[] | undefined) ?? [],
    }),
    // The escalation flip (9.19.0) — written by tool-calls on the
    // OUTER scope, read by callLLM INSIDE this boundary (`brainFor`'s
    // second argument). Gated on the policy being declared, so every
    // other agent's boundary args are the exact bytes they always
    // were; seed writes the key from turn start, so the value-spread
    // is stable within a run.
    ...(deps.hasEscalation === true &&
      p.skillEscalated !== undefined && { skillEscalated: p.skillEscalated }),
    // The out-of-budget wrap-up (9.56.0) — written by the WrapUp branch
    // on the OUTER scope, read by callLLM INSIDE this boundary, which is
    // where the request is assembled and therefore where the tools come
    // off. Value-conditional: the key exists only on the one turn that
    // ran out of budget, so every other boundary's args are the exact
    // bytes they always were.
    ...(p.wrapUpAsked === true && { wrapUpAsked: true }),
    // The tools off after the evidence revision (an enforcing answer
    // validation) — the same trip: written by the EvidenceRecheck branch
    // on the OUTER scope, read by callLLM in here. Value-conditional, so
    // every other boundary's args are the exact bytes they always were.
    ...(p.toolsOffAfterRevision === true && { toolsOffAfterRevision: true }),
    // `.configure()` results, resolved + committed by seed on the OUTER
    // chart. callLLM and the System Prompt slot both live in here, so
    // the values have to cross the boundary. Read-only inside (nothing
    // in the turn re-decides them), and the keys are omitted entirely
    // for an agent without `.configure()`.
    ...(p.resolvedModel !== undefined && { resolvedModel: p.resolvedModel }),
    ...(p.resolvedInstructions !== undefined && {
      resolvedInstructions: p.resolvedInstructions,
    }),
    ...(deps.memories.length > 0 && { turnNumber: p.turnNumber }),
    ...memoryKeys,
    // Cross-iteration accumulators under prior* aliases — frozen
    // here, copied to writable working keys by dynamicTurnSeed.
    // `history` joined them in 7.21: the Deliver stage writes the
    // window, so it can no longer arrive under its own name.
    priorHistory: p.history,
    priorDeliveredMessageKeys: p.deliveredMessageKeys,
    priorTotalInputTokens: p.totalInputTokens,
    priorTotalOutputTokens: p.totalOutputTokens,
    ...(p.totalCacheReadTokens !== undefined && {
      priorTotalCacheReadTokens: p.totalCacheReadTokens,
    }),
    priorCumTokensInput: p.cumTokensInput,
    priorCumTokensOutput: p.cumTokensOutput,
    priorCumEstimatedUsd: p.cumEstimatedUsd,
    priorCostBudgetHit: p.costBudgetHit,
    priorSkillHistory: p.skillHistory,
  };
}
