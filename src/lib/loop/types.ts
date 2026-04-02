/**
 * Loop assembler types.
 *
 * The loop assembler wires the three API slots + call stages into a
 * looping flowchart: SystemPrompt → Messages → Tools → CallLLM →
 * ParseResponse → RouteResponse(decider) → {tool-calls | final}
 * → loopTo('call-llm').
 */

import type { LLMProvider } from '../../types';
import type { ToolProvider } from '../../core';
import type { ToolRegistry } from '../../tools';
import type { Message } from '../../types/messages';
import type { CommitMemoryConfig } from '../../stages/commitMemory';
import type { SystemPromptSlotConfig } from '../slots/system-prompt';
import type { MessagesSlotConfig } from '../slots/messages';
import type { ToolsSlotConfig } from '../slots/tools';

/**
 * Full configuration for building an agent loop.
 */
export interface AgentLoopConfig {
  /** LLM provider for the CallLLM stage. */
  readonly provider: LLMProvider;

  /** SystemPrompt slot configuration. */
  readonly systemPrompt: SystemPromptSlotConfig;

  /** Messages slot configuration. */
  readonly messages: MessagesSlotConfig;

  /** Tools slot configuration. */
  readonly tools: ToolsSlotConfig;

  /** Tool registry for executing tool calls in the tool-calls branch. */
  readonly registry: ToolRegistry;

  /**
   * Optional ToolProvider for remote tool execution (MCP, A2A).
   * When present, tool execution tries provider.execute() before registry fallback.
   */
  readonly toolProvider?: ToolProvider;

  /** Max loop iterations before force-finalize. Default: 10. */
  readonly maxIterations?: number;

  /**
   * When true, the Finalize branch sets `memory_shouldCommit` flag instead of
   * calling $break() directly. Only use when a CommitMemory stage is mounted
   * after the RouteResponse decider — without it, the loop will not terminate
   * until maxIterations is reached.
   *
   * Auto-enabled when `commitMemory` is provided.
   */
  readonly useCommitFlag?: boolean;

  /**
   * When provided, mounts a CommitMemory stage after the RouteResponse decider.
   * Automatically enables `useCommitFlag`.
   */
  readonly commitMemory?: CommitMemoryConfig;
}

/**
 * Options for seeding the loop with initial state.
 */
export interface AgentLoopSeedOptions {
  /** Initial messages (e.g., [userMessage('hello')]). */
  readonly messages: Message[];
  /** Existing conversation history to prepend. Default: []. */
  readonly existingMessages?: Message[];
  /**
   * When true, Seed stage reads `message` (string) from scope instead of
   * using baked-in messages. Use this for subflow composition — the parent
   * chart's inputMapper sets `message` in the subflow's scope.
   */
  readonly subflowMode?: boolean;
}
