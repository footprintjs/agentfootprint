/**
 * recorders/v2/ — AgentRecorder implementations.
 *
 * These implement the new AgentRecorder interface from core/.
 * The existing recorders (LLMRecorder, CostRecorder, RAGRecorder)
 * implement footprintjs's scope Recorder interface and remain unchanged.
 */

export { TokenRecorder } from './TokenRecorder';
export type { TokenStats, LLMCallEntry } from './TokenRecorder';
export { CostRecorder } from './CostRecorder';
/** @deprecated Use CostRecorder instead. */
export { CostRecorder as CostRecorderV2 } from './CostRecorder';
export type {
  CostEntry,
  CostRecorderOptions,
  ModelPricing,
} from './CostRecorder';
/** @deprecated Use CostEntry instead. */
export type { CostEntry as CostEntryV2, CostRecorderOptions as CostRecorderOptionsV2 } from './CostRecorder';
export { ToolUsageRecorder } from './ToolUsageRecorder';
export type { ToolUsageStats, ToolStats } from './ToolUsageRecorder';
export { TurnRecorder } from './TurnRecorder';
export type { TurnEntry } from './TurnRecorder';
export { QualityRecorder } from './QualityRecorder';
export type { QualityScore, QualityJudge } from './QualityRecorder';
export { GuardrailRecorder } from './GuardrailRecorder';
export type { Violation, GuardrailCheck } from './GuardrailRecorder';
export { CompositeRecorder } from './CompositeRecorder';
