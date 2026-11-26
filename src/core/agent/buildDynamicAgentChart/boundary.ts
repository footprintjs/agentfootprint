import { acceptedResponseFields } from '../assistantReplay.js';
import type { AgentChartDeps } from '../buildAgentChart.js';
import { integrityRail } from '../integrityFindings.js';
import { dynamicTurnInput } from '../dynamicTurnInput.js';
import { llmCallResponseFields } from '../llmCallReads.js';
import { retrievalFindingsOf } from '../honesty/retrievalRequests.js';
import { failFastRecordOf } from '../../../reliability/failFastRecord.js';
import { interventionRecordOf } from '../../providerIntervention.js';

/** Whole boundary mappers, owned by the grouped chart facade. */
export function groupedTurnBoundary(deps: AgentChartDeps) {
  return {
    input: (parent: Record<string, unknown>) => ({
      ...dynamicTurnInput(parent, deps),
      ...(Object.hasOwn(parent, 'providerIntervention') && {
        priorProviderIntervention: parent.providerIntervention,
      }),
    }),
    output: (sf: Record<string, unknown>, parent: Record<string, unknown>) => {
      const s = sf as Record<string, unknown>;
      return {
        ...retrievalFindingsOf(s, parent as Record<string, unknown>),
        // LLM result the outer Route / tool-calls / final read.
        llmLatestContent: s.llmLatestContent,
        llmLatestToolCalls: s.llmLatestToolCalls,
        ...(deps.hasFindingsLedger === true && { findingsRequest: s.findingsRequest }),
        ...(deps.sourceNotConsulted === true &&
          s.sourceConsultation !== undefined && {
            sourceConsultation: s.sourceConsultation,
          }),
        thinkingBlocks: s.thinkingBlocks,
        ...acceptedResponseFields(s),
        // Native candidates and prose cutoffs carry stop evidence. Ordinary
        // replies without earlier stop evidence leave the mapper byte-identical.
        ...llmCallResponseFields(s, deps.hasCitations === true),
        // The window this turn actually sent, back to the outer scope — so
        // the next iteration's window stage and the ToolCalls stage extend
        // the SAME past the model was given, not the one before delivery.
        // `arrayMerge: Replace` below is what makes this an overwrite
        // instead of a doubling concat.
        history: s.history,
        deliveredMessageKeys: s.deliveredMessageKeys,
        ...((deps.evidenceRecheckStage !== undefined || deps.negativeRecheckStage !== undefined) &&
          s.evidenceRecoveryUsed !== undefined && {
            evidenceRecoveryUsed: s.evidenceRecoveryUsed,
          }),
        // The delivery record travels with them. It is the committed answer
        // to "why is my declaration not on the wire?", and its own docs send
        // the reader to `snapshot.sharedState` — which is the OUTER scope. A
        // record that only exists inside the subflow would answer the
        // question everywhere except where it tells you to look.
        messagesDelivery: s.messagesDelivery,
        // The composed system prompt's records (9.35.0) — bubbled ONLY for
        // an agent with the evidence gate mounted. The outer Route decider
        // exempts values the APP supplied (base prompt, skill body, a
        // retrieved passage) from the check, and in this chart shape the
        // slot that produced them ran in here. Value-conditional, so every
        // other agent's boundary mapper is byte-identical to what it was.
        ...(deps.hasEvidenceGate === true && {
          systemPromptInjections: s.systemPromptInjections,
        }),
        // ── THE WIRE THE MODEL WAS HANDED, BUBBLED OUT (9.86.0) ────────
        // This comment used to say the opposite, and it was true until the
        // read_skill gate learned to answer a SELF-CALL by naming the tools
        // that were genuinely on that call's list (9.84.0). That gate — the
        // ToolCalls stage — runs OUT HERE, and `selfSkillTools` reads both
        // of these: `dynamicToolSchemas` for the wire, `activeInjections`
        // for the cursor's declaration. Inside the grouped chart they never
        // crossed, so the notice fell back to "the wire is unknown" and said
        // nothing about tools at all — silence that is honest and useless,
        // and different from what the same agent says under 'dynamic'.
        // Neither key is an input to this boundary (see the inputMapper), so
        // bubbling them feeds nothing back in; `arrayMerge: Replace` below
        // makes each an overwrite rather than a doubling concat.
        dynamicToolSchemas: s.dynamicToolSchemas,
        activeInjections: s.activeInjections,
        // THE RECEIPT (9.88.0), second hop. `callLLM` writes it INSIDE this
        // boundary, so under `'dynamic-grouped'` it lands in the turn's own
        // inner log and nowhere else; a reader scrubbing the OUTER axis
        // would find an iteration stop with no record of what that iteration
        // sent. Bubbling costs nothing and never doubles: the receipt is a
        // fresh object every call (the epoch is on it), so the net-change
        // filter cannot drop it and `arrayMerge: Replace` below makes it an
        // overwrite. Value-conditional, so a chart whose inner stage never
        // wrote one crosses no new key.
        ...(s.receipt !== undefined && { receipt: s.receipt }),
        // The role-hidden ids, second hop — the gate filters every set it
        // names through them before composing a refusal or a payload.
        ...(s.hiddenSkillIds !== undefined && { hiddenSkillIds: s.hiddenSkillIds }),
        // Accumulators bubbled back for the next iteration's inputMapper.
        totalInputTokens: s.totalInputTokens,
        totalOutputTokens: s.totalOutputTokens,
        // Cache reads (9.110.0), bubbled back only once reported.
        ...(s.totalCacheReadTokens !== undefined && {
          totalCacheReadTokens: s.totalCacheReadTokens,
        }),
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
        // The advanced engagement state (9.58.0) — second hop of the alias
        // round trip, onto the outer `mapEngagement` key. Value-conditional.
        ...(s.nextMapEngagement !== undefined && {
          mapEngagement: s.nextMapEngagement,
        }),
        // The integrity seen-list's second hop (9.60.0). Value-conditional.
        ...integrityRail(s),
        // Second hop, onto the outer key the next iteration reads.
        ...(s.nextServedInjectionIds !== undefined && {
          servedInjectionIds: s.nextServedInjectionIds,
        }),
        // Second hop, onto the outer key the tools slot reads.
        ...(s.parkedToolNames !== undefined && {
          parkedToolNames: s.parkedToolNames,
        }),
        // The classifier's rows (9.105.0), second hop — onto the outer key
        // the next iteration's boundary reads. Top-level ARRAY +
        // `arrayMerge: Replace` = set wholesale. Value-conditional.
        ...(s.toolChoices !== undefined && { toolChoices: s.toolChoices }),
        // THE FAIL-FAST RECORD, out with the break below. `callLLM`'s
        // reliability loop writes it in here and breaks; the run boundary
        // reads it from the OUTER scope to raise `ReliabilityFailFastError`.
        // Left inside, the run ended with `''` and no error. Present only
        // after a fail-fast, so every other turn crosses no new key.
        ...failFastRecordOf(s),
        ...interventionRecordOf(s),
      };
    },
  };
}
