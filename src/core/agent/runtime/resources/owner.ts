import { type AgentRunValues } from '../../runValues.js';
import { type RunnerScopeValues } from '../../../runnerExecution.js';
import type { RunContext } from '../../../../bridge/eventMeta.js';
import {
  ToolSessionTier,
  type ToolSessionOrigin,
  type ToolSessionReport,
} from '../../../../tools/toolSessions.js';
import { buildEventMeta } from '../../../../bridge/eventMeta.js';
import type {
  AgentfootprintEventMap,
  AgentfootprintEventType,
} from '../../../../events/registry.js';
import type { MemoryIdentity } from '../../../../memory/identity/types.js';
import { TOOL_TEARDOWN_STAGE_ID, LATE_ARTIFACT_FACT_STAGE_ID } from '../../run/eventStageIds.js';
import type { AgentContext } from '../contracts.js';

/**
 * Refuse, at run start, any declared messages-slot role this provider
 * cannot carry inside its message list (7.21, D2).
 *
 * Run start rather than build time because the answer depends on the
 * provider — and a decorated provider (`withFallback`, `withRetry`) is only
 * the thing it is once composed. Run start rather than delivery time
 * because a declaration that can never work should fail on the first call,
 * not three iterations into a paid run. The delivery stage re-checks each
 * message anyway, which is what catches roles that only exist at run time
 * (a hand-built memory-recall subflow's formatted output).
 *
 * Called from the ONE place `run()` and `resume()` share, so no entry point
 * can slip past it.
 */
/**
 * The OPEN skills — the ones `read_skill` may reach from anywhere, whatever the
 * graph's cursor says (8.4.0). Two clauses, both load-bearing:
 *
 *   • `trigger.kind === 'llm-activated'` — the trigger that reads
 *     `activatedInjectionIds`, which is the ONLY thing a `read_skill` call writes.
 *     It is exactly "read_skill can really activate this", so admitting anything
 *     else (a hand-built `rule` injection, say) would replace one lie with another:
 *     the tool would answer "activated" and nothing would activate.
 *   • the graph declares no incoming edge to it — a bare model edge `.route(a, m)`
 *     is a declared, drawn, `from`-gated affordance ("from a, the model may hop to
 *     m"), and opening every such target would silently globalize it. What is left
 *     is skills the graph never mentions at all.
 *
 * That covers three shapes that were all dead before: `.selfExplain()`'s debug
 * skill under a graph, a `.skill()`/`.skills()` registration beside a graph, and a
 * skill listed in `skills[]` and wired to nothing (whose own check-up warning says
 * "it can only be reached by the model via read_skill" — true again now).
 *
 * An open pick ACTIVATES but never moves the cursor — see the tool-calls gate.
 * Computed once per chart build; the injection list is fixed at construction.
 */
/**
 * The identity facts this run hands `tool.execute` (9.7.0).
 *
 * Read through an ACCESSOR from the chart (see `ToolCallsHandlerDeps.currentRun`)
 * because the chart is built once and this changes every run.
 *
 * `identity` is `lastRunIdentity` — what the CALLER passed — and deliberately
 * NOT `scope.runIdentity`, which is always populated and defaults to
 * `{ conversationId: '<runId>' }` (or, on a session-bound run since 9.10.0,
 * to `{ conversationId: sessionId }`). Handing a tool a synthesized
 * conversation as "the identity" would let it key an isolated session on a
 * fiction, and would make "absent" unrepresentable at exactly the layer that
 * most needs to see it. The session-derived namespace is synthesized too, and
 * is withheld here for that reason — `sessionId` beside it is the fact the
 * transport really delivered.
 */
export function toolRunFacts(
  this: Pick<AgentContext>,
  run: RunnerScopeValues<AgentRunValues>,
): {
  readonly runContext: RunContext;
  readonly runId: string;
  readonly sessionId?: string;
  readonly identity?: MemoryIdentity;
} {
  return {
    runContext: { ...run.context },
    runId: run.context.runId,
    ...(run.context.sessionId !== undefined && {
      sessionId: run.context.sessionId,
    }),
    ...(run.value.identity !== undefined && { identity: run.value.identity }),
  };
}

/**
 * The existing teardown tier, built on first component resource admission.
 *
 * Admission precedes tool resource effects so restored owners cannot be
 * borrowed concurrently. Components without tool admission do not allocate it.
 */
export function toolSessions(
  this: Pick<AgentContext, 'configuration' | 'emitToolSessionReport' | 'native'>,
): ToolSessionTier {
  if (!this.native.toolSessionTier) {
    this.native.toolSessionTier = new ToolSessionTier({
      timeoutMs: this.configuration.toolTeardownTimeoutMs,
      report: (report, origin) => this.emitToolSessionReport(report, origin),
    });
  }
  return this.native.toolSessionTier;
}

/**
 * Turn one TEARDOWN report into a typed `agentfootprint.tools.session_*` event.
 *
 * Only the two closing events come through here. A start and a reuse happen
 * inside `tool.execute`, where the dispatch loop still holds the scope, so
 * those ride the ordinary emit channel and carry the stage they really
 * happened in. These two fire after the run's last stage committed, and this
 * is the one place that has to answer "from where?" without a stage to point
 * at.
 *
 * **Built with `buildEventMeta`, never `minimalMeta()`.** `minimalMeta()`
 * hardcodes `runId: 'consumer-scope'`, and a teardown event stamped that way
 * cannot be joined to the run that OPENED the session — the exact
 * unjoinability 9.4.0 spent a release fixing for credential events. So the
 * meta comes from the registration-time run context, with a STATED pseudo-stage, the same
 * move as the `'<stageId>#paused'` stamp at the pause boundary.
 */
export function emitLateFact(
  this: Pick<AgentContext, 'native'>,
  type: AgentfootprintEventType,
  payload: Record<string, unknown>,
  runContext: RunContext,
): void {
  const dispatcher = this.native.getDispatcher();
  if (!dispatcher.hasListenersFor(type)) return;
  dispatcher.dispatch({
    type,
    payload,
    meta: buildEventMeta({ runtimeStageId: LATE_ARTIFACT_FACT_STAGE_ID }, runContext),
  } as unknown as AgentfootprintEventMap[typeof type]);
}

export function emitToolSessionReport(
  this: Pick<AgentContext, 'native'>,
  report: ToolSessionReport,
  origin: ToolSessionOrigin,
): void {
  const type =
    report.kind === 'closed'
      ? 'agentfootprint.tools.session_closed'
      : 'agentfootprint.tools.session_close_failed';
  const { kind: _kind, ...payload } = report;
  if (origin.emit !== undefined) {
    origin.emit(type, payload);
    return;
  }
  const dispatcher = this.native.getDispatcher();
  if (!dispatcher.hasListenersFor(type)) return;
  dispatcher.dispatch({
    type,
    payload,
    meta: buildEventMeta(
      { runtimeStageId: TOOL_TEARDOWN_STAGE_ID },
      origin.runContext ?? { runId: 'consumer-scope', runStartMs: 0, compositionPath: [] },
    ),
  } as unknown as AgentfootprintEventMap[typeof type]);
}
