import { type AgentRunValues } from '../../runValues.js';
import { type RunnerScopeValues } from '../../../runnerExecution.js';
import type { LLMToolSchema } from '../../../../provider-contract/types.js';
import type { FindingsLedger } from '../../findings/types.js';
import type { MemoryStore } from '../../../../memory/store/index.js';
import { draftClock, type ClockDraft } from '../../../../time/clock.js';
import type { Tool } from '../../../../tools/tools.js';
import type { AgentInput, RunConfig, RunConfigContext } from '../../types.js';
import { buildSeedStage } from '../../stages/seed.js';
import { type HonestyLayers } from '../../honesty/armed.js';
import type { AgentConfiguration } from '../configuration/types.js';
import type { StepPlanFor } from '../../../../injection-engine/skillSteps.js';

/** Build-time declarations and live native ports for this one stage factory. */
export interface SeedEnvironment {
  readonly configuration: AgentConfiguration;
  readonly maxIterations: number;
  readonly cachingDisabled: boolean;
  readonly costBudget: AgentConfiguration['costBudget'];
  readonly toolSchemasResolved: readonly LLMToolSchema[];
  readonly seededToolWants: Readonly<Record<string, readonly string[]>> | undefined;
  readonly seededRuledTools: ReadonlyMap<string, Tool> | undefined;
  readonly seededHonestyLayers: HonestyLayers | undefined;
  readonly ledgerRestoreArmed: boolean;
  readonly stepPlanFor: StepPlanFor | undefined;
  readonly conversationStores: readonly MemoryStore[];
  readonly model: string;
  readonly systemPromptValue: string;
  readonly ontologyTools: Readonly<Record<string, readonly string[]>> | undefined;
  seedClockDraft(values: AgentRunValues): ClockDraft;
  revisionWithholdsTools(): boolean;
}

/** Keep per-invocation stage creation inside the native component's existing memo. */
export function seedFactory(environment: SeedEnvironment) {
  return (run: RunnerScopeValues<AgentRunValues>) => {
    const consumeResumeLedger = (): FindingsLedger | undefined => {
      const l = run.value.pendingResumeFindingsLedger;
      run.value.pendingResumeFindingsLedger = undefined;
      return l;
    };
    return buildSeedStage({
      maxIterations: environment.maxIterations,
      // The forced-output tool's name (9.88.0) — a build-time constant, put on
      // the record once so a rebuild can name it without reading a receipt.
      ...(environment.configuration.outputEnforcement?.schemaTool !== undefined && {
        forcedOutputToolName: environment.configuration.outputEnforcement.schemaTool.name,
      }),
      cachingDisabled: environment.cachingDisabled,
      ...(environment.costBudget !== undefined && {
        costBudgetOnExceed: environment.costBudget.onExceed,
      }),
      get toolSchemas() {
        return environment.toolSchemasResolved;
      },
      get toolWantsByName() {
        return environment.seededToolWants;
      },
      get ruledTools() {
        return environment.seededRuledTools;
      },
      get honestyLayers() {
        return environment.seededHonestyLayers;
      },
      // The time layer's clock: the draft `run()` read (refusing a run with no
      // zone), stamped by seed as the turn's one `clock` row. Absent → the
      // deps object seed always had.
      // The caller's clock belongs to the agent's OWN run: a member (another
      // runner's executor) gets the builder's fallback, never a concurrent
      // direct caller's `time` (`memberRun.ts`).
      ...(environment.configuration.timeOptions !== undefined && {
        timeClock: () =>
          run.own
            ? environment.seedClockDraft(run.value)
            : draftClock(undefined, environment.configuration.timeOptions ?? {}),
      }),
      // The time layer's reader: seed reads the person's words once per turn,
      // after the clock. Absent → nothing is read.
      ...(environment.configuration.timeOptions?.reader !== undefined &&
        environment.configuration.timeOptions.policy !== undefined && {
          timeReader: {
            reader: environment.configuration.timeOptions.reader,
            policy: environment.configuration.timeOptions.policy,
          },
        }),
      // Declared sources (honesty layer 2): the seed twin plants `_findings.from`
      // on ruled tools, and the run's `messageFrom` constant is written — only
      // under the arm (refused at build without the inputs layer).
      ...(environment.configuration.argumentSourcesArmed === true && {
        argumentSources: true as const,
      }),
      // The answer check's tool-call ledger — value-conditional, so an agent
      // without answer validation or negative claims keeps its prior shape.
      ...((environment.configuration.answerValidationConfig !== undefined ||
        environment.configuration.negativeClaimsConfig !== undefined) && { toolCallLedger: true }),
      ...(environment.configuration.negativeClaimsConfig !== undefined && {
        negativeClaimsArmed: true,
      }),
      get consumePendingResumeFindingsLedger() {
        return environment.ledgerRestoreArmed ? consumeResumeLedger : undefined;
      },
      consumePendingResumeHistory: () => {
        const h = run.value.pendingResumeHistory;
        run.value.pendingResumeHistory = undefined;
        return h;
      },
      ...(environment.configuration.evidenceGate !== undefined &&
        environment.configuration.evidenceGate.posture !== 'assist' && {
          consumePendingEvidenceRecovery: () => {
            const recovery = run.value.pendingEvidenceRecovery;
            run.value.pendingEvidenceRecovery = undefined;
            return recovery;
          },
        }),
      consumePendingResumeFolded: () => {
        const f = run.value.pendingResumeFolded;
        run.value.pendingResumeFolded = undefined;
        return f;
      },
      // The findings ledger (9.101.0): the arm, the serve mode it puts on the
      // record (the `forcedOutputToolName` precedent — a build-time constant
      // the rebuild reads instead of the receipt), and the continued
      // conversation's rows, all under the one gate — an unarmed agent hands
      // seed exactly the deps object it always did.
      ...(environment.configuration.findingsOptions !== undefined && {
        findings: true as const,
        findingsServe: environment.configuration.findingsOptions.serve ?? 'ledger-and-facts',
        findingsContextBytes: environment.configuration.findingsOptions.maxContextBytes,
        // The answer-turn ask (9.103.0): VALUE-conditional inside the arm —
        // the default `'none'` threads nothing and writes no key.
        ...(environment.configuration.findingsOptions.answerAsk === 'quote-facts' && {
          findingsAnswerAsk: 'quote-facts' as const,
        }),
      }),
      // The declared ontology (9.106.0): the whole frozen map, which seed
      // writes ONCE as the run constant `ontology` — the `findingsServe`
      // precedent, a build-time fact the rebuild reads from the RECORD. An
      // unarmed agent hands seed exactly the deps object it always did.
      ...(environment.configuration.ontology !== undefined && {
        ontology: environment.configuration.ontology,
        ontologyTools: () => environment.ontologyTools,
      }),
      // The conversation's inherited skill cursor (SG-C). Consumed (cleared)
      // on every run; HONORED only when the mounted graph declared
      // `continuity: 'conversation'` — the same one-option-one-behavior gate
      // the write side (`checkpoint()`) applies.
      consumePendingResumeSkillCursor: () => {
        const c = run.value.pendingResumeSkillCursor;
        run.value.pendingResumeSkillCursor = undefined;
        return c;
      },
      restoreSkillCursor:
        environment.configuration.skillGraphCascade?.continuity === 'conversation',
      // Steps (9.18.0): gate the per-run stepPointer/stepNudgeSpent reset on
      // the feature, so every other agent seeds exactly the keys it always did.
      ...(environment.stepPlanFor !== undefined && { hasSteps: true }),
      // Escalation (9.19.0): same gate discipline — the per-run counter/flip
      // reset exists only when the policy does (de-escalation IS the seed).
      ...(environment.configuration.skillBrains?.escalation !== undefined && {
        hasEscalation: true,
      }),
      // The evidence gate's one bounded revision (9.35.0) — a per-turn budget,
      // reset here. Only a posture that can revise writes the key.
      ...((environment.configuration.typedNegativeClaimsConfig !== undefined ||
        (environment.configuration.evidenceGate !== undefined &&
          environment.configuration.evidenceGate.posture !== 'assist')) && {
        hasEvidenceRevision: true,
      }),
      // Under an enforcing answer validation the tools stay off for a run
      // resumed after its revision was asked (`toolsOffAfterRevision`).
      ...(environment.revisionWithholdsTools() && { toolsOffAfterRevision: true as const }),
      getCurrentRunId: () => run.context.runId,
      // WHO this run is for, when the caller named nobody (9.10.0). Seed uses
      // it for exactly one rung of the identity ladder — see `seedFrom` — and
      // an explicit identity outranks it there. Read through an accessor for
      // the same reason the runId is: the chart is built once, and this
      // changes every run.
      getCurrentSessionId: () => run.context.sessionId,
      // Whether this stage runs in THIS agent's own executor, or inside another
      // runner's (a composition, a chart a caller built) — where the accessors
      // above describe some other run (`memberRun.ts`). Asked per scope.
      isOwnRun: () => run.own,
      // WHICH TURN THIS IS (9.6.0). Only memories that WRITE the conversation
      // are consulted: they are the ones whose entry ids are turn-stamped, and
      // a corpus (`.rag(...)`, which reads under its own namespace) has no
      // turns at all. Empty list → seed stays synchronous and makes no store
      // call, so an agent without memory is unchanged.
      ...(environment.conversationStores.length > 0 && {
        conversationStores: environment.conversationStores,
      }),
      // The `'input'` half of the message chain, run BEFORE `userMessage` and
      // `history` are committed — see SeedStageDeps.messageMiddleware.
      ...(environment.configuration.messageMiddleware.length > 0 && {
        messageMiddleware: environment.configuration.messageMiddleware,
      }),
      // `.configure()` — seed is where run-level facts are decided and
      // committed, so the resolver rides that commit. The closure supplies
      // the build-time defaults so a resolver can decide RELATIVE to them
      // ("upgrade the model when the message is long") instead of having to
      // restate them.
      ...(environment.configuration.runConfigFn && {
        resolveRunConfig: (input: AgentInput): RunConfig | undefined => {
          const ctx: RunConfigContext = {
            message: input.message,
            ...(input.identity !== undefined && { identity: input.identity }),
            runId: run.context.runId ?? 'unknown',
            defaults: { model: environment.model, instructions: environment.systemPromptValue },
          };
          return environment.configuration.runConfigFn?.(ctx);
        },
      }),
    });
  };
}
