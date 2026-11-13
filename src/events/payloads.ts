/**
 * Event payload types — the payload interfaces behind the registered events
 * (never a hardcoded count here: the registry's counts are pinned by
 * test/events/unit/registry.test.ts).
 *
 * Pattern: Discriminated Union (Gang of Four inspired, TS-native).
 * Role:    Contract layer of Event-Driven Hexagonal Architecture.
 * Emits:   (types only).
 */

export type {
  CompositionEnterPayload,
  CompositionExitPayload,
  ParallelForkStartPayload,
  ParallelBranchCompletePayload,
  ParallelMergeEndPayload,
  ConditionalRouteDecidedPayload,
  LoopIterationStartPayload,
  LoopIterationExitPayload,
} from './payloads/flow.js';
export type {
  AgentTurnStartPayload,
  AgentTurnEndPayload,
  AgentBudgetExhaustedPayload,
  AgentIterationStartPayload,
  AgentIterationEndPayload,
  FixedRouteRationale,
  FixedPauseReason,
  AgentRouteDecidedPayload,
  AgentHandoffPayload,
  AgentAroundTurnFailedPayload,
} from './payloads/agent.js';
export type {
  LLMStartPayload,
  LLMEndPayload,
  LLMTokenPayload,
  ToolStartPayload,
  ToolProgressPayload,
  ToolEndPayload,
} from './payloads/stream.js';
export type {
  ContextInjectedPayload,
  ContextEvictedPayload,
  ContextSlotComposedPayload,
  ContextBudgetPressurePayload,
  SkillGuardValueRecord,
  SkillGuardEvaluationRecord,
  ContextEvaluatedPayload,
} from './payloads/context.js';
export type {
  ErrorFatalPayload,
  PauseRequestPayload,
  PauseResumePayload,
  CheckInRequestPayload,
  CheckInDecisionPayload,
  MiddlewareDecisionPayload,
} from './payloads/consent.js';
export type {
  FindingsDeclaredPayload,
  FindingsStandingPayload,
  FindingsJudgedPayload,
  FindingsJudgeFailedPayload,
  FindingsContingentPayload,
  FindingsArgumentPayload,
  FindingsPeriodPayload,
  FindingsNegativeClaimPayload,
} from './payloads/findings.js';
export type {
  ToolChoicePickedPayload,
  ToolChoiceOutcomePayload,
  ToolChoiceFailedPayload,
  OntologyServedPayload,
} from './payloads/toolChoice.js';
export type {
  AnswerAssessmentPayload,
  AnswerAssessedPayload,
  DeliveredNegative,
  AnswerNegativesPayload,
} from './payloads/answer.js';
export type {
  MemoryStrategyAppliedPayload,
  MemoryAttachedPayload,
  RetrievedCandidatePayload,
  MemoryRetrievedPayload,
  MemoryDetachedPayload,
  MemoryWrittenPayload,
} from './payloads/memory.js';
export type {
  ToolsOfferedPayload,
  ToolsActivatedPayload,
  ToolsDeactivatedPayload,
  ToolsDiscoveryStartedPayload,
  ToolsDiscoveryCompletedPayload,
  ToolsDiscoveryFailedPayload,
  ToolNameChannel,
  ToolsShadowedPayload,
  ToolsClaimSwallowedPayload,
  ToolsAnsweredOffWirePayload,
} from './payloads/toolCatalog.js';
export type {
  ToolsSessionStartedPayload,
  ToolsSessionReusedPayload,
  ToolsSessionClosedPayload,
  ToolsSessionCloseFailedPayload,
} from './payloads/toolSessionPayloads.js';
export type { ValidationArgsInvalidPayload } from './payloads/validation.js';
export type {
  SkillTurnRoutedPayload,
  SkillActivatedPayload,
  SkillDeactivatedPayload,
  SkillRerouteSupersededPayload,
  SkillGraphDeclaredPayload,
  SkillRejectedPayload,
  SkillRouteConflictPayload,
  SkillStepAdvancedPayload,
  SkillStepHeldPayload,
  SkillStepSkippedPayload,
  SkillStepsUnfinishedPayload,
  SkillEscalatedPayload,
} from './payloads/skills.js';
export type {
  ToolEffectPayload,
  ToolResultRefusedPayload,
  ToolRepeatedCallPayload,
  ToolAbsentPayload,
  CoverageFieldReference,
  CoverageFacetReferencePayload,
  CoverageGapPayload,
  CoverageCompositionPayload,
  ProvenancePayload,
  PeriodPayload,
  TryInsteadToolPayload,
  ToolsCodeRunPayload,
} from './payloads/toolEffects.js';
export type {
  ToolsMcpClientPayload,
  ToolRequestAttemptOutcome,
  ToolRequestOutcome,
  ToolRequestRemote,
  ToolRequestReason,
  ToolRequestRefusalKind,
  ToolRequestEffect,
  ToolRequestReplayKind,
  ToolRequestPermission,
  ToolRequestFailureCategory,
  ToolRequestError,
  ToolRequestAttempt,
  ToolRequestEnd,
  ToolsRequestAttemptsPayload,
} from './payloads/mcpRequests.js';
export type {
  ToolCoverageDeclaredPayload,
  InProgressItemPayload,
  CoverageItemPayload,
  ToolSemanticsDeclaredPayload,
} from './payloads/toolSemantics.js';
export type {
  PermissionCheckPayload,
  PermissionGateOpenedPayload,
  CredentialRequestedPayload,
  CredentialAcquiredPayload,
  CredentialAuthorizationRequiredPayload,
  CredentialFailedPayload,
  PermissionGateClosedPayload,
  PermissionHaltPayload,
} from './payloads/access.js';
export type { FallbackTriggeredPayload } from './payloads/fallback.js';
export type { CostTickPayload, CostLimitHitPayload } from './payloads/cost.js';
export type {
  EvalScorePayload,
  EvalThresholdCrossedPayload,
  AgentOutputContractUnmetPayload,
  AgentOutputSchemaRetryPayload,
  AgentEvidenceCheckedPayload,
  AgentGroundingNudgedPayload,
} from './payloads/evaluation.js';
export type {
  RunConfiguredLlmPayload,
  RunConfiguredMemoryPayload,
  RunConfiguredSkillGraphPayload,
  RunConfiguredArtifactsPayload,
  RunConfiguredRecipePayload,
  AgentRunConfiguredPayload,
  AgentOutputSchemaValidationFailedPayload,
} from './payloads/runConfiguration.js';
export type {
  ErrorRetriedPayload,
  ErrorRecoveredPayload,
  ErrorCircuitChangedPayload,
  ReliabilityFailFastPayload,
  ReliabilityRetriedPayload,
  ReliabilityRecoveredPayload,
  ResilienceOutputFallbackTriggeredPayload,
  ResilienceOutputCannedUsedPayload,
} from './payloads/reliability.js';
export type {
  EmbeddingGeneratedPayload,
  StreamThinkingDeltaPayload,
  StreamThinkingEndPayload,
  AgentThinkingParseFailedPayload,
  AgentThinkingOmittedPayload,
} from './payloads/thinking.js';
export type {
  ArtifactMintedPayload,
  ArtifactResolvedPayload,
  ArtifactExpiredPayload,
  ArtifactRefusedPayload,
  ArtifactHandOverFailureCause,
  ArtifactHandOverFailedPayload,
  ArtifactPresentedPayload,
} from './payloads/artifacts.js';
export type { MapEngagedPayload, MapParkedPayload } from './payloads/maps.js';
export type {
  IntegrityContextErrorPayload,
  IntegrityDispositionPayload,
  IntegrityExternalGroundUsedPayload,
} from './payloads/integrity.js';
