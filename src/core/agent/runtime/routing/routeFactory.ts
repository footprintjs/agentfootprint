import { type AgentRunValues } from '../../runValues.js';
import { type RunnerScopeValues } from '../../../runnerExecution.js';
import { buildRouteDeciderStage } from '../../stages/route.js';
import { withNegativeProse } from '../../negativeClaims/observe.js';
import { withAnswerValidation } from '../../stages/answerValidation.js';
import { withAnswerCoverage } from '../../stages/answerCoverage.js';
import { buildToolResolver } from '../../stages/toolResolver.js';
import { evidenceExemptArm } from './exemptArm.js';
import type { AgentContext } from '../contracts.js';

import type { StepPlanFor } from '../../../../injection-engine/skillSteps.js';
import type { AgentConfiguration } from '../configuration/types.js';

export interface RoutingEnvironment {
  readonly stepPlanFor: StepPlanFor | undefined;
  readonly resultsArmed: boolean;
  readonly answerArmed: boolean;
  readonly artifactStore: AgentConfiguration['artifactStore'];
  readonly resolverForValues: (values: AgentRunValues) => ReturnType<typeof buildToolResolver>;
  readonly governsOutput: boolean;
  readonly maxIterations: number;
  readonly hasWrapUp: boolean;
  readonly limitsAsData: boolean;
  readonly inputsArmed: boolean;
}

export function routeFactory(
  this: Pick<AgentContext, 'configuration'>,
  environment: RoutingEnvironment,
) {
  return (run: RunnerScopeValues<AgentRunValues>) => {
    const resolve = environment.resolverForValues(run.value);
    const baseRouteDecider = buildRouteDeciderStage(
      this.configuration.messageMiddleware,
      this.configuration.outputEnforcement,
      environment.stepPlanFor,
      this.configuration.evidenceGate,
      environment.hasWrapUp,
      this.configuration.claimContract,
      run.value.integrityLedger,
      // THE CLAIM SEAM'S RECENCY READ (9.83.0). Value-conditional on both
      // halves, so an agent that armed neither hands the decider builder
      // exactly the arguments it always did — and `buildRouteDeciderStage`'s
      // no-judge fast path still returns the very function reference every
      // pre-9.83.0 chart was given.
      this.configuration.noticePriorTurnEvidence && this.configuration.evidenceGate !== undefined
        ? true
        : undefined,
      // THE ANSWER TURN'S STANDINGS (9.101.0) — the same value-conditional
      // trailing positional, for the same reason: an unarmed agent hands the
      // builder exactly the arguments it always did.
      this.configuration.findingsOptions !== undefined ? true : undefined,
      // THE INPUTS LAYER (honesty layer 2) — the same value-conditional
      // trailing positional: the rows this decider files carry the turn
      // stamp, and with the evidence gate armed too, the gate's exempt corpus
      // gains this turn's assumed values, read from the tools' declarations,
      // and the values the person gave the layer's batch ask (step 4). The
      // results layer (step 7b) arms the stamp alone — "while any layer is
      // armed, the one writer stamps the turn" — and nothing else.
      // The exempt arm is built by the one builder the dispatch moment uses too.
      environment.inputsArmed || environment.resultsArmed
        ? { ...evidenceExemptArm(this.configuration, environment.inputsArmed, resolve) }
        : undefined,
      // THE ANSWER LAYER (honesty layer 4) — the same value-conditional
      // trailing positional: the judges file the answer's witness rows, and
      // every row this decider files carries the turn stamp.
      environment.answerArmed ? true : undefined,
    );

    const validatedRouteDecider =
      this.configuration.answerValidationConfig === undefined
        ? baseRouteDecider
        : withAnswerValidation(
            baseRouteDecider,
            this.configuration.answerValidationConfig,
            this.configuration.outputSchemaParser,
            environment.artifactStore,
            () => run.value.consentOutstanding.size > 0,
            this.configuration.outputEnforcement?.outputFormat !== undefined,
            // Read only when `agentChecks` lists 'claims' (the agent's own rows).
            this.configuration.claimContract,
            this.configuration.typedNegativeClaimsConfig === undefined
              ? undefined
              : {
                  config: this.configuration.typedNegativeClaimsConfig,
                  phrases: this.configuration.typedNegativeClaimsConfig.phrases,
                  applicationValidation: this.configuration.applicationAnswerValidation,
                  runId: () => run.context.runId,
                },
          );
    const routeDecider =
      this.configuration.negativeClaimsConfig?.mode === 'prose'
        ? withNegativeProse(validatedRouteDecider, {
            runId: () => run.context.runId,
            hasOutstandingConsent: () => run.value.consentOutstanding.size > 0,
            structured: this.configuration.outputSchemaParser !== undefined,
            phrases: this.configuration.negativeClaimsConfig.phrases,
          })
        : validatedRouteDecider;
    // `.limitsTravelWithTheAnswer()` on a TYPED answer — decided once, here.
    // An output schema makes the answer JSON, and the appended block would
    // make it JSON followed by prose, which `runTyped()` cannot parse. So the
    // limits travel as DATA: the Route decider's terminal decision commits the
    // fold (`withAnswerCoverage`) and the Final branch projects it onto
    // `turn_end`. A prose answer keeps the block; an agent that asked for
    // neither is handed the decider it always had.
    // With the inputs layer armed, the typed answer's limits carry this
    // turn's assumed values too — the same rows the prose "Assumed" block
    // prints (`withAnswerCoverage`'s second argument); a rewrite by a
    // before-tool chain is read only when the agent has one.
    const terminalRouteDecider = environment.limitsAsData
      ? withAnswerCoverage(
          routeDecider,
          environment.inputsArmed
            ? { rewrites: this.configuration.toolMiddleware.length > 0 }
            : undefined,
        )
      : routeDecider;

    // toolCallsHandler extracted to ./agent/stages/toolCalls/index.ts (v2.11.2).
    return terminalRouteDecider;
  };
}
