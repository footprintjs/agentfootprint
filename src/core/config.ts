/**
 * AgentLoopConfig — everything the core loop needs to run.
 * Assembled by builders (Agent.create(), etc.).
 */

import type { LLMProvider } from '../types/llm';
import type { PromptProvider, MessageStrategy, ToolProvider } from './providers';
import type { AgentRecorder } from './recorders';

export interface AgentLoopConfig {
  /** Resolves system prompt each turn. */
  readonly promptProvider: PromptProvider;
  /** Prepares messages for LLM. */
  readonly messageStrategy: MessageStrategy;
  /** Resolves and executes tools. */
  readonly toolProvider: ToolProvider;
  /** LLM provider (chat API). */
  readonly llmProvider: LLMProvider;
  /** Max tool-loop iterations per turn. */
  readonly maxIterations: number;
  /** Passive observers. */
  readonly recorders: AgentRecorder[];
  /** Agent name (for narrative/debugging). */
  readonly name: string;
}
