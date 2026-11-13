import { type AgentRunValues } from '../../runValues.js';
import { type RunnerInvocation } from '../../../runnerExecution.js';
import type { RunContext } from '../../../../bridge/eventMeta.js';
import { buildEventMeta } from '../../../../bridge/eventMeta.js';
import { buildRunManifest } from '../../runManifest.js';
import { beginIntegrityRun } from '../../../../integrity/disposition/lifecycle.js';
import {
  RUN_MANIFEST_STAGE_ID,
  INTEGRITY_DISPOSITION_STAGE_ID,
  GRAPH_DECLARED_STAGE_ID,
} from '../../run/eventStageIds.js';
import type { AgentContext } from '../contracts.js';

/**
 * File the run-configuration manifest (9.41.0) — which adapters and
 * strategies this run is about to use, stamped with the runId every other
 * event of the run already carries.
 *
 * **Why it lives in `createExecutor` and not in `run()`.** `run()` and
 * `resume()` both come through here, and both mint a fresh runId (a resumed
 * run is a new run to every consumer joining on `meta.runId`, so a resume
 * with no manifest would be a run whose arm nobody can name). One funnel is
 * also how the next entry point cannot forget — the `beginIngress` lesson.
 *
 * **Why a direct dispatch rather than `typedEmit`.** There is no stage: the
 * chart has not started. So it is built with `buildEventMeta` and a STATED
 * pseudo-stage, exactly like the tool-teardown reports at the other end of
 * the run — never `minimalMeta()`, whose hardcoded `runId: 'consumer-scope'`
 * would make the one event whose whole job is to BE joinable the one event
 * that cannot be joined.
 *
 * **Why it is gated on a listener.** Every typed event in this library is:
 * the dispatcher drops what nobody subscribed to, and `EmitBridge` does the
 * same upstream. The gate is what keeps an unwatched agent at one map
 * lookup per run. It also means the manifest is not "always on" but "always
 * there when anything is watching" — including `recordRun`, which subscribes
 * with `'*'` before the run starts, so every recording carries one.
 */
/** Fresh per-run ledger — see AgentOptions.integrityPosture (9.60.0). */
export function beginIntegrityLedger(
  this: Pick<
    AgentContext,
    'configuration' | 'integrityColumnsPresent' | 'integrityDanglingPresent'
  >,
  values: AgentRunValues,
): void {
  values.integrityLedger.current = beginIntegrityRun(
    {
      wire: true,
      composeInvariant: this.configuration.mapsPlan !== undefined,
      dangling: this.integrityDanglingPresent,
      claim: this.configuration.claimContract !== undefined,
      // TWO HALVES (9.77.0): the operator's dial AND a declaration to arm on.
      emptyLookup: this.configuration.noticeEmptyLookups && this.integrityDanglingPresent,
      // TWO HALVES (9.78.0), the same law: the operator's dial off `'off'`
      // AND a tool declaring `resultColumns`.
      columnTypes: this.configuration.checkColumnTypes !== 'off' && this.integrityColumnsPresent,
      // TWO HALVES (9.83.0), and here the second is structural rather than
      // a policy choice: the evidence gate owns the extractor that decides
      // which tokens in an answer are values, so a dial with no gate has
      // nothing whose provenance it could read.
      priorTurnEvidence:
        this.configuration.noticePriorTurnEvidence && this.configuration.evidenceGate !== undefined,
    },
    this.configuration.integrityPosture,
  );
}

/**
 * Dev posture only: throw {@link CheckerDeadError} on a run whose
 * registered checkers demonstrably never ran, or whose canary went
 * uncaught. Called on the SUCCESS path before the recording files, so the
 * failure is the run's result, never a masked afterthought.
 */
export function assertIntegrityAlive(
  this: Pick<AgentContext, 'configuration' | 'integrityWorkExisted'>,
  invocation: RunnerInvocation<AgentRunValues>,
): void {
  if (this.configuration.integrityPosture !== 'dev') return;
  invocation.value.integrityLedger.current?.assertAlive({
    workExisted: this.integrityWorkExisted(invocation),
  });
}

/**
 * Did this run reach work a registered check should have seen?
 *
 * MEASURED, not asserted — and measured from a signal the integrity code
 * does not write. `llmLatestContent` is committed by the LLM stage's own
 * core path on every completed call, so its presence proves a call
 * happened; its absence proves the run died or paused before one, and a
 * checker that filed nothing THERE is not rot, it is a run that never got
 * started. Deriving this from the checks' own encounter counts would be
 * circular: an unhooked check would report "no work existed" and silence
 * the very alarm it should be tripping.
 */
export function integrityWorkExisted(invocation: RunnerInvocation<AgentRunValues>): boolean {
  const state = invocation.view.snapshot()?.sharedState as
    | { llmLatestContent?: unknown }
    | undefined;
  return state !== undefined && state.llmLatestContent !== undefined;
}

/**
 * File the run's disposition rows as ONE `integrity.disposition` event and
 * clear the ledger. On the finally path of both run doors — every exit,
 * before the recording stops. Listener-gated like every typed event, and
 * deliberately throw-proof: accounting must never change a run's outcome.
 */
export function fileIntegrityDisposition(
  this: Pick<AgentContext, 'configuration' | 'integrityWorkExisted' | 'native'>,
  invocation: RunnerInvocation<AgentRunValues>,
): void {
  const ledger = invocation.value.integrityLedger.current;
  invocation.value.integrityLedger.current = undefined;
  if (ledger === undefined) return;
  try {
    const type = 'agentfootprint.integrity.disposition';
    const dispatcher = this.native.getDispatcher();
    if (!dispatcher.hasListenersFor(type)) return;
    dispatcher.dispatch({
      type,
      payload: {
        posture: this.configuration.integrityPosture,
        workExisted: this.integrityWorkExisted(invocation),
        rows: ledger.report(),
      },
      meta: buildEventMeta(
        { runtimeStageId: INTEGRITY_DISPOSITION_STAGE_ID },
        invocation.context(),
      ),
    });
  } catch {
    // Recorder/dispatcher failures never abort a run — the house rule.
  }
}

export function emitRunManifest(
  this: Pick<AgentContext, 'configuration' | 'native' | 'runner'>,
  context: RunContext,
): void {
  const type = 'agentfootprint.agent.run_configured';
  const dispatcher = this.native.getDispatcher();
  if (!dispatcher.hasListenersFor(type)) return;
  dispatcher.dispatch({
    type,
    payload: buildRunManifest({
      agentId: this.runner.id,
      providerName: this.configuration.provider.name,
      model: this.configuration.model,
      hasRunConfig: this.configuration.runConfigFn !== undefined,
      hasSkillBrains: this.configuration.skillBrains !== undefined,
      ...(this.configuration.cacheUnsupported !== undefined && {
        cacheUnsupported: this.configuration.cacheUnsupported,
      }),
      reactMode: this.configuration.reactMode,
      memories: this.configuration.memories,
      ...(this.configuration.windowStrategy !== undefined && {
        windowStrategyName: this.configuration.windowStrategy.name,
      }),
      // A graph is mounted iff `.skillGraph()` handed over its cursor
      // resolver. NOT `skillGraphCascade`, which a graph mounted without the
      // turn-start cascade options never sets — reading that one would
      // report "no graph" for a graph that routes every turn.
      ...(this.configuration.skillGraphNextSkill !== undefined && {
        skillGraph: {
          ...(this.configuration.skillGraphCascade !== undefined && {
            routing: this.configuration.skillGraphCascade.strictness,
            continuity: this.configuration.skillGraphCascade.continuity,
          }),
          ...(this.configuration.skillGraphCascade?.turnRouting?.scorer !== undefined && {
            scorerName: this.configuration.skillGraphCascade.turnRouting.scorer.name,
          }),
        },
      }),
      ...(this.configuration.evidenceGate !== undefined && {
        evidenceGatePosture: this.configuration.evidenceGate.posture,
      }),
      // The compositions this agent was built from, in declaration order.
      // Spread value-conditionally so an agent with none passes no key at all
      // — see `RunManifestSources.recipes` for why it is absent rather than
      // an empty list.
      ...(this.configuration.appliedRecipes !== undefined && {
        recipes: this.configuration.appliedRecipes,
      }),
      // The store itself is never named — see RunManifestSources.artifacts.
      ...(this.configuration.artifactStore !== undefined && {
        artifacts: {
          configured: true as const,
          placement: this.configuration.artifactPlacement !== undefined,
          recordings: this.configuration.artifactRecordings !== undefined,
        },
      }),
    }),
    meta: buildEventMeta({ runtimeStageId: RUN_MANIFEST_STAGE_ID }, context),
  });
}

/**
 * File the DECLARED skill map (9.50.0) — `agentfootprint.skill.graph_declared`,
 * once per run, right after the run-configuration manifest.
 *
 * Same funnel, same dispatch discipline, same listener gate as the manifest
 * (see `emitRunManifest` above): `run()` and `resume()` both come through
 * `createExecutor`, both mint a fresh runId, and a resumed run's consumers
 * deserve the topology under the runId they are joining on. The payload is
 * the map `AgentBuilder.skillGraph()` projected at mount — the author's
 * nodes and edges VERBATIM, never inferred from runtime hops — so a
 * recording carries the complete declared topology rather than the
 * fired-edges lower bound that `context.evaluated.routing[]` names.
 *
 * No graph, or a graph that could not state its map ⇒ no event — absent,
 * never guessed.
 */
export function emitSkillGraphDeclared(
  this: Pick<AgentContext, 'configuration' | 'native'>,
  context: RunContext,
): void {
  if (this.configuration.skillGraphDeclared === undefined) return;
  const type = 'agentfootprint.skill.graph_declared';
  const dispatcher = this.native.getDispatcher();
  if (!dispatcher.hasListenersFor(type)) return;
  dispatcher.dispatch({
    type,
    payload: this.configuration.skillGraphDeclared,
    meta: buildEventMeta({ runtimeStageId: GRAPH_DECLARED_STAGE_ID }, context),
  });
}
