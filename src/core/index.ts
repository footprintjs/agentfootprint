/**
 * core/ — Agent loop interfaces and types.
 *
 * The "traversal engine" of agentfootprint. Defines the provider
 * and recorder interfaces that everything else plugs into.
 *
 * Three files:
 *   providers.ts — active strategies (shape behavior)
 *   recorders.ts — passive observers (watch behavior)
 *   config.ts    — loop configuration
 */

// Provider interfaces + context types
export type {
  SlotDecision,
  PromptProvider,
  MessageStrategy,
  ToolProvider,
  PromptContext,
  MessageContext,
  ToolContext,
  ToolExecutionResult,
} from './providers';

// Recorder interface + event types
export type {
  AgentRecorder,
  TurnStartEvent,
  LLMCallEvent,
  ToolCallEvent,
  TurnCompleteEvent,
  AgentErrorEvent,
} from './recorders';

// Loop config
export type { AgentLoopConfig } from './config';
