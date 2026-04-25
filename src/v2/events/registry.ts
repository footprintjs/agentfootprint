/**
 * Event registry — 45 typed events across 13 domains.
 *
 * Pattern: Discriminated Union + Typed Factory (Gang of Four adapted for TS).
 * Role:    The stable public event contract — the "ports" of the hexagonal
 *          architecture (Cockburn, 2005).
 * Emits:   N/A — this file DEFINES event types and factory helpers.
 *
 * Consumers subscribe via `.on(type, listener)`. Emitters construct events
 * via typed helpers (e.g. `makeContextInjected(payload)`) rather than raw
 * strings — compile-time safety prevents typos and payload drift.
 *
 * Events are additive within a major version; breaking changes require a
 * major bump. See agentfootprint_v2_detailed_design.md for rules.
 */

import type { AgentfootprintEventEnvelope } from './types.js';
import type {
  AgentHandoffPayload,
  AgentIterationEndPayload,
  AgentIterationStartPayload,
  AgentRouteDecidedPayload,
  AgentTurnEndPayload,
  AgentTurnStartPayload,
  CompositionEnterPayload,
  CompositionExitPayload,
  ConditionalRouteDecidedPayload,
  ContextBudgetPressurePayload,
  ContextEvictedPayload,
  ContextInjectedPayload,
  ContextSlotComposedPayload,
  CostLimitHitPayload,
  CostTickPayload,
  EmbeddingGeneratedPayload,
  ErrorFatalPayload,
  ErrorRecoveredPayload,
  ErrorRetriedPayload,
  EvalScorePayload,
  EvalThresholdCrossedPayload,
  FallbackTriggeredPayload,
  LLMEndPayload,
  LLMStartPayload,
  LLMTokenPayload,
  LoopIterationExitPayload,
  LoopIterationStartPayload,
  MemoryAttachedPayload,
  MemoryDetachedPayload,
  MemoryStrategyAppliedPayload,
  MemoryWrittenPayload,
  ParallelBranchCompletePayload,
  ParallelForkStartPayload,
  ParallelMergeEndPayload,
  PauseRequestPayload,
  PauseResumePayload,
  PermissionCheckPayload,
  PermissionGateClosedPayload,
  PermissionGateOpenedPayload,
  RiskFlaggedPayload,
  SkillActivatedPayload,
  SkillDeactivatedPayload,
  ToolEndPayload,
  ToolsActivatedPayload,
  ToolsDeactivatedPayload,
  ToolsOfferedPayload,
  ToolStartPayload,
} from './payloads.js';

// ─── Event type constants ─────────────────────────────────────────────
// Single source of truth for every event name. Low cardinality (~45),
// all under the `agentfootprint.` namespace, three-segment dotted form.
export const EVENT_NAMES = {
  composition: {
    enter: 'agentfootprint.composition.enter',
    exit: 'agentfootprint.composition.exit',
    forkStart: 'agentfootprint.composition.fork_start',
    branchComplete: 'agentfootprint.composition.branch_complete',
    mergeEnd: 'agentfootprint.composition.merge_end',
    routeDecided: 'agentfootprint.composition.route_decided',
    iterationStart: 'agentfootprint.composition.iteration_start',
    iterationExit: 'agentfootprint.composition.iteration_exit',
  },
  agent: {
    turnStart: 'agentfootprint.agent.turn_start',
    turnEnd: 'agentfootprint.agent.turn_end',
    iterationStart: 'agentfootprint.agent.iteration_start',
    iterationEnd: 'agentfootprint.agent.iteration_end',
    routeDecided: 'agentfootprint.agent.route_decided',
    handoff: 'agentfootprint.agent.handoff',
  },
  stream: {
    llmStart: 'agentfootprint.stream.llm_start',
    llmEnd: 'agentfootprint.stream.llm_end',
    token: 'agentfootprint.stream.token',
    toolStart: 'agentfootprint.stream.tool_start',
    toolEnd: 'agentfootprint.stream.tool_end',
  },
  context: {
    injected: 'agentfootprint.context.injected',
    evicted: 'agentfootprint.context.evicted',
    slotComposed: 'agentfootprint.context.slot_composed',
    budgetPressure: 'agentfootprint.context.budget_pressure',
  },
  memory: {
    strategyApplied: 'agentfootprint.memory.strategy_applied',
    attached: 'agentfootprint.memory.attached',
    detached: 'agentfootprint.memory.detached',
    written: 'agentfootprint.memory.written',
  },
  tools: {
    offered: 'agentfootprint.tools.offered',
    activated: 'agentfootprint.tools.activated',
    deactivated: 'agentfootprint.tools.deactivated',
  },
  skill: {
    activated: 'agentfootprint.skill.activated',
    deactivated: 'agentfootprint.skill.deactivated',
  },
  permission: {
    check: 'agentfootprint.permission.check',
    gateOpened: 'agentfootprint.permission.gate_opened',
    gateClosed: 'agentfootprint.permission.gate_closed',
  },
  risk: {
    flagged: 'agentfootprint.risk.flagged',
  },
  fallback: {
    triggered: 'agentfootprint.fallback.triggered',
  },
  cost: {
    tick: 'agentfootprint.cost.tick',
    limitHit: 'agentfootprint.cost.limit_hit',
  },
  eval: {
    score: 'agentfootprint.eval.score',
    thresholdCrossed: 'agentfootprint.eval.threshold_crossed',
  },
  error: {
    retried: 'agentfootprint.error.retried',
    recovered: 'agentfootprint.error.recovered',
    fatal: 'agentfootprint.error.fatal',
  },
  pause: {
    request: 'agentfootprint.pause.request',
    resume: 'agentfootprint.pause.resume',
  },
  embedding: {
    generated: 'agentfootprint.embedding.generated',
  },
} as const;

// ─── Event type → payload map (EventMap) ──────────────────────────────
// The discriminated-union key table. Consumers reference this for typed
// `.on<K extends keyof AgentfootprintEventMap>(type: K, ...)` handlers.
export interface AgentfootprintEventMap {
  // composition
  'agentfootprint.composition.enter': AgentfootprintEventEnvelope<
    'agentfootprint.composition.enter',
    CompositionEnterPayload
  >;
  'agentfootprint.composition.exit': AgentfootprintEventEnvelope<
    'agentfootprint.composition.exit',
    CompositionExitPayload
  >;
  'agentfootprint.composition.fork_start': AgentfootprintEventEnvelope<
    'agentfootprint.composition.fork_start',
    ParallelForkStartPayload
  >;
  'agentfootprint.composition.branch_complete': AgentfootprintEventEnvelope<
    'agentfootprint.composition.branch_complete',
    ParallelBranchCompletePayload
  >;
  'agentfootprint.composition.merge_end': AgentfootprintEventEnvelope<
    'agentfootprint.composition.merge_end',
    ParallelMergeEndPayload
  >;
  'agentfootprint.composition.route_decided': AgentfootprintEventEnvelope<
    'agentfootprint.composition.route_decided',
    ConditionalRouteDecidedPayload
  >;
  'agentfootprint.composition.iteration_start': AgentfootprintEventEnvelope<
    'agentfootprint.composition.iteration_start',
    LoopIterationStartPayload
  >;
  'agentfootprint.composition.iteration_exit': AgentfootprintEventEnvelope<
    'agentfootprint.composition.iteration_exit',
    LoopIterationExitPayload
  >;
  // agent
  'agentfootprint.agent.turn_start': AgentfootprintEventEnvelope<
    'agentfootprint.agent.turn_start',
    AgentTurnStartPayload
  >;
  'agentfootprint.agent.turn_end': AgentfootprintEventEnvelope<
    'agentfootprint.agent.turn_end',
    AgentTurnEndPayload
  >;
  'agentfootprint.agent.iteration_start': AgentfootprintEventEnvelope<
    'agentfootprint.agent.iteration_start',
    AgentIterationStartPayload
  >;
  'agentfootprint.agent.iteration_end': AgentfootprintEventEnvelope<
    'agentfootprint.agent.iteration_end',
    AgentIterationEndPayload
  >;
  'agentfootprint.agent.route_decided': AgentfootprintEventEnvelope<
    'agentfootprint.agent.route_decided',
    AgentRouteDecidedPayload
  >;
  'agentfootprint.agent.handoff': AgentfootprintEventEnvelope<
    'agentfootprint.agent.handoff',
    AgentHandoffPayload
  >;
  // stream
  'agentfootprint.stream.llm_start': AgentfootprintEventEnvelope<
    'agentfootprint.stream.llm_start',
    LLMStartPayload
  >;
  'agentfootprint.stream.llm_end': AgentfootprintEventEnvelope<
    'agentfootprint.stream.llm_end',
    LLMEndPayload
  >;
  'agentfootprint.stream.token': AgentfootprintEventEnvelope<
    'agentfootprint.stream.token',
    LLMTokenPayload
  >;
  'agentfootprint.stream.tool_start': AgentfootprintEventEnvelope<
    'agentfootprint.stream.tool_start',
    ToolStartPayload
  >;
  'agentfootprint.stream.tool_end': AgentfootprintEventEnvelope<
    'agentfootprint.stream.tool_end',
    ToolEndPayload
  >;
  // context (THE CORE)
  'agentfootprint.context.injected': AgentfootprintEventEnvelope<
    'agentfootprint.context.injected',
    ContextInjectedPayload
  >;
  'agentfootprint.context.evicted': AgentfootprintEventEnvelope<
    'agentfootprint.context.evicted',
    ContextEvictedPayload
  >;
  'agentfootprint.context.slot_composed': AgentfootprintEventEnvelope<
    'agentfootprint.context.slot_composed',
    ContextSlotComposedPayload
  >;
  'agentfootprint.context.budget_pressure': AgentfootprintEventEnvelope<
    'agentfootprint.context.budget_pressure',
    ContextBudgetPressurePayload
  >;
  // memory
  'agentfootprint.memory.strategy_applied': AgentfootprintEventEnvelope<
    'agentfootprint.memory.strategy_applied',
    MemoryStrategyAppliedPayload
  >;
  'agentfootprint.memory.attached': AgentfootprintEventEnvelope<
    'agentfootprint.memory.attached',
    MemoryAttachedPayload
  >;
  'agentfootprint.memory.detached': AgentfootprintEventEnvelope<
    'agentfootprint.memory.detached',
    MemoryDetachedPayload
  >;
  'agentfootprint.memory.written': AgentfootprintEventEnvelope<
    'agentfootprint.memory.written',
    MemoryWrittenPayload
  >;
  // tools
  'agentfootprint.tools.offered': AgentfootprintEventEnvelope<
    'agentfootprint.tools.offered',
    ToolsOfferedPayload
  >;
  'agentfootprint.tools.activated': AgentfootprintEventEnvelope<
    'agentfootprint.tools.activated',
    ToolsActivatedPayload
  >;
  'agentfootprint.tools.deactivated': AgentfootprintEventEnvelope<
    'agentfootprint.tools.deactivated',
    ToolsDeactivatedPayload
  >;
  // skill
  'agentfootprint.skill.activated': AgentfootprintEventEnvelope<
    'agentfootprint.skill.activated',
    SkillActivatedPayload
  >;
  'agentfootprint.skill.deactivated': AgentfootprintEventEnvelope<
    'agentfootprint.skill.deactivated',
    SkillDeactivatedPayload
  >;
  // permission
  'agentfootprint.permission.check': AgentfootprintEventEnvelope<
    'agentfootprint.permission.check',
    PermissionCheckPayload
  >;
  'agentfootprint.permission.gate_opened': AgentfootprintEventEnvelope<
    'agentfootprint.permission.gate_opened',
    PermissionGateOpenedPayload
  >;
  'agentfootprint.permission.gate_closed': AgentfootprintEventEnvelope<
    'agentfootprint.permission.gate_closed',
    PermissionGateClosedPayload
  >;
  // risk + fallback
  'agentfootprint.risk.flagged': AgentfootprintEventEnvelope<
    'agentfootprint.risk.flagged',
    RiskFlaggedPayload
  >;
  'agentfootprint.fallback.triggered': AgentfootprintEventEnvelope<
    'agentfootprint.fallback.triggered',
    FallbackTriggeredPayload
  >;
  // cost
  'agentfootprint.cost.tick': AgentfootprintEventEnvelope<
    'agentfootprint.cost.tick',
    CostTickPayload
  >;
  'agentfootprint.cost.limit_hit': AgentfootprintEventEnvelope<
    'agentfootprint.cost.limit_hit',
    CostLimitHitPayload
  >;
  // eval
  'agentfootprint.eval.score': AgentfootprintEventEnvelope<
    'agentfootprint.eval.score',
    EvalScorePayload
  >;
  'agentfootprint.eval.threshold_crossed': AgentfootprintEventEnvelope<
    'agentfootprint.eval.threshold_crossed',
    EvalThresholdCrossedPayload
  >;
  // error
  'agentfootprint.error.retried': AgentfootprintEventEnvelope<
    'agentfootprint.error.retried',
    ErrorRetriedPayload
  >;
  'agentfootprint.error.recovered': AgentfootprintEventEnvelope<
    'agentfootprint.error.recovered',
    ErrorRecoveredPayload
  >;
  'agentfootprint.error.fatal': AgentfootprintEventEnvelope<
    'agentfootprint.error.fatal',
    ErrorFatalPayload
  >;
  // pause
  'agentfootprint.pause.request': AgentfootprintEventEnvelope<
    'agentfootprint.pause.request',
    PauseRequestPayload
  >;
  'agentfootprint.pause.resume': AgentfootprintEventEnvelope<
    'agentfootprint.pause.resume',
    PauseResumePayload
  >;
  // embedding
  'agentfootprint.embedding.generated': AgentfootprintEventEnvelope<
    'agentfootprint.embedding.generated',
    EmbeddingGeneratedPayload
  >;
}

/** Union of every typed event. Consumers use this for exhaustive `switch`. */
export type AgentfootprintEvent = AgentfootprintEventMap[keyof AgentfootprintEventMap];

/** Every known event-type string, useful for runtime lookups / lints. */
export type AgentfootprintEventType = keyof AgentfootprintEventMap;

/**
 * Complete list of every registered event type, for lint / runtime validation.
 * A new event MUST be added here or the exhaustiveness tests fail.
 */
export const ALL_EVENT_TYPES: readonly AgentfootprintEventType[] = [
  'agentfootprint.composition.enter',
  'agentfootprint.composition.exit',
  'agentfootprint.composition.fork_start',
  'agentfootprint.composition.branch_complete',
  'agentfootprint.composition.merge_end',
  'agentfootprint.composition.route_decided',
  'agentfootprint.composition.iteration_start',
  'agentfootprint.composition.iteration_exit',
  'agentfootprint.agent.turn_start',
  'agentfootprint.agent.turn_end',
  'agentfootprint.agent.iteration_start',
  'agentfootprint.agent.iteration_end',
  'agentfootprint.agent.route_decided',
  'agentfootprint.agent.handoff',
  'agentfootprint.stream.llm_start',
  'agentfootprint.stream.llm_end',
  'agentfootprint.stream.token',
  'agentfootprint.stream.tool_start',
  'agentfootprint.stream.tool_end',
  'agentfootprint.context.injected',
  'agentfootprint.context.evicted',
  'agentfootprint.context.slot_composed',
  'agentfootprint.context.budget_pressure',
  'agentfootprint.memory.strategy_applied',
  'agentfootprint.memory.attached',
  'agentfootprint.memory.detached',
  'agentfootprint.memory.written',
  'agentfootprint.tools.offered',
  'agentfootprint.tools.activated',
  'agentfootprint.tools.deactivated',
  'agentfootprint.skill.activated',
  'agentfootprint.skill.deactivated',
  'agentfootprint.permission.check',
  'agentfootprint.permission.gate_opened',
  'agentfootprint.permission.gate_closed',
  'agentfootprint.risk.flagged',
  'agentfootprint.fallback.triggered',
  'agentfootprint.cost.tick',
  'agentfootprint.cost.limit_hit',
  'agentfootprint.eval.score',
  'agentfootprint.eval.threshold_crossed',
  'agentfootprint.error.retried',
  'agentfootprint.error.recovered',
  'agentfootprint.error.fatal',
  'agentfootprint.pause.request',
  'agentfootprint.pause.resume',
  'agentfootprint.embedding.generated',
] as const;
