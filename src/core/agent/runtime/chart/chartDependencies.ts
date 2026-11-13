import type { NativeMappingBinding } from 'footprintjs';
import { componentEvidence } from '../../componentObservers.js';
import { updateSkillHistory as updateSkillHistoryStage } from '../../../../cache/CacheGateDecider.js';
import type { LLMToolSchema } from '../../../../provider-contract/types.js';
import { buildDeliverStage } from '../../stages/deliver.js';
import { providerTargets } from '../../providerTargets.js';
import { buildStepNudgeStage } from '../../stages/stepNudge.js';
import { buildEvidenceRecheckStage } from '../../stages/evidenceRecheck.js';
import { toolWantsOf } from '../../stagedRefs.js';
import { wrapUpStage } from '../../stages/wrapUp.js';
import { makePickEntryStage } from '../../stages/pickEntry.js';
import { makeRouteTurnStage } from '../../stages/routeTurn.js';
import { buildOutputRetryStage } from '../../stages/outputRetry.js';
import { negativeRecheckStage } from '../../negativeClaims/recheck.js';
import { buildToolResolver } from '../../stages/toolResolver.js';
import { answerFoldReads } from '../../honesty/mounts.js';
import { carriesArgumentView } from '../../../toolShownArgs.js';
import { buildAgentChart } from '../../buildAgentChart.js';
import { buildToolRegistry } from '../../buildToolRegistry.js';
import type { AgentContext } from '../contracts.js';

import type { StepPlanFor } from '../../../../injection-engine/skillSteps.js';

type ChartArguments = Parameters<typeof buildAgentChart>[0];

export interface ChartDependenciesEnvironment {
  readonly systemPromptCachePolicy: ChartArguments['systemPromptCachePolicy'];
  readonly maxIterations: number;
  readonly seed: ChartArguments['seed'];
  readonly callLLM: ChartArguments['callLLM'];
  readonly terminalRouteDecider: ChartArguments['routeDecider'];
  readonly toolCallsHandler: ChartArguments['toolCallsHandler'];
  readonly stepPlanFor: StepPlanFor | undefined;
  readonly toolWants: ReturnType<typeof toolWantsOf>;
  readonly toolSchemasResolved: readonly LLMToolSchema[];
  readonly inputsArmed: boolean;
  readonly resolveForLayer: (scope: object) => ReturnType<typeof buildToolResolver>;
  readonly argumentSources: boolean;
  readonly registryByName: ReturnType<typeof buildToolRegistry>['registryByName'];
  readonly resultsArmed: boolean;
  readonly canCallTools: boolean;
  readonly displayNameOfFor: ChartArguments['displayNameOfFor'];
  readonly limitsAsData: boolean;
  readonly governsOutput: boolean;
  readonly hasWrapUp: boolean;
  readonly injectionEngineSubflow: ChartArguments['injectionEngineSubflow'];
  readonly pickEntryStage: ReturnType<typeof makePickEntryStage> | undefined;
  readonly routeTurnStage: ReturnType<typeof makeRouteTurnStage> | undefined;
  readonly systemPromptSubflow: ChartArguments['systemPromptSubflow'];
  readonly messagesSubflow: ChartArguments['messagesSubflow'];
  readonly toolsSubflow: ChartArguments['toolsSubflow'];
  readonly thinkingSubflow: ChartArguments['thinkingSubflow'];
  readonly windowStage: ChartArguments['windowStage'];
}

export function chartDependencies(
  this: Pick<AgentContext, 'configuration' | 'native' | 'revisionWithholdsTools'>,
  environment: ChartDependenciesEnvironment,
) {
  return {
    memories: this.configuration.memories,
    // Evidence bridge (#5): closure hand-off to the CAUSAL write mounts.
    ...(this.configuration.memories.some((memory) => memory.type === 'causal') && {
      causalEvidenceSource: (binding: NativeMappingBinding) =>
        componentEvidence(this.native.runExecution().forScope(binding).value, binding),
    }),
    systemPromptCachePolicy: environment.systemPromptCachePolicy,
    maxIterations: environment.maxIterations,
    seed: environment.seed,
    callLLM: environment.callLLM,
    routeDecider: environment.terminalRouteDecider,
    toolCallsHandler: environment.toolCallsHandler,
    // The re-ask branch — mounted only when there are retries to spend. A
    // `'tool-forced'` agent with `retries: 0` gets the constrained shape and
    // no branch: there is nothing for a branch to do.
    ...(this.configuration.outputEnforcement !== undefined &&
      this.configuration.outputEnforcement.retries > 0 && {
        outputRetryStage: buildOutputRetryStage(this.configuration.outputEnforcement) as (
          scope: never,
        ) => void,
      }),
    // The unfinished-steps nudge branch (9.18.0) — mounted only when a
    // stepped skill exists, same conditional-mount law as the re-ask above.
    ...(environment.stepPlanFor !== undefined && {
      hasSteps: true,
      stepNudgeStage: buildStepNudgeStage(environment.stepPlanFor) as (scope: never) => void,
    }),
    // The maps kernel (9.58.0) — gates the mapEngagement alias round trip
    // through the engine boundary. Same conditional-mount law as steps.
    ...(this.configuration.mapsPlan !== undefined && {
      engagementPlan: this.configuration.mapsPlan,
    }),
    // The evidence gate (9.35.0). `hasEvidenceGate` rides ANY posture (the
    // grouped chart needs the system-prompt records bubbled out to exempt
    // what the app itself supplied); the BRANCH is mounted only for a
    // posture that can revise — `'assist'` records and never loops, so it
    // gets no branch and no stage, the same conditional-mount law as above.
    ...(this.configuration.evidenceGate !== undefined && {
      hasEvidenceGate: true,
      ...(this.configuration.evidenceGate.posture !== 'assist' && {
        evidenceRecheckStage: buildEvidenceRecheckStage(
          this.configuration.evidenceGate,
          // The staged-refs join (grounded numbers) — the correction names
          // the refs and the spender when the run declared both. Threaded
          // whenever a `wants` tool exists (not gated on `nudge`: a
          // revision that cannot say HOW to compute leaves the model to
          // head-math again); absent for every agent without one, so the
          // correction keeps its exact bytes.
          environment.toolWants.size > 0
            ? {
                toolWants: environment.toolWants,
                staticToolNames: () => environment.toolSchemasResolved.map((t) => t.name),
              }
            : undefined,
        ) as (scope: never) => void,
      }),
    }),
    // Escalation (9.19.0): the grouped chart threads `skillEscalated`
    // across the sf-llm-call boundary only when the policy exists.
    ...(this.configuration.skillBrains?.escalation !== undefined && { hasEscalation: true }),
    // The findings ledger (9.102.0): both charts compute the OFFER on the
    // Tools branch's mount only under the arm — the same value-conditional
    // grammar as the slot's `findings` and callLLM's `hasFindingsLedger`,
    // so the three can never disagree about whether the ledger is armed.
    ...(this.configuration.findingsOptions !== undefined && { hasFindingsLedger: true }),
    // The inputs layer (honesty layer 2): `sf-inputs` between the LLM call
    // and Route, in both builders through one helper; absent → untouched.
    // With a before-tool chain, the final branch's "Assumed" block also reads
    // the chain's rewrites (a rewritten fill is not what the call ran with).
    ...(environment.inputsArmed && {
      inputsLayer: {
        ...(this.configuration.findingsOptions !== undefined && { findings: true as const }),
        // Route's sixth dispatch value, read only by an agent whose revision
        // turns the tools off (an enforcing answer validation).
        ...(this.revisionWithholdsTools() && { toolsOffAfterRevision: true as const }),
        toolOfFor: (scope: object) => {
          const resolve = environment.resolveForLayer(scope);
          return (toolName: string) => resolve(toolName).tool;
        },
        ...(this.configuration.toolMiddleware.length > 0 && { rewrites: true as const }),
        // The time layer (step T5a): a tool whose period declares forms is filled from the
        // turn's one window, bound to the person's window, or recorded as the model's.
        ...(this.configuration.timeOptions !== undefined && {
          time: {
            ...(this.configuration.timeOptions.zone !== undefined && {
              appZone: this.configuration.timeOptions.zone,
            }),
          },
        }),
        // Declared sources: the layer reads `_findings.from` and checks it against
        // the corpora the mount hands in — the app's `externalGrounds` among them.
        ...(environment.argumentSources && {
          sources: {
            ...(this.configuration.externalGrounds !== undefined && {
              externalGrounds: this.configuration.externalGrounds,
            }),
            // Beside the findings ledger a declared basis files a basis row,
            // which carries the dropped `from` entries' count; without it the
            // count rides the call's first argument row.
            ...(this.configuration.findingsOptions !== undefined && { basisRows: true as const }),
            // A tool in reach that may hide an argument keeps every quote off the
            // record — a quote is free text that may hold the hidden value. Decided
            // once, here, over every party the layer's `toolOf` can resolve: the
            // registry (each tool asked), and a ToolProvider — whatever it lists,
            // since its list is known only per iteration and a tool it lists first
            // AFTER a quote was filed would find that quote already on the record.
            ...(([...environment.registryByName.values()].some(carriesArgumentView) ||
              this.configuration.externalToolProvider !== undefined) && {
              argumentViews: true as const,
            }),
          },
        }),
      },
    }),
    // The results layer (honesty layer 3, step 7b): `sf-results` at the loop
    // head, in both builders through one helper, reading each call's
    // `ToolPeriod` off the implementation that answered it; absent → untouched.
    ...(environment.resultsArmed && {
      resultsLayer: {
        toolOfFor: (scope: object) => {
          const resolve = environment.resolveForLayer(scope);
          return (toolName: string) => resolve(toolName).tool;
        },
      },
    }),
    // The answer layer (honesty layer 4): its stage heads the final branch
    // in both builders through one helper, reading only the committed keys
    // this agent's arms can write; absent → the branch is untouched.
    ...(this.configuration.answerLayerOption !== undefined && {
      answerLayer: {
        reads: answerFoldReads({
          tools: environment.canCallTools,
          evidenceGate: this.configuration.evidenceGate !== undefined,
          answerValidation: this.configuration.answerValidationConfig !== undefined,
          inputs: environment.inputsArmed,
          toolMiddleware: this.configuration.toolMiddleware.length > 0,
        }),
        ...(this.configuration.answerLayerOption.standingLine !== undefined && {
          standingLine: this.configuration.answerLayerOption.standingLine,
        }),
        ...(this.configuration.answerValidationConfig !== undefined && {
          validated: true as const,
        }),
        ...(environment.displayNameOfFor !== undefined && {
          displayNameOfFor: environment.displayNameOfFor,
        }),
      },
    }),
    // The prose limits block names an item's calls in the app's words — under the same wiring.
    ...(environment.displayNameOfFor !== undefined && {
      displayNameOfFor: environment.displayNameOfFor,
    }),
    // Tool choice by classifier (9.105.0): the mount args on the Tools
    // branch and the key across the sf-llm-call boundary, under the arm.
    ...(this.configuration.toolChoiceOptions !== undefined && { hasToolChoice: true }),
    // The declared ontology (9.106.0): the grouped chart carries the run
    // constant across the sf-llm-call boundary, under the arm.
    ...(this.configuration.ontology !== undefined && { hasOntology: true }),
    // `.limitsTravelWithTheAnswer()` — value-conditional, the
    // `resolvedModel` precedent: absent from the deps object entirely for an
    // agent that did not ask, so both builders mount the final-branch stage
    // function they have always mounted. ONE of the two, never both: a prose
    // answer gets the appended block, a TYPED one (`limitsAsData`, above)
    // gets the stage that appends nothing and carries the limits as data.
    ...(this.configuration.limitsTravelWithTheAnswerValue &&
      !environment.limitsAsData && { attachCoverageLimits: true }),
    ...(environment.limitsAsData && { coverageLimitsAsData: true }),
    // `.scriptTravelsWithTheAnswer()` — the recorded programs travel with the
    // answer: data always, text on a prose answer only. Absent → the final
    // stage this agent always mounted.
    ...(this.configuration.scriptTravel !== undefined && {
      scriptTravel: {
        ...this.configuration.scriptTravel,
        ...(this.configuration.outputSchemaParser !== undefined && { typed: true as const }),
      },
    }),
    // The time layer: the prose limits block renders its `Period:` lines in
    // the run's clock zone. Absent → the final stage it always mounted.
    ...(this.configuration.timeOptions !== undefined && { timeLayer: true as const }),
    // The Tools mount hands the slot the turn's windows — the reader's (step T6b) and the
    // app's control window (G14) — under `.time()`.
    ...(this.configuration.timeOptions !== undefined && { timeWindows: true as const }),
    ...(environment.inputsArmed &&
      this.configuration.timeOptions !== undefined && { timeLimits: true as const }),
    ...(this.configuration.answerValidationConfig !== undefined && { hasAnswerValidation: true }),
    ...(this.configuration.typedNegativeClaimsConfig !== undefined && {
      negativeRecheckStage: negativeRecheckStage as (scope: never) => void,
    }),
    ...(environment.governsOutput && { releaseOutputTokens: true as const }),
    ...(this.configuration.evidenceGate?.posture === 'rails' && { evidenceRails: true as const }),
    // The out-of-budget wrap-up branch (9.56.0) — the conditional-mount law
    // above, decided once beside the Route decider that routes to it so the
    // two can never disagree about whether the branch exists.
    ...(environment.hasWrapUp && { wrapUpStage: wrapUpStage as (scope: never) => void }),
    injectionEngineSubflow: environment.injectionEngineSubflow,
    ...(environment.pickEntryStage && { pickEntryStage: environment.pickEntryStage }),
    ...(environment.routeTurnStage && {
      routeTurnStage: environment.routeTurnStage as (scope: never) => Promise<void>,
    }),
    // Messages-slot delivery (7.21) — mounted ONLY when something could
    // target the slot. A registered injection declaring `inject.messages`
    // is the obvious case; a `.memory()` is the other, because a hand-built
    // read subflow may format its recall as a non-system role and that
    // recall only exists at run time. An agent with neither gets no stage
    // and no write, so its chart and its commit log are what they were.
    ...((this.configuration.injections.some((i) => (i.inject?.messages?.length ?? 0) > 0) ||
      this.configuration.memories.length > 0) && {
      deliverStage: buildDeliverStage({
        provider: this.configuration.provider,
        ...(this.configuration.reliabilityConfig?.providers !== undefined && {
          providers: providerTargets(
            this.configuration.provider,
            this.configuration.model,
            this.configuration.reliabilityConfig.providers,
          ).map((target) => target.provider),
        }),
        memoryIds: this.configuration.memories.map((m) => m.id),
      }) as (scope: never) => void,
    }),
    systemPromptSubflow: environment.systemPromptSubflow,
    messagesSubflow: environment.messagesSubflow,
    toolsSubflow: environment.toolsSubflow,
    ...(environment.thinkingSubflow !== undefined && {
      thinkingSubflow: environment.thinkingSubflow,
    }),
    updateSkillHistoryStage,
    ...(environment.windowStage !== undefined && { windowStage: environment.windowStage }),
    // Gate the UpdateSkillHistory stage on skills being registered —
    // same idiom buildToolRegistry uses to auto-attach `read_skill`.
    hasSkills: this.configuration.injections.some((i) => i.flavor === 'skill'),
    // Builders only branch on classic-vs-dynamic SEMANTICS; the grouped
    // chart shape is selected below by choosing buildDynamicAgentChart.
    reactMode: (this.configuration.reactMode === 'classic' ? 'classic' : 'dynamic') as
      | 'classic'
      | 'dynamic',
    ...(this.configuration.structureRecorders !== undefined && {
      structureRecorders: [...this.configuration.structureRecorders],
    }),
  };
}
