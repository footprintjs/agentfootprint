export { quickBind } from './types';
export type {
  LLMInstruction,
  FollowUpBinding,
  InstructionContext,
  RuntimeFollowUp,
  InstructedToolResult,
  InstructedToolDefinition,
} from './types';

export { evaluateInstructions, mergeRuntimeInstructions } from './evaluator';
export type { ResolvedInstruction, ResolvedFollowUp } from './evaluator';

export { renderInstructions } from './template';
export type { InstructionTemplate } from './template';

export { processInstructions } from './inject';
export type { InstructionInjectionResult } from './inject';

export { InstructionRecorder } from './InstructionRecorder';
export type { InstructionSummary, ToolInstructionStats, InstructionFiring, FollowUpOffering } from './InstructionRecorder';

export { defaultConditionMatcher, PendingFollowUpManager } from './strictFollowUp';
export type { PendingStrictFollowUp } from './strictFollowUp';
