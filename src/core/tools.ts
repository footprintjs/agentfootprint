/**
 * Tool types — v2 Agent's tool-call contract.
 *
 * Pattern: Strategy (GoF) — each Tool is a strategy for "how to execute
 *          this named operation given these args".
 * Role:    Consumer-facing shape. Agent.tool(...) accepts these.
 * Emits:   N/A (types only).
 */

import type { LLMToolSchema } from '../adapters/types.js';

/**
 * One executable tool the Agent can call.
 *
 * - `schema` is what the LLM sees (name, description, JSON schema).
 * - `execute` runs when the LLM requests this tool with the given args.
 *   Returns anything JSON-serializable; the framework forwards it back
 *   to the LLM as the tool result.
 */
export interface Tool<TArgs = Record<string, unknown>, TResult = unknown> {
  readonly schema: LLMToolSchema;
  execute(args: TArgs, ctx: ToolExecutionContext): Promise<TResult> | TResult;
}

/** Runtime context passed to tool.execute(). */
export interface ToolExecutionContext {
  /** Unique id of THIS tool invocation (matches stream.tool_start.toolCallId). */
  readonly toolCallId: string;
  /** Current iteration number of the ReAct loop. */
  readonly iteration: number;
  /** Abort signal propagated from run({ env: { signal } }). */
  readonly signal?: AbortSignal;
}

/**
 * Internal: registry entry keyed by tool name.
 * Consumer never sees this shape.
 */
export interface ToolRegistryEntry {
  readonly name: string;
  readonly tool: Tool;
}
