/**
 * agentfootprint/instructions — Make agents smart with conditional context injection.
 *
 * Define rules that inject into system prompt, tools, and tool-result recency window
 * based on accumulated Decision Scope state.
 *
 * @example
 * ```typescript
 * import { defineInstruction, AgentPattern } from 'agentfootprint/instructions';
 *
 * const refund = defineInstruction({
 *   id: 'refund-handling',
 *   activeWhen: (d) => d.orderStatus === 'denied',
 *   prompt: 'Be empathetic.',
 *   tools: [processRefund],
 * });
 * ```
 */

export { defineInstruction, follow, quickBind } from './lib/instructions';
export type {
  AgentInstruction,
  LLMInstruction,
  FollowUpBinding,
  InstructionContext,
  InstructionOverride,
  InstructedToolDefinition,
} from './lib/instructions';
export { AgentPattern } from './lib/loop';
export { InstructionRecorder } from './lib/instructions';
export type { InstructionSummary } from './lib/instructions';
