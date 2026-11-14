/**
 * Public event payload contracts, typed factories and exhaustive event names.
 * Registry tests derive counts here; consumers subscribe with on(type, listener).
 * Breaking payload changes require a major version.
 */

import type { AgentfootprintEventEnvelope } from './types.js';
import type {
  AgentHandoffPayload,
  AgentIterationEndPayload,
  AgentIterationStartPayload,
  AgentAroundTurnFailedPayload,
  AgentBudgetExhaustedPayload,
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
  ContextRecordedPayload,
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
  AgentGroundingNudgedPayload,
  AgentRunConfiguredPayload,
  AgentThinkingParseFailedPayload,
  AgentThinkingOmittedPayload,
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
  SkillActivatedPayload,
  SkillDeactivatedPayload,
  SkillEscalatedPayload,
  SkillGraphDeclaredPayload,
  SkillRejectedPayload,
  SkillRerouteSupersededPayload,
  SkillRouteConflictPayload,
  SkillStepAdvancedPayload,
  SkillStepSkippedPayload,
  SkillStepsUnfinishedPayload,
  SkillTurnRoutedPayload,
  ToolAbsentPayload,
  ToolCoverageDeclaredPayload,
  ToolSemanticsDeclaredPayload,
  ToolsCodeRunPayload,
  ToolsRequestAttemptsPayload,
  ToolsMcpClientPayload,
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
  ToolsClaimSwallowedPayload,
  ToolsAnsweredOffWirePayload,
  ToolsSessionStartedPayload,
  ToolsSessionReusedPayload,
  ToolsSessionClosedPayload,
  ToolsSessionCloseFailedPayload,
  ToolsOfferedPayload,
  ToolProgressPayload,
  ToolStartPayload,
  ValidationArgsInvalidPayload,
  MiddlewareDecisionPayload,
  FindingsDeclaredPayload,
  FindingsStandingPayload,
  FindingsJudgedPayload,
  FindingsJudgeFailedPayload,
  FindingsContingentPayload,
  FindingsArgumentPayload,
  FindingsPeriodPayload,
  FindingsNegativeClaimPayload,
  ToolChoicePickedPayload,
  ToolChoiceOutcomePayload,
  ToolChoiceFailedPayload,
  OntologyServedPayload,
  AnswerAssessedPayload,
  ArtifactMintedPayload,
  ArtifactResolvedPayload,
  ArtifactExpiredPayload,
  ArtifactRefusedPayload,
  ArtifactHandOverFailedPayload,
  ArtifactPresentedPayload,
  MapEngagedPayload,
  MapParkedPayload,
  IntegrityContextErrorPayload,
  IntegrityDispositionPayload,
  IntegrityExternalGroundUsedPayload,
} from './payloads.js';

export { EVENT_NAMES } from './registry/names.js';

// ─── Event type → payload: the key table typed `.on(type, ...)` reads ───
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
  'agentfootprint.agent.grounding_nudged': AgentfootprintEventEnvelope<
    'agentfootprint.agent.grounding_nudged',
    AgentGroundingNudgedPayload
  >;
  'agentfootprint.agent.run_configured': AgentfootprintEventEnvelope<
    'agentfootprint.agent.run_configured',
    AgentRunConfiguredPayload
  >;
  'agentfootprint.agent.thinking_parse_failed': AgentfootprintEventEnvelope<
    'agentfootprint.agent.thinking_parse_failed',
    AgentThinkingParseFailedPayload
  >;
  'agentfootprint.agent.thinking_omitted': AgentfootprintEventEnvelope<
    'agentfootprint.agent.thinking_omitted',
    AgentThinkingOmittedPayload
  >;
  'agentfootprint.agent.budget_exhausted': AgentfootprintEventEnvelope<
    'agentfootprint.agent.budget_exhausted',
    AgentBudgetExhaustedPayload
  >;
  'agentfootprint.agent.around_turn_failed': AgentfootprintEventEnvelope<
    'agentfootprint.agent.around_turn_failed',
    AgentAroundTurnFailedPayload
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
  'agentfootprint.stream.tool_progress': AgentfootprintEventEnvelope<
    'agentfootprint.stream.tool_progress',
    ToolProgressPayload
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
  'agentfootprint.context.recorded': AgentfootprintEventEnvelope<
    'agentfootprint.context.recorded',
    ContextRecordedPayload
  >;
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
  'agentfootprint.tools.claim_swallowed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.claim_swallowed',
    ToolsClaimSwallowedPayload
  >;
  'agentfootprint.tools.answered_off_wire': AgentfootprintEventEnvelope<
    'agentfootprint.tools.answered_off_wire',
    ToolsAnsweredOffWirePayload
  >;
  'agentfootprint.tools.resource_restore': AgentfootprintEventEnvelope<
    'agentfootprint.tools.resource_restore',
    {
      readonly local: 'retained' | 'none-known-locally' | 'unconfirmed';
      readonly remote: 'unknown';
    }
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
  'agentfootprint.tools.code_run': AgentfootprintEventEnvelope<
    'agentfootprint.tools.code_run',
    ToolsCodeRunPayload
  >;
  'agentfootprint.tools.request_attempts': AgentfootprintEventEnvelope<
    'agentfootprint.tools.request_attempts',
    ToolsRequestAttemptsPayload
  >;
  'agentfootprint.tools.mcp_client': AgentfootprintEventEnvelope<
    'agentfootprint.tools.mcp_client',
    ToolsMcpClientPayload
  >;
  'agentfootprint.tools.coverage_declared': AgentfootprintEventEnvelope<
    'agentfootprint.tools.coverage_declared',
    ToolCoverageDeclaredPayload
  >;
  'agentfootprint.tools.semantics_declared': AgentfootprintEventEnvelope<
    'agentfootprint.tools.semantics_declared',
    ToolSemanticsDeclaredPayload
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
  'agentfootprint.skill.graph_declared': AgentfootprintEventEnvelope<
    'agentfootprint.skill.graph_declared',
    SkillGraphDeclaredPayload
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
  // fallback
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
  // findings (the model's standings on the record — identities, enums, counts)
  'agentfootprint.findings.declared': AgentfootprintEventEnvelope<
    'agentfootprint.findings.declared',
    FindingsDeclaredPayload
  >;
  'agentfootprint.findings.standing': AgentfootprintEventEnvelope<
    'agentfootprint.findings.standing',
    FindingsStandingPayload
  >;
  'agentfootprint.findings.judged': AgentfootprintEventEnvelope<
    'agentfootprint.findings.judged',
    FindingsJudgedPayload
  >;
  'agentfootprint.findings.judge_failed': AgentfootprintEventEnvelope<
    'agentfootprint.findings.judge_failed',
    FindingsJudgeFailedPayload
  >;
  'agentfootprint.findings.contingent': AgentfootprintEventEnvelope<
    'agentfootprint.findings.contingent',
    FindingsContingentPayload
  >;
  'agentfootprint.findings.argument': AgentfootprintEventEnvelope<
    'agentfootprint.findings.argument',
    FindingsArgumentPayload
  >;
  'agentfootprint.findings.period': AgentfootprintEventEnvelope<
    'agentfootprint.findings.period',
    FindingsPeriodPayload
  >;
  'agentfootprint.findings.negative_claim': AgentfootprintEventEnvelope<
    'agentfootprint.findings.negative_claim',
    FindingsNegativeClaimPayload
  >;
  // tool_choice (a classifier's pick beside the model's call — identities, numbers, a boolean)
  'agentfootprint.tool_choice.picked': AgentfootprintEventEnvelope<
    'agentfootprint.tool_choice.picked',
    ToolChoicePickedPayload
  >;
  'agentfootprint.tool_choice.outcome': AgentfootprintEventEnvelope<
    'agentfootprint.tool_choice.outcome',
    ToolChoiceOutcomePayload
  >;
  'agentfootprint.tool_choice.failed': AgentfootprintEventEnvelope<
    'agentfootprint.tool_choice.failed',
    ToolChoiceFailedPayload
  >;
  // ontology (the declared map served on a call — identities and counts only)
  'agentfootprint.ontology.served': AgentfootprintEventEnvelope<
    'agentfootprint.ontology.served',
    OntologyServedPayload
  >;
  // answer (the answer layer's standing — the value, the reason kinds, the checks that ran)
  'agentfootprint.answer.assessed': AgentfootprintEventEnvelope<
    'agentfootprint.answer.assessed',
    AnswerAssessedPayload
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
  'agentfootprint.artifacts.hand_over_failed': AgentfootprintEventEnvelope<
    'agentfootprint.artifacts.hand_over_failed',
    ArtifactHandOverFailedPayload
  >;
  'agentfootprint.map.engaged': AgentfootprintEventEnvelope<
    'agentfootprint.map.engaged',
    MapEngagedPayload
  >;
  'agentfootprint.map.parked': AgentfootprintEventEnvelope<
    'agentfootprint.map.parked',
    MapParkedPayload
  >;
  'agentfootprint.integrity.context_error': AgentfootprintEventEnvelope<
    'agentfootprint.integrity.context_error',
    IntegrityContextErrorPayload
  >;
  'agentfootprint.integrity.disposition': AgentfootprintEventEnvelope<
    'agentfootprint.integrity.disposition',
    IntegrityDispositionPayload
  >;
  'agentfootprint.integrity.external_ground_used': AgentfootprintEventEnvelope<
    'agentfootprint.integrity.external_ground_used',
    IntegrityExternalGroundUsedPayload
  >;
}

/** Union of every typed event. Consumers use this for exhaustive `switch`. */
export type AgentfootprintEvent = AgentfootprintEventMap[keyof AgentfootprintEventMap];

/** Every known event-type string, useful for runtime lookups / lints. */
export type AgentfootprintEventType = keyof AgentfootprintEventMap;

/** Every registered event type. A new event MUST be added or exhaustiveness tests fail. */
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
  'agentfootprint.agent.grounding_nudged',
  'agentfootprint.agent.run_configured',
  'agentfootprint.agent.thinking_parse_failed',
  'agentfootprint.agent.thinking_omitted',
  'agentfootprint.agent.budget_exhausted',
  'agentfootprint.agent.around_turn_failed',
  'agentfootprint.stream.llm_start',
  'agentfootprint.stream.llm_end',
  'agentfootprint.stream.token',
  'agentfootprint.stream.tool_start',
  'agentfootprint.stream.tool_progress',
  'agentfootprint.stream.tool_end',
  'agentfootprint.stream.thinking_delta',
  'agentfootprint.stream.thinking_end',
  'agentfootprint.context.recorded',
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
  'agentfootprint.tools.claim_swallowed',
  'agentfootprint.tools.answered_off_wire',
  'agentfootprint.tools.resource_restore',
  'agentfootprint.tools.session_started',
  'agentfootprint.tools.session_reused',
  'agentfootprint.tools.session_closed',
  'agentfootprint.tools.session_close_failed',
  'agentfootprint.tools.effect',
  'agentfootprint.tools.result_refused',
  'agentfootprint.tools.repeated_call',
  'agentfootprint.tools.absent',
  'agentfootprint.tools.code_run',
  'agentfootprint.tools.request_attempts',
  'agentfootprint.tools.mcp_client',
  'agentfootprint.tools.coverage_declared',
  'agentfootprint.tools.semantics_declared',
  'agentfootprint.validation.args_invalid',
  'agentfootprint.skill.activated',
  'agentfootprint.skill.graph_declared',
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
  'agentfootprint.findings.declared',
  'agentfootprint.findings.standing',
  'agentfootprint.findings.judged',
  'agentfootprint.findings.judge_failed',
  'agentfootprint.findings.contingent',
  'agentfootprint.findings.argument',
  'agentfootprint.findings.period',
  'agentfootprint.findings.negative_claim',
  'agentfootprint.tool_choice.picked',
  'agentfootprint.tool_choice.outcome',
  'agentfootprint.tool_choice.failed',
  'agentfootprint.ontology.served',
  'agentfootprint.answer.assessed',
  'agentfootprint.embedding.generated',
  'agentfootprint.artifacts.minted',
  'agentfootprint.artifacts.resolved',
  'agentfootprint.artifacts.expired',
  'agentfootprint.artifacts.refused',
  'agentfootprint.artifacts.presented',
  'agentfootprint.artifacts.hand_over_failed',
  'agentfootprint.map.engaged',
  'agentfootprint.map.parked',
  'agentfootprint.integrity.context_error',
  'agentfootprint.integrity.disposition',
  'agentfootprint.integrity.external_ground_used',
] as const;
