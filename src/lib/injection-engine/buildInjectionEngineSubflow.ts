/**
 * Injection Engine — subflow builder.
 *
 * Pattern: Subflow Builder (returns a FlowChart mountable via
 *          `addSubFlowChartNext`). Each subflow stands alone.
 * Role:    Layer-3 context-engineering primitive. Sits BEFORE the
 *          three slot subflows in any primitive (Agent, LLMCall) that
 *          uses Injections. Evaluates every Injection's trigger once
 *          per iteration.
 * Emits:   `agentfootprint.context.evaluated` at exit, with
 *          aggregate metadata. The slot subflows that follow emit
 *          `agentfootprint.context.injected` per InjectionRecord placed.
 *
 * Mount with:
 *   builder.addSubFlowChartNext(
 *     SUBFLOW_IDS.INJECTION_ENGINE,
 *     buildInjectionEngineSubflow({ injections }),
 *     'Injection Engine',
 *     {
 *       inputMapper: (parent) => ({
 *         iteration: parent.iteration,
 *         userMessage: parent.userMessage,
 *         history: parent.history,
 *         lastToolResult: parent.lastToolResult,
 *         activatedInjectionIds: parent.activatedInjectionIds ?? [],
 *       }),
 *       outputMapper: (sf) => ({ activeInjections: sf.activeInjections }),
 *     },
 *   )
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import { evaluateInjections } from './evaluator.js';
import {
  projectActiveInjection,
  type Injection,
  type InjectionContext,
} from './types.js';

export interface InjectionEngineConfig {
  /**
   * The Injection list. Frozen at build time. To change at runtime,
   * rebuild the agent / chart — the primitive is intentionally
   * declarative.
   */
  readonly injections: readonly Injection[];
}

interface InjectionEngineState {
  [k: string]: unknown;
}

/**
 * Build the Injection Engine subflow. One stage: `evaluate`.
 * Pure function over the injection list + the iteration context.
 */
export function buildInjectionEngineSubflow(
  config: InjectionEngineConfig,
): FlowChart {
  const injections = config.injections;

  return flowChart<InjectionEngineState>(
    'Evaluate',
    (scope: TypedScope<InjectionEngineState>) => {
      const args = scope.$getArgs<{
        iteration?: number;
        userMessage?: string;
        history?: InjectionContext['history'];
        lastToolResult?: InjectionContext['lastToolResult'];
        activatedInjectionIds?: readonly string[];
      }>();

      const ctx: InjectionContext = {
        iteration: args.iteration ?? 1,
        userMessage: args.userMessage ?? '',
        history: args.history ?? [],
        ...(args.lastToolResult && { lastToolResult: args.lastToolResult }),
        activatedInjectionIds: args.activatedInjectionIds ?? [],
      };

      const evaluation = evaluateInjections(injections, ctx);

      // Two scope writes:
      //   1. activeInjections — POJO projections (no trigger functions,
      //      no Tool execute functions) so they survive footprintjs's
      //      transactional scope buffer (which clones on write).
      //      Tool schemas are preserved + tagged by injectionId so the
      //      Agent's closure-held registry can look up the executable.
      //   2. injectionEvaluation — aggregate metadata for observability.
      const activePOJOs = evaluation.active.map(projectActiveInjection);
      scope.$setValue('activeInjections', activePOJOs);
      scope.$setValue('injectionEvaluation', {
        activeCount: evaluation.active.length,
        skippedCount: evaluation.skipped.length,
        evaluatedTotal: injections.length,
        activeIds: evaluation.active.map((i) => i.id),
        skippedDetails: evaluation.skipped,
        triggerKindCounts: countTriggerKinds(evaluation.active),
      });
    },
    'evaluate',
    undefined,
    'Evaluate every Injection trigger; produce activeInjections + metadata',
  ).build();
}

/** Count active injections by trigger kind (observability metric). */
function countTriggerKinds(
  active: readonly Injection[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const inj of active) {
    counts[inj.trigger.kind] = (counts[inj.trigger.kind] ?? 0) + 1;
  }
  return counts;
}
