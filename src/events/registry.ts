/**
 * Event registry — every typed `agentfootprint.*` event (see ALL_EVENT_TYPES;
 * the event/domain counts in the docs are asserted against this file by
 * test/events/unit/registry.test.ts, so don't hardcode counts here).
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
  ContextEvaluatedPayload,
  ContextEvictedPayload,
  ContextInjectedPayload,
  ContextSlotComposedPayload,
  CostLimitHitPayload,
  CostTickPayload,
  EmbeddingGeneratedPayload,
  ErrorCircuitChangedPayload,
  ErrorFatalPayload,
  ErrorRecoveredPayload,
  ErrorRetriedPayload,
  EvalScorePayload,
  EvalThresholdCrossedPayload,
  AgentOutputSchemaValidationFailedPayload,
  AgentOutputContractUnmetPayload,
  AgentOutputSchemaRetryPayload,
  AgentEvidenceCheckedPayload,
  AgentRunConfiguredPayload,
  AgentThinkingParseFailedPayload,
  StreamThinkingDeltaPayload,
  StreamThinkingEndPayload,
  FallbackTriggeredPayload,
  LLMEndPayload,
  LLMStartPayload,
  LLMTokenPayload,
  LoopIterationExitPayload,
  LoopIterationStartPayload,
  MemoryAttachedPayload,
  MemoryDetachedPayload,
  MemoryRetrievedPayload,
  MemoryStrategyAppliedPayload,
  MemoryWrittenPayload,
  ParallelBranchCompletePayload,
  ParallelForkStartPayload,
  ParallelMergeEndPayload,
  PauseRequestPayload,
  PauseResumePayload,
  CheckInRequestPayload,
  CheckInDecisionPayload,
  PermissionCheckPayload,
  PermissionGateClosedPayload,
  PermissionHaltPayload,
  PermissionGateOpenedPayload,
  CredentialRequestedPayload,
  CredentialAcquiredPayload,
  CredentialAuthorizationRequiredPayload,
  CredentialFailedPayload,
  ReliabilityFailFastPayload,
  ReliabilityRetriedPayload,
  ReliabilityRecoveredPayload,
  ResilienceOutputFallbackTriggeredPayload,
  ResilienceOutputCannedUsedPayload,
  RiskFlaggedPayload,
  SkillActivatedPayload,
  SkillDeactivatedPayload,
  SkillEscalatedPayload,
  SkillRejectedPayload,
  SkillRerouteSupersededPayload,
  SkillRouteConflictPayload,
  SkillStepAdvancedPayload,
  SkillStepSkippedPayload,
  SkillStepsUnfinishedPayload,
  SkillTurnRoutedPayload,
  ToolAbsentPayload,
  ToolCoverageDeclaredPayload,
  ToolEffectPayload,
  ToolRepeatedCallPayload,
  ToolResultRefusedPayload,
  ToolEndPayload,
  ToolsActivatedPayload,
  ToolsDeactivatedPayload,
  ToolsDiscoveryStartedPayload,
  ToolsDiscoveryCompletedPayload,
  ToolsDiscoveryFailedPayload,
  ToolsShadowedPayload,
  ToolsSessionStartedPayload,
  ToolsSessionReusedPayload,
  ToolsSessionClosedPayload,
  ToolsSessionCloseFailedPayload,
  ToolsOfferedPayload,
  ToolStartPayload,
  ValidationArgsInvalidPayload,
  MiddlewareDecisionPayload,
  ArtifactMintedPayload,
  ArtifactResolvedPayload,
  ArtifactExpiredPayload,
  ArtifactRefusedPayload,
  ArtifactPresentedPayload,
} from './payloads.js';

// ─── Event type constants ─────────────────────────────────────────────
// Single source of truth for every event name. Low cardinality,
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
    outputSchemaValidationFailed: 'agentfootprint.agent.output_schema_validation_failed',
    outputSchemaRetry: 'agentfootprint.agent.output_schema_retry',
    outputContractUnmet: 'agentfootprint.agent.output_contract_unmet',
    evidenceChecked: 'agentfootprint.agent.evidence_checked',
    runConfigured: 'agentfootprint.agent.run_configured',
    thinkingParseFailed: 'agentfootprint.agent.thinking_parse_failed',
  },
  stream: {
    llmStart: 'agentfootprint.stream.llm_start',
    llmEnd: 'agentfootprint.stream.llm_end',
    token: 'agentfootprint.stream.token',
    toolStart: 'agentfootprint.stream.tool_start',
    toolEnd: 'agentfootprint.stream.tool_end',
    thinkingDelta: 'agentfootprint.stream.thinking_delta',
    thinkingEnd: 'agentfootprint.stream.thinking_end',
  },
  context: {
    injected: 'agentfootprint.context.injected',
    evicted: 'agentfootprint.context.evicted',
    slotComposed: 'agentfootprint.context.slot_composed',
    budgetPressure: 'agentfootprint.context.budget_pressure',
    evaluated: 'agentfootprint.context.evaluated',
  },
  memory: {
    strategyApplied: 'agentfootprint.memory.strategy_applied',
    attached: 'agentfootprint.memory.attached',
    retrieved: 'agentfootprint.memory.retrieved',
    detached: 'agentfootprint.memory.detached',
    written: 'agentfootprint.memory.written',
  },
  tools: {
    offered: 'agentfootprint.tools.offered',
    activated: 'agentfootprint.tools.activated',
    deactivated: 'agentfootprint.tools.deactivated',
    discoveryStarted: 'agentfootprint.tools.discovery_started',
    discoveryCompleted: 'agentfootprint.tools.discovery_completed',
    discoveryFailed: 'agentfootprint.tools.discovery_failed',
    shadowed: 'agentfootprint.tools.shadowed',
    sessionStarted: 'agentfootprint.tools.session_started',
    sessionReused: 'agentfootprint.tools.session_reused',
    sessionClosed: 'agentfootprint.tools.session_closed',
    sessionCloseFailed: 'agentfootprint.tools.session_close_failed',
    effect: 'agentfootprint.tools.effect',
    resultRefused: 'agentfootprint.tools.result_refused',
    repeatedCall: 'agentfootprint.tools.repeated_call',
    absent: 'agentfootprint.tools.absent',
    coverageDeclared: 'agentfootprint.tools.coverage_declared',
  },
  skill: {
    activated: 'agentfootprint.skill.activated',
    deactivated: 'agentfootprint.skill.deactivated',
    rejected: 'agentfootprint.skill.rejected',
    rerouteSuperseded: 'agentfootprint.skill.reroute_superseded',
    routeConflict: 'agentfootprint.skill.route_conflict',
    turnRouted: 'agentfootprint.skill.turn_routed',
    stepAdvanced: 'agentfootprint.skill.step_advanced',
    stepSkipped: 'agentfootprint.skill.step_skipped',
    stepsUnfinished: 'agentfootprint.skill.steps_unfinished',
    escalated: 'agentfootprint.skill.escalated',
  },
  validation: {
    argsInvalid: 'agentfootprint.validation.args_invalid',
  },
  permission: {
    check: 'agentfootprint.permission.check',
    gateOpened: 'agentfootprint.permission.gate_opened',
    gateClosed: 'agentfootprint.permission.gate_closed',
    halt: 'agentfootprint.permission.halt',
  },
  credential: {
    requested: 'agentfootprint.credential.requested',
    acquired: 'agentfootprint.credential.acquired',
    authorizationRequired: 'agentfootprint.credential.authorization_required',
    failed: 'agentfootprint.credential.failed',
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
    circuitChanged: 'agentfootprint.error.circuit_changed',
  },
  reliability: {
    failFast: 'agentfootprint.reliability.fail_fast',
    retried: 'agentfootprint.reliability.retried',
    recovered: 'agentfootprint.reliability.recovered',
  },
  resilience: {
    outputFallbackTriggered: 'agentfootprint.resilience.output_fallback_triggered',
    outputCannedUsed: 'agentfootprint.resilience.output_canned_used',
  },
  pause: {
    request: 'agentfootprint.pause.request',
    resume: 'agentfootprint.pause.resume',
  },
  checkin: {
    request: 'agentfootprint.checkin.request',
    decision: 'agentfootprint.checkin.decision',
  },
  middleware: {
    decision: 'agentfootprint.middleware.decision',
  },
  embedding: {
    generated: 'agentfootprint.embedding.generated',
  },
  artifacts: {
    minted: 'agentfootprint.artifacts.minted',
    resolved: 'agentfootprint.artifacts.resolved',
    expired: 'agentfootprint.artifacts.expired',
    refused: 'agentfootprint.artifacts.refused',
    presented: 'agentfootprint.artifacts.presented',
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
  'agentfootprint.agent.output_schema_validation_failed': AgentfootprintEventEnvelope<
    'agentfootprint.agent.output_schema_validation_failed',
    AgentOutputSchemaValidationFailedPayload
  >;
  'agentfootprint.agent.output_contract_unmet': AgentfootprintEventEnvelope<
    'agentfootprint.agent.output_contract_unmet',
    AgentOutputContractUnmetPayload
  >;
  'agentfootprint.agent.output_schema_retry': AgentfootprintEventEnvelope<
    'agentfootprint.agent.output_schema_retry',
    AgentOutputSchemaRetryPayload
  >;
  'agentfootprint.agent.evidence_checked': AgentfootprintEventEnvelope<
    'agentfootprint.agent.evidence_checked',
    AgentEvidenceCheckedPayload
  >;
  'agentfootprint.agent.run_configured': AgentfootprintEventEnvelope<
    'agentfootprint.agent.run_configured',
    AgentRunConfiguredPayload
  >;
  'agentfootprint.agent.thinking_parse_failed': AgentfootprintEventEnvelope<
    'agentfootprint.agent.thinking_parse_failed',
    AgentThinkingParseFailedPayload
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
  'agentfootprint.stream.thinking_delta': AgentfootprintEventEnvelope<
    'agentfootprint.stream.thinking_delta',
    StreamThinkingDeltaPayload
  >;
  'agentfootprint.stream.thinking_end': AgentfootprintEventEnvelope<
    'agentfootprint.stream.thinking_end',
    StreamThinkingEndPayload
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
  'agentfootprint.context.evaluated': AgentfootprintEventEnvelope<
    'agentfootprint.context.evaluated',
    ContextEvaluatedPayload
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
  'agentfootprint.memory.retrieved': AgentfootprintEventEnvelope<
    'agentfootprint.memory.retrieved',
    MemoryRetrievedPayload
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
  'agentfootprint.tools.discovery_started': AgentfootprintEventEnvelope<
    'agentfootprint.tools.discovery_started',
    ToolsDiscoveryStartedPayload
  >;
  'agentfootprint.tools.discovery_completed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.discovery_completed',
    ToolsDiscoveryCompletedPayload
  >;
  'agentfootprint.tools.discovery_failed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.discovery_failed',
    ToolsDiscoveryFailedPayload
  >;
  'agentfootprint.tools.shadowed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.shadowed',
    ToolsShadowedPayload
  >;
  'agentfootprint.tools.session_started': AgentfootprintEventEnvelope<
    'agentfootprint.tools.session_started',
    ToolsSessionStartedPayload
  >;
  'agentfootprint.tools.session_reused': AgentfootprintEventEnvelope<
    'agentfootprint.tools.session_reused',
    ToolsSessionReusedPayload
  >;
  'agentfootprint.tools.session_closed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.session_closed',
    ToolsSessionClosedPayload
  >;
  'agentfootprint.tools.effect': AgentfootprintEventEnvelope<
    'agentfootprint.tools.effect',
    ToolEffectPayload
  >;
  'agentfootprint.tools.result_refused': AgentfootprintEventEnvelope<
    'agentfootprint.tools.result_refused',
    ToolResultRefusedPayload
  >;
  'agentfootprint.tools.repeated_call': AgentfootprintEventEnvelope<
    'agentfootprint.tools.repeated_call',
    ToolRepeatedCallPayload
  >;
  'agentfootprint.tools.absent': AgentfootprintEventEnvelope<
    'agentfootprint.tools.absent',
    ToolAbsentPayload
  >;
  'agentfootprint.tools.coverage_declared': AgentfootprintEventEnvelope<
    'agentfootprint.tools.coverage_declared',
    ToolCoverageDeclaredPayload
  >;
  'agentfootprint.tools.session_close_failed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.session_close_failed',
    ToolsSessionCloseFailedPayload
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
  'agentfootprint.skill.rejected': AgentfootprintEventEnvelope<
    'agentfootprint.skill.rejected',
    SkillRejectedPayload
  >;
  'agentfootprint.skill.reroute_superseded': AgentfootprintEventEnvelope<
    'agentfootprint.skill.reroute_superseded',
    SkillRerouteSupersededPayload
  >;
  'agentfootprint.skill.route_conflict': AgentfootprintEventEnvelope<
    'agentfootprint.skill.route_conflict',
    SkillRouteConflictPayload
  >;
  'agentfootprint.skill.turn_routed': AgentfootprintEventEnvelope<
    'agentfootprint.skill.turn_routed',
    SkillTurnRoutedPayload
  >;
  'agentfootprint.skill.step_advanced': AgentfootprintEventEnvelope<
    'agentfootprint.skill.step_advanced',
    SkillStepAdvancedPayload
  >;
  'agentfootprint.skill.step_skipped': AgentfootprintEventEnvelope<
    'agentfootprint.skill.step_skipped',
    SkillStepSkippedPayload
  >;
  'agentfootprint.skill.steps_unfinished': AgentfootprintEventEnvelope<
    'agentfootprint.skill.steps_unfinished',
    SkillStepsUnfinishedPayload
  >;
  'agentfootprint.skill.escalated': AgentfootprintEventEnvelope<
    'agentfootprint.skill.escalated',
    SkillEscalatedPayload
  >;
  // validation
  'agentfootprint.validation.args_invalid': AgentfootprintEventEnvelope<
    'agentfootprint.validation.args_invalid',
    ValidationArgsInvalidPayload
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
  'agentfootprint.permission.halt': AgentfootprintEventEnvelope<
    'agentfootprint.permission.halt',
    PermissionHaltPayload
  >;
  // credential (declare-and-push)
  'agentfootprint.credential.requested': AgentfootprintEventEnvelope<
    'agentfootprint.credential.requested',
    CredentialRequestedPayload
  >;
  'agentfootprint.credential.acquired': AgentfootprintEventEnvelope<
    'agentfootprint.credential.acquired',
    CredentialAcquiredPayload
  >;
  'agentfootprint.credential.authorization_required': AgentfootprintEventEnvelope<
    'agentfootprint.credential.authorization_required',
    CredentialAuthorizationRequiredPayload
  >;
  'agentfootprint.credential.failed': AgentfootprintEventEnvelope<
    'agentfootprint.credential.failed',
    CredentialFailedPayload
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
  'agentfootprint.error.circuit_changed': AgentfootprintEventEnvelope<
    'agentfootprint.error.circuit_changed',
    ErrorCircuitChangedPayload
  >;
  // reliability (rules-based loop — distinct from error.* which is decorator-shaped)
  'agentfootprint.reliability.fail_fast': AgentfootprintEventEnvelope<
    'agentfootprint.reliability.fail_fast',
    ReliabilityFailFastPayload
  >;
  'agentfootprint.reliability.retried': AgentfootprintEventEnvelope<
    'agentfootprint.reliability.retried',
    ReliabilityRetriedPayload
  >;
  'agentfootprint.reliability.recovered': AgentfootprintEventEnvelope<
    'agentfootprint.reliability.recovered',
    ReliabilityRecoveredPayload
  >;
  // resilience (the outputSchema fallback ladder — tiers 2 and 3)
  'agentfootprint.resilience.output_fallback_triggered': AgentfootprintEventEnvelope<
    'agentfootprint.resilience.output_fallback_triggered',
    ResilienceOutputFallbackTriggeredPayload
  >;
  'agentfootprint.resilience.output_canned_used': AgentfootprintEventEnvelope<
    'agentfootprint.resilience.output_canned_used',
    ResilienceOutputCannedUsedPayload
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
  // check-in (evidence-carrying human consent)
  'agentfootprint.checkin.request': AgentfootprintEventEnvelope<
    'agentfootprint.checkin.request',
    CheckInRequestPayload
  >;
  'agentfootprint.checkin.decision': AgentfootprintEventEnvelope<
    'agentfootprint.checkin.decision',
    CheckInDecisionPayload
  >;
  // middleware (the governance chains)
  'agentfootprint.middleware.decision': AgentfootprintEventEnvelope<
    'agentfootprint.middleware.decision',
    MiddlewareDecisionPayload
  >;
  // embedding
  'agentfootprint.embedding.generated': AgentfootprintEventEnvelope<
    'agentfootprint.embedding.generated',
    EmbeddingGeneratedPayload
  >;
  // artifacts (the claim-check lifecycle — meta only, never payload bytes)
  'agentfootprint.artifacts.minted': AgentfootprintEventEnvelope<
    'agentfootprint.artifacts.minted',
    ArtifactMintedPayload
  >;
  'agentfootprint.artifacts.resolved': AgentfootprintEventEnvelope<
    'agentfootprint.artifacts.resolved',
    ArtifactResolvedPayload
  >;
  'agentfootprint.artifacts.expired': AgentfootprintEventEnvelope<
    'agentfootprint.artifacts.expired',
    ArtifactExpiredPayload
  >;
  'agentfootprint.artifacts.refused': AgentfootprintEventEnvelope<
    'agentfootprint.artifacts.refused',
    ArtifactRefusedPayload
  >;
  'agentfootprint.artifacts.presented': AgentfootprintEventEnvelope<
    'agentfootprint.artifacts.presented',
    ArtifactPresentedPayload
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
  'agentfootprint.agent.output_schema_validation_failed',
  'agentfootprint.agent.output_schema_retry',
  'agentfootprint.agent.output_contract_unmet',
  'agentfootprint.agent.evidence_checked',
  'agentfootprint.agent.run_configured',
  'agentfootprint.agent.thinking_parse_failed',
  'agentfootprint.stream.llm_start',
  'agentfootprint.stream.llm_end',
  'agentfootprint.stream.token',
  'agentfootprint.stream.tool_start',
  'agentfootprint.stream.tool_end',
  'agentfootprint.stream.thinking_delta',
  'agentfootprint.stream.thinking_end',
  'agentfootprint.context.injected',
  'agentfootprint.context.evicted',
  'agentfootprint.context.slot_composed',
  'agentfootprint.context.budget_pressure',
  'agentfootprint.context.evaluated',
  'agentfootprint.memory.strategy_applied',
  'agentfootprint.memory.attached',
  'agentfootprint.memory.retrieved',
  'agentfootprint.memory.detached',
  'agentfootprint.memory.written',
  'agentfootprint.tools.offered',
  'agentfootprint.tools.activated',
  'agentfootprint.tools.deactivated',
  'agentfootprint.tools.discovery_started',
  'agentfootprint.tools.discovery_completed',
  'agentfootprint.tools.discovery_failed',
  'agentfootprint.tools.shadowed',
  'agentfootprint.tools.session_started',
  'agentfootprint.tools.session_reused',
  'agentfootprint.tools.session_closed',
  'agentfootprint.tools.session_close_failed',
  'agentfootprint.tools.effect',
  'agentfootprint.tools.result_refused',
  'agentfootprint.tools.repeated_call',
  'agentfootprint.tools.absent',
  'agentfootprint.tools.coverage_declared',
  'agentfootprint.validation.args_invalid',
  'agentfootprint.skill.activated',
  'agentfootprint.skill.deactivated',
  'agentfootprint.skill.rejected',
  'agentfootprint.skill.reroute_superseded',
  'agentfootprint.skill.route_conflict',
  'agentfootprint.skill.turn_routed',
  'agentfootprint.skill.step_advanced',
  'agentfootprint.skill.step_skipped',
  'agentfootprint.skill.steps_unfinished',
  'agentfootprint.skill.escalated',
  'agentfootprint.permission.check',
  'agentfootprint.permission.gate_opened',
  'agentfootprint.permission.gate_closed',
  'agentfootprint.permission.halt',
  'agentfootprint.credential.requested',
  'agentfootprint.credential.acquired',
  'agentfootprint.credential.authorization_required',
  'agentfootprint.credential.failed',
  'agentfootprint.risk.flagged',
  'agentfootprint.fallback.triggered',
  'agentfootprint.cost.tick',
  'agentfootprint.cost.limit_hit',
  'agentfootprint.eval.score',
  'agentfootprint.eval.threshold_crossed',
  'agentfootprint.error.retried',
  'agentfootprint.error.recovered',
  'agentfootprint.error.fatal',
  'agentfootprint.error.circuit_changed',
  'agentfootprint.reliability.fail_fast',
  'agentfootprint.reliability.retried',
  'agentfootprint.reliability.recovered',
  'agentfootprint.resilience.output_fallback_triggered',
  'agentfootprint.resilience.output_canned_used',
  'agentfootprint.pause.request',
  'agentfootprint.pause.resume',
  'agentfootprint.checkin.request',
  'agentfootprint.checkin.decision',
  'agentfootprint.middleware.decision',
  'agentfootprint.embedding.generated',
  'agentfootprint.artifacts.minted',
  'agentfootprint.artifacts.resolved',
  'agentfootprint.artifacts.expired',
  'agentfootprint.artifacts.refused',
  'agentfootprint.artifacts.presented',
] as const;
