import type { TypedScope } from 'footprintjs';
import { type AgentRunValues } from '../../runValues.js';
import { type RunnerScopeValues } from '../../../runnerExecution.js';
import { describeServingBrain } from '../../skillBrains.js';
import { pendingDurableWrite } from '../../../durabilityBarrier.js';
import { ensureDiscoveredTools } from '../../../slots/discoverTools.js';
import type { AgentState } from '../../types.js';
import { buildToolCallsHandler } from '../../stages/toolCalls/index.js';
import { memberIdentityIn, memberRequestIn } from '../../../memberRun.js';
import { buildToolRegistry } from '../../buildToolRegistry.js';
import type { AgentConfiguration } from '../configuration/types.js';
import type { StepPlanFor } from '../../../../injection-engine/skillSteps.js';
import type { buildToolResolver } from '../../stages/toolResolver.js';
import { evidenceExemptArm } from '../routing/exemptArm.js';

/** Build-time declarations and live native ports for this one stage factory. */
export interface ToolCallsEnvironment {
  readonly configuration: AgentConfiguration;
  readonly runner: object;
  readonly registryByName: ReturnType<typeof buildToolRegistry>['registryByName'];
  readonly toolDeclaringSkills: ReturnType<typeof buildToolRegistry>['toolDeclaringSkills'];
  readonly toolClaimants: ReturnType<typeof buildToolRegistry>['toolClaimants'];
  readonly scriptRecordArmed: boolean;
  readonly inputsArmed: boolean;
  readonly argumentSources: boolean;
  readonly resultsArmed: boolean;
  readonly answerArmed: boolean;
  readonly toolGrounding: NonNullable<
    Parameters<typeof buildToolCallsHandler>[0]['emptyLookupGrounding']
  >;
  readonly toolColumns: NonNullable<
    Parameters<typeof buildToolCallsHandler>[0]['columnDeclarations']
  >;
  readonly permissionChecker: AgentConfiguration['permissionChecker'];
  readonly credentialProvider: AgentConfiguration['credentialProvider'];
  readonly artifactStore: AgentConfiguration['artifactStore'];
  readonly stepPlanFor: StepPlanFor | undefined;
  readonly provider: AgentConfiguration['provider'];
  readonly model: string;
  openSkillIds(): readonly string[];
  toolRunFacts(
    run: RunnerScopeValues<AgentRunValues>,
  ): ReturnType<NonNullable<Parameters<typeof buildToolCallsHandler>[0]['currentRun']>>;
  readonly emitLateFact: NonNullable<Parameters<typeof buildToolCallsHandler>[0]['emitForRun']>;
  /** The run's dispatch resolver — the one the route decider reads declared defaults through. */
  readonly resolverForValues: (values: AgentRunValues) => ReturnType<typeof buildToolResolver>;
}

/** The exempt arm, as a deps fragment: absent unless the inputs layer and the gate are armed. */
function evidenceExemptOf(
  environment: ToolCallsEnvironment,
  run: RunnerScopeValues<AgentRunValues>,
): { evidenceExempt?: NonNullable<ReturnType<typeof evidenceExemptArm>> } {
  const arm = evidenceExemptArm(
    environment.configuration,
    environment.inputsArmed,
    environment.resolverForValues(run.value),
  );
  return arm === undefined ? {} : { evidenceExempt: arm };
}

/** Keep per-invocation stage creation inside the native component's existing memo. */
export function toolCallsFactory(environment: ToolCallsEnvironment) {
  return (run: RunnerScopeValues<AgentRunValues>) =>
    buildToolCallsHandler({
      registryByName: environment.registryByName,
      // WHICH SKILLS DECLARE EACH TOOL NAME (9.86.0) — read by the unknown-tool
      // roster so a role that may not see a skill is not told the names of the
      // tools that skill brought. Value-conditional: an agent whose skills carry
      // no tools hands the handler exactly the deps object it always did.
      ...(environment.toolDeclaringSkills.size > 0 && {
        toolDeclaringSkills: environment.toolDeclaringSkills,
      }),
      // The claim ledger accumulates only for an agent that declared a
      // contract to read it (9.61.0) — value-conditional, so every other
      // agent commits exactly what it always did.
      ...(environment.configuration.claimContract !== undefined && { collectClaimFacts: true }),
      // The findings ledger (9.101.0) — the peel, the basis row and the
      // previous batch's standings all live in this handler under this gate.
      ...(environment.configuration.findingsOptions !== undefined && { findings: true as const }),
      // The script record — `code: 'match'` or `.scriptTravelsWithTheAnswer()`:
      // one `script` row per call of a tool that declares `Tool.script`.
      ...(environment.scriptRecordArmed && { scriptRecord: true as const }),
      // The inputs layer (honesty layer 2) — the fills, the refusals and the
      // note; absent → a ruled tool's call is refused (fail closed).
      ...(environment.inputsArmed && { inputsLayer: true as const }),
      // Declared sources: the peel reads `_findings.from` as the layer did.
      ...(environment.argumentSources && { argumentSources: true as const }),
      // The results layer (honesty layer 3, step 7b) — read in one place: a
      // period a result declares with NO layer mounted is dev-warned (nobody
      // will file its verdict). And the turn stamp, as under any layer.
      ...(environment.resultsArmed && { resultsLayer: true as const }),
      // The answer layer (honesty layer 4) — only the turn stamp on the rows
      // this handler files (adopted Q6).
      ...(environment.answerArmed && { answerLayer: true as const }),
      // …and the host's own context for the layer's batch ask (step 4),
      // value-conditional inside the arm.
      ...(environment.inputsArmed &&
        environment.configuration.argumentAskContext !== undefined && {
          argumentAskContext: environment.configuration.argumentAskContext,
        }),
      // The judge (9.104.0) — VALUE-conditional inside the arm: an armed
      // agent without one hands the handler exactly the deps it did before.
      ...(environment.configuration.findingsOptions?.judge !== undefined && {
        findingsJudge: environment.configuration.findingsOptions.judge,
      }),
      // THE TOWERS AT DISPATCH (9.110.0) — the contingent check's second
      // moment. VALUE-conditional on BOTH doors: the ledger (the standings)
      // and the evidence gate (the corpus and the extractor's rule); an
      // agent with one or neither hands the handler exactly the deps it did
      // before. The same resolved gate the route decider judges the answer
      // with, so the two moments read one extractor and one set of shapes.
      ...(environment.configuration.findingsOptions !== undefined &&
        environment.configuration.evidenceGate !== undefined && {
          evidenceGate: environment.configuration.evidenceGate,
        }),
      // …and what it exempts beside the gate: the route decider's own arm,
      // from the one builder (`routing/exemptArm.ts`), so the two moments of
      // the contingent check exempt the same values.
      ...(environment.configuration.findingsOptions !== undefined &&
        evidenceExemptOf(environment, run)),
      // THE WRITE SEAM (9.77.0) — `empty-lookup`. Handed the SAME harvested
      // map callLLM reads at the choice seam, so the two stages agree by
      // construction about which calls are armed. Value-conditional on both
      // halves — the operator's dial and at least one `argumentsFrom`
      // declaration — so an agent that asked for neither hands the handler
      // exactly the deps object it always did.
      ...(environment.configuration.noticeEmptyLookups &&
        environment.toolGrounding.size > 0 && {
          emptyLookupGrounding: environment.toolGrounding,
          integrityLedger: run.value.integrityLedger,
        }),
      // THE WRITE SEAM'S other check (9.78.0) — the column-type contract.
      // Value-conditional on both halves for the same reason, so an agent
      // that asked for neither hands the handler exactly the deps object it
      // always did.
      ...(environment.configuration.checkColumnTypes !== 'off' &&
        environment.toolColumns.size > 0 && {
          columnDeclarations: environment.toolColumns,
          columnCheckMode: environment.configuration.checkColumnTypes,
          integrityLedger: run.value.integrityLedger,
        }),
      ...(environment.configuration.externalToolProvider && {
        externalToolProvider: environment.configuration.externalToolProvider,
      }),
      ...(environment.configuration.externalToolProvider && {
        providerToolCache: run.value.providerToolCache,
        prepareProviderTools: (scope: TypedScope<AgentState>) =>
          ensureDiscoveredTools(scope, {
            provider: environment.configuration.externalToolProvider!,
            cache: run.value.providerToolCache,
            callerIdentity: run.own ? run.value.identity : memberIdentityIn(scope),
            get iteration() {
              return scope.iteration ?? 1;
            },
          }),
      }),
      servedTools: run.value.servedTools,
      toolClaimants: environment.toolClaimants,
      ...(environment.permissionChecker && { permissionChecker: environment.permissionChecker }),
      ...(environment.credentialProvider && { credentialProvider: environment.credentialProvider }),
      // The request a call's credential is read for: this agent's own run's,
      // or — on a mount — the run its link names (`memberRun.ts`). An accessor,
      // because the chart is built once and the request is per run.
      ...(environment.credentialProvider && {
        currentRequest: (scope: object) => (run.own ? run.value.request : memberRequestIn(scope)),
      }),
      // The claim-check store (9.21.0). Absent → not one new line runs in
      // dispatch: `ctx.artifacts` is the fail-closed teacher and no artifact
      // event can fire (zero-cost-when-unused).
      ...(environment.artifactStore && { artifactStore: environment.artifactStore }),
      // The placement threshold (9.22.0) — only ever set beside a store (the
      // option's own shape enforces it). Absent → results are never measured
      // against it and never placed.
      ...(environment.configuration.artifactPlacement !== undefined && {
        placement: environment.configuration.artifactPlacement,
      }),
      ...(environment.configuration.toolArgValidation && {
        toolArgValidation: environment.configuration.toolArgValidation,
      }),
      ...(environment.configuration.maxToolResultChars !== undefined && {
        maxToolResultChars: environment.configuration.maxToolResultChars,
      }),
      // The repeated-call nudge (9.26.0). Threaded ONLY when switched off —
      // the VALUE-conditional pattern, so an agent on the default hands the
      // handler exactly the deps object it always did.
      ...(environment.configuration.repeatedCallNudge === false && { repeatedCallNudge: false }),
      // The answer check's tool-call ledger (`context.toolCalls`) — kept ONLY
      // for answer validation or negative claims; other records stay unchanged.
      ...((environment.configuration.answerValidationConfig !== undefined ||
        environment.configuration.negativeClaimsConfig !== undefined) && {
        toolCallLedger: {
          maxCalls: environment.configuration.answerValidationConfig?.limits.maxToolCalls ?? 1000,
        },
      }),
      ...(environment.configuration.negativeClaimsConfig !== undefined && {
        negativeClaimsArmed: true,
      }),
      // Skill-graph read_skill gate: bound the model's read_skill jumps to the
      // reachable set from the current cursor. Undefined → gate off (back-compat).
      ...(environment.configuration.skillGraphReachable && {
        allowedSkillIds: environment.configuration.skillGraphReachable,
        openSkillIds: environment.openSkillIds(),
        skillGraphIsTree: environment.configuration.skillGraphIsTree,
      }),
      // The mount kernel's plan (9.59.0) — the gate's THIRD admission class.
      // A `read_skill` pick of a PARKED map's member is a re-engagement, not
      // a hop: admitted even though the reachable set excludes the node the
      // cursor already stands on, and it never touches the cursor. Value-
      // conditional, so an agent without `.maps()` hands the handler exactly
      // the deps object it always did.
      ...(environment.configuration.mapsPlan !== undefined && {
        engagementPlan: environment.configuration.mapsPlan,
      }),
      // The mount's routing posture (SG-C). `'assist'` — the default — is
      // deliberately NOT threaded: undefined keeps the gate byte-identical.
      ...(environment.configuration.skillGraphCascade !== undefined &&
        environment.configuration.skillGraphCascade.strictness !== 'assist' && {
          skillStrictness: environment.configuration.skillGraphCascade.strictness,
        }),
      // Steps (9.18.0): advance/skip at the result boundary — the batch loop
      // AND every pausable resume path (an askHuman step advances on resume).
      ...(environment.stepPlanFor !== undefined && { stepPlanFor: environment.stepPlanFor }),
      // Escalate-on-evidence (9.19.0): the refusal budget + flip, wired only
      // when the policy exists. `describeFrom` resolves the event's honest
      // `from` by the same chain callLLM applies.
      ...(environment.configuration.skillBrains?.escalation !== undefined && {
        escalation: {
          afterRefusals: environment.configuration.skillBrains.escalation.afterRefusals,
          to: {
            provider: environment.configuration.skillBrains.escalation.provider.name,
            ...(environment.configuration.skillBrains.escalation.model !== undefined && {
              model: environment.configuration.skillBrains.escalation.model,
            }),
          },
          describeFrom: (cursor: string | undefined, resolvedModel: string | undefined) =>
            describeServingBrain({
              brains: environment.configuration.skillBrains!,
              cursor,
              agentProviderName: environment.provider.name,
              defaultModel: environment.model,
              ...(resolvedModel !== undefined && { resolvedModel }),
            }),
        },
      }),
      // The require-instruction catalog (9.19.0): every registered injection
      // id + the one delivery fact its check-up needs. Wired whenever
      // injections exist; nothing runs until a tool returns an effect.
      ...(environment.configuration.injections.length > 0 && {
        leaseTargets: new Map(
          environment.configuration.injections.map((inj) => {
            const surfaceMode = (inj.metadata as { surfaceMode?: string } | undefined)?.surfaceMode;
            return [inj.id, { ...(surfaceMode !== undefined && { surfaceMode }) }] as const;
          }),
        ),
      }),
      // Check-in (evidence-carrying human consent). Always threaded (resolved
      // default); the gate fires only for tools that declared `checkIn`.
      checkIn: environment.configuration.checkInConfig,
      // Where a decision's request is spent, once (`core/consentRequest.ts`).
      // Absent → this process's ledger, shared by every agent that names none.
      ...(environment.configuration.decisionLedger !== undefined && {
        decisionLedger: environment.configuration.decisionLedger,
      }),
      // The governance chain. Threaded only when non-empty so an agent without
      // one produces the same handler behaviour it always did.
      ...(environment.configuration.toolMiddleware.length > 0 && {
        toolMiddleware: environment.configuration.toolMiddleware,
      }),
      // Durable-write barrier. An ACCESSOR, never a captured value: the chart is
      // built once at construction and a session composer installs its barrier
      // later, so a direct field read here would be stale forever. Answers
      // `undefined` — no await, no microtask — until one is installed.
      awaitDurable: () => pendingDurableWrite(environment.runner),
      // 9.7.0 — run/session identity and the teardown registrar. BOTH are
      // accessors for the reason `awaitDurable` is one: the chart is built once
      // at construction, and a captured value would be run #1's forever. The
      // tier one is lazy on top of that — an agent whose tools hold no sessions
      // never allocates it.
      currentRun: () => environment.toolRunFacts(run),
      isRunRetired: () => run.retired,
      isOwnRun: () => run.own,
      answeredAsk: () => run.value.answeredAsk,
      // The time layer: each dispatched call files its `call` row, and the
      // resume door compares a resume's passed `time` with the kept clock.
      ...(environment.configuration.timeOptions !== undefined && {
        time: {
          takePassedOnResume: () => {
            // Only the agent's own resumed leg takes it — never a member's.
            if (!run.own) return undefined;
            const passed = run.value.resumePassedTime;
            run.value.resumePassedTime = undefined;
            return passed;
          },
          ...(environment.configuration.timeOptions.zone !== undefined && {
            appZone: environment.configuration.timeOptions.zone,
          }),
          // The reader (step T6b): the batch ask asks an open mention's window.
          ...(environment.configuration.timeOptions.reader !== undefined &&
            environment.configuration.timeOptions.policy !== undefined && {
              reader: {
                policy: environment.configuration.timeOptions.policy,
                ...(environment.configuration.timeOptions.messages !== undefined && {
                  messages: environment.configuration.timeOptions.messages,
                }),
              },
            }),
        },
      }),
      emitForRun: (type, payload, runContext) =>
        environment.emitLateFact(type, payload, runContext),
      resources: run.value.resources,
      // 8.6.0 — what a run does when a declared credential needs 3LO consent.
      onAuthorizationRequired: environment.configuration.onAuthorizationRequired,
      // The `'tell-model'` consent record travels OFF tracked state (a tracked
      // write is a commit-log entry, and the URL is a bearer capability), so
      // these two callbacks are its whole route to the caller. Cleared at the
      // top of every run; read in `finalizeResult`.
      reportConsentOutstanding: (record) => {
        run.value.consentOutstanding.set(record.service, record);
      },
      clearConsentOutstanding: (service) => {
        run.value.consentOutstanding.delete(service);
      },
    });
}
