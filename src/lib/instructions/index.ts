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
