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
 * Agent loop patterns — determines which stages re-evaluate between iterations.
 *
 * The pattern controls WHERE the loop jumps back to after tool execution:
 * - `Regular`: loops to CallLLM — slots resolve once before the loop
 * - `Dynamic`: loops to SystemPrompt — all three API slots re-evaluate each iteration
 *
 * @example
 * ```typescript
 * import { Agent, AgentPattern } from 'agentfootprint';
 *
 * // Standard ReAct — fixed prompt, tools, memory (default)
 * Agent.create({ provider }).build();
 *
 * // Dynamic ReAct — re-evaluate all slots each iteration
 * Agent.create({ provider })
 *   .pattern(AgentPattern.Dynamic)
 *   .build();
 * ```
 *
 * @example
 * ```typescript
 * // Dynamic ReAct use case: progressive tool authorization
 * // Turn 1: agent calls verify_identity → user is admin
 * // Turn 2: Tools subflow re-evaluates → admin tools now available
 * // Turn 3: agent can use admin tools that were hidden before
 * ```
 */
export enum AgentPattern {
  /**
   * Standard ReAct loop — loops back to CallLLM.
   *
   * SystemPrompt, Messages, and Tools subflows resolve ONCE before the loop starts.
   * Each iteration only re-runs: CallLLM → ParseResponse → RouteResponse → tools.
   * Best for: most agent use cases with fixed prompt/tools/memory.
   *
   * ```
   * [SystemPrompt] → [Messages] → [Tools] → AssemblePrompt
   *   → CallLLM → Parse → Route → ExecuteTools → loopTo(CallLLM)
   *         ↑                                         |
   *         └─────────────────────────────────────────┘
   * ```
   */
  Regular = 'regular',

  /**
   * Dynamic ReAct loop — loops back to SystemPrompt.
   *
   * All three API slots (SystemPrompt, Messages, Tools) re-evaluate each iteration.
   * Strategies receive updated context (messages now include tool results, loopCount
   * incremented) and can return different prompt/tools/memory based on what happened.
   * Best for: progressive authorization, adaptive prompts, context-dependent tool sets.
   *
   * ```
   * [SystemPrompt] → [Messages] → [Tools] → AssemblePrompt
   *   → CallLLM → Parse → Route → ExecuteTools → loopTo(SystemPrompt)
   *  ↑                                                  |
   *  └──────────────────────────────────────────────────┘
   * ```
   */
  Dynamic = 'dynamic',
}

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
   * Loop pattern — controls where the loop jumps back to after tool execution.
   *
   * - `AgentPattern.Regular` (default): loops to CallLLM — slots resolve once
   * - `AgentPattern.Dynamic`: loops to SystemPrompt — all slots re-evaluate each iteration
   *
   * @default AgentPattern.Regular
   */
  readonly pattern?: AgentPattern;

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
