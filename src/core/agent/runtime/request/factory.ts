import { type AgentRunValues } from '../../runValues.js';
import { type RunnerScopeValues } from '../../../runnerExecution.js';
import { findingsContextBytes } from '../../findings/context.js';
import { buildBrainFor } from '../../skillBrains.js';
import type { LLMToolSchema } from '../../../../provider-contract/types.js';
import { retainReplayRetirements } from '../../../runCheckpoint.js';
import { buildCallLLMStage } from '../../stages/callLLM.js';
import type { AgentConfiguration } from '../configuration/types.js';

/** Build-time declarations and live native ports for this one stage factory. */
export interface RequestEnvironment {
  readonly configuration: AgentConfiguration;
  readonly argumentSources: boolean;
  readonly governsOutput: boolean;
  readonly provider: AgentConfiguration['provider'];
  readonly model: string;
  readonly temperature: number | undefined;
  readonly maxTokens: number | undefined;
  readonly pricingTable: AgentConfiguration['pricingTable'];
  readonly costBudget: AgentConfiguration['costBudget'];
  readonly maxIterations: number;
  readonly cacheStrategy: AgentConfiguration['cacheStrategy'];
  readonly toolSchemasResolved: readonly LLMToolSchema[];
  readonly toolGrounding: NonNullable<Parameters<typeof buildCallLLMStage>[0]['toolGrounding']>;
  readonly toolWants: NonNullable<Parameters<typeof buildCallLLMStage>[0]['toolWants']>;
  readonly toolColumns: ReadonlyMap<string, unknown>;
  revisionWithholdsTools(): boolean;
}

/** Keep per-invocation stage creation inside the native component's existing memo. */
export function requestFactory(environment: RequestEnvironment) {
  return (run: RunnerScopeValues<AgentRunValues>) =>
    buildCallLLMStage({
      onReplayPrepared: (preparation) => {
        if (
          run.value.checkpointTracker !== undefined &&
          run.context.runId === run.value.checkpointTracker.runId
        )
          retainReplayRetirements(run.value.checkpointTracker, preparation);
      },
      ...((environment.configuration.typedNegativeClaimsConfig !== undefined ||
        (environment.configuration.evidenceGate !== undefined &&
          environment.configuration.evidenceGate.posture !== 'assist')) && {
        hasEvidenceRecovery: true,
      }),
      // The revision calls no tools under an enforcing answer validation: only
      // then does request assembly read `toolsOffAfterRevision`.
      ...(environment.revisionWithholdsTools() && { toolsOffAfterRevision: true as const }),
      // The findings ledger (9.101.0): the choice seam and `postValidate`
      // read peeled args / content under `findings`; the SERVING (step 3) —
      // the ledger piece after the recovery piece, the wire-only collapse of
      // judged results — rides `hasFindingsLedger` with its mode, the same
      // value seed records as the run constant `findingsServe`. One gate,
      // the `hasEvidenceRecovery` grammar: an unarmed agent hands the stage
      // exactly the deps it always did and reads no new key.
      ...(environment.configuration.findingsOptions !== undefined && {
        findings: true as const,
        hasFindingsLedger: true as const,
        findingsServe: environment.configuration.findingsOptions.serve ?? 'ledger-and-facts',
        findingsContextBytes: environment.configuration.findingsOptions.maxContextBytes,
        // The answer-turn ask (9.103.0): the same value seed records, so the
        // wire and the rebuild append it from one fact; absent on `'none'`.
        ...(environment.configuration.findingsOptions.answerAsk === 'quote-facts' && {
          findingsAnswerAsk: 'quote-facts' as const,
        }),
      }),
      // Declared sources (honesty layer 2): without the ledger, the choice
      // seam peels `_findings` where the served schema carries it (ruled
      // tools only) — value-conditional, the same grammar.
      ...(environment.argumentSources && { argumentSources: true as const }),
      ...((environment.configuration.answerValidationConfig !== undefined ||
        environment.governsOutput) && {
        suppressDraftTokens: true,
        withholdDraftContent: true,
      }),
      // Tool choice by classifier (9.105.0): the outcome row after the reply.
      ...(environment.configuration.toolChoiceOptions !== undefined && {
        toolChoice: true as const,
      }),
      // The declared ontology (9.106.0): the piece served from the run
      // constant on every call, under the one gate — an unarmed agent reads
      // no new key.
      ...(environment.configuration.ontology !== undefined && { ontology: true as const }),
      // The time layer's served line (step T6b): read wherever the Tools mount
      // composes it — under `.time()` (G14: the control window needs no inputs
      // layer). Step T8: the same line carries the turn's time limits.
      ...(environment.configuration.timeOptions !== undefined && { timeLine: true as const }),
      // The receipt's salt (9.88.0) — read per call, like seed's own accessor.
      getRunId: () => run.context.runId,
      // …and its off switch. Value-conditional, so an agent on the default
      // hands `callLLM` exactly the dep bag it always did.
      ...(environment.configuration.recordReceiptValue === false && { recordReceipt: false }),
      // …and the window's evictions for `omittedForAttention` (9.93.0) — only
      // an agent with a window strategy has any, and only it hands the seam.
      ...(run.value.evictedTurnsHandle !== undefined && {
        evictedTurns: run.value.evictedTurnsHandle,
      }),
      // …and the receipt memo, so a run hashes each message once rather than
      // once per call (`core/agent/receipt/receiptDigests.ts`). Only where a
      // receipt is minted at all.
      ...(environment.configuration.recordReceiptValue !== false && {
        receiptDigests: run.value.receiptDigests,
      }),
      provider: environment.provider,
      model: environment.model,
      ...(environment.temperature !== undefined && { temperature: environment.temperature }),
      ...(environment.maxTokens !== undefined && { maxTokens: environment.maxTokens }),
      ...(environment.pricingTable !== undefined && { pricingTable: environment.pricingTable }),
      ...(environment.costBudget !== undefined && { costBudget: environment.costBudget }),
      maxIterations: environment.maxIterations,
      cacheStrategy: environment.cacheStrategy,
      ...(environment.configuration.cacheStrategyIsOverride && {
        cacheStrategyIsOverride: true as const,
      }),
      get toolSchemas() {
        return environment.toolSchemasResolved;
      },
      // The declared argument-ground edges (9.60.0) — value-conditional, so
      // an agent whose tools declare none runs the exact bytes it always did.
      ...(environment.toolGrounding.size > 0 && { toolGrounding: environment.toolGrounding }),
      // The staged-refs nudge (grounded numbers) — armed only when the dial
      // is ON and a registered tool declares `wants`; otherwise the stage
      // reads nothing new and every request keeps its exact bytes.
      ...(environment.configuration.evidenceGate?.nudge === true &&
        environment.toolWants.size > 0 && { toolWants: environment.toolWants }),
      // The external-ground door (9.72.0) — value-conditional for the same
      // reason: no provider, no key, byte-identical corpus assembly.
      ...(environment.configuration.externalGrounds !== undefined && {
        externalGrounds: environment.configuration.externalGrounds,
      }),
      // The write-seam advisory's arming (9.77.0) — this stage owns only the
      // "no armed call this response" not-applicable note; the check itself
      // runs where the result is. Value-conditional on BOTH halves, so an
      // agent that never asked for it reads no new key.
      ...(environment.configuration.noticeEmptyLookups &&
        environment.toolGrounding.size > 0 && { noticeEmptyLookups: true }),
      // The column-type contract's arming (9.78.0), same job and same
      // value-conditional law: this stage owns only the "no declaring tool
      // was called this response" not-applicable notes.
      ...(environment.configuration.checkColumnTypes !== 'off' &&
        environment.toolColumns.size > 0 && {
          columnDeclaringTools: new Set(environment.toolColumns.keys()),
        }),
      integrityLedger: run.value.integrityLedger,
      ...(environment.configuration.reliabilityConfig !== undefined && {
        reliability: environment.configuration.reliabilityConfig,
      }),
      ...(environment.configuration.outputSchemaParser !== undefined && {
        outputSchemaParser: environment.configuration.outputSchemaParser,
      }),
      // 7.26 — the synthetic tool, under `strategy: 'tool-forced'` only.
      ...(environment.configuration.outputEnforcement?.schemaTool !== undefined && {
        schemaTool: environment.configuration.outputEnforcement.schemaTool,
      }),
      // The native format candidate; auto selects it for the effective request.
      ...(environment.configuration.outputEnforcement?.outputFormat !== undefined && {
        outputFormat: environment.configuration.outputEnforcement.outputFormat,
        ...(environment.configuration.outputEnforcement.nativeOutputAuto === true && {
          nativeOutputAuto: true as const,
        }),
      }),
      ...(environment.configuration.thinkingBudget !== undefined && {
        thinkingBudget: environment.configuration.thinkingBudget,
      }),
      // Only a configured agent reads `scope.resolvedModel` — see the dep's
      // JSDoc for why this is a build-time flag and not a runtime fallback.
      ...(environment.configuration.runConfigFn && { runConfigured: true }),
      // Opt-in system-prompt capture (9.50.0) — value-conditional, so an agent
      // that never asked keeps byte-identical llm_start events.
      ...(environment.configuration.recordSystemPromptValue && { recordSystemPrompt: true }),
      // "The cursor picks the brain" (9.19.0) — wired only when a per-skill
      // brain or an escalation exists, so every other agent's stage reads no
      // new scope key and resolves on the exact line it always did. The
      // per-brain cache strategies resolve HERE, once, where the agent's own
      // strategy (override included) is known: a brain on the agent's own
      // provider keeps it, any other provider gets the strategy its declared
      // `promptCaching` selects (markers are provider-aware — the one
      // genuinely risky seam, resolved statically).
      ...(environment.configuration.skillBrains !== undefined &&
        (environment.configuration.skillBrains.bySkill.size > 0 ||
          environment.configuration.skillBrains.escalation !== undefined) && {
          brainFor: buildBrainFor({
            brains: environment.configuration.skillBrains,
            agentProvider: environment.provider,
            agentCacheStrategy: environment.cacheStrategy,
            agentModel: environment.model,
            ...(environment.configuration.cacheStrategyIsOverride && {
              agentCacheStrategyIsOverride: true as const,
            }),
          }),
        }),
    });
}
