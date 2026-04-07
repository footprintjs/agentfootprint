/**
 * Loop assembler types.
 *
 * The loop assembler wires the three API slots + call stages into a
 * looping flowchart: SystemPrompt → Messages → Tools → CallLLM →
 * ParseResponse → RouteResponse(decider) → {tool-calls | final}
 * → loopTo('call-llm').
 */

import type { FlowChart } from 'footprintjs';
import type { StageFunction, SubflowMountOptions } from 'footprintjs/advanced';
import type { LLMProvider, ResponseFormat } from '../../types';
import type { ToolProvider } from '../../core';
import type { ToolRegistry } from '../../tools';
import type { Message } from '../../types/messages';
import type { CommitMemoryConfig } from '../../stages/commitMemory';
import type { SystemPromptSlotConfig } from '../slots/system-prompt';
import type { MessagesSlotConfig } from '../slots/messages';
import type { ToolsSlotConfig } from '../slots/tools';
import type { ResolvedInstruction, InstructionOverride, AgentInstruction } from '../instructions';
import type { DecideFn } from '../call/helpers';
import type { AgentStreamEventHandler } from '../../streaming';

// ── RoutingConfig — pluggable post-ParseResponse routing ─────────────────────

/**
 * A single branch in a RoutingConfig — what happens for a given decider return value.
 *
 * Discriminated union ensures every branch has exactly one handler.
 */
export type RoutingBranch =
  | { readonly id: string; readonly kind: 'subflow'; readonly chart: FlowChart; readonly name?: string; readonly mount?: SubflowMountOptions }
  | { readonly id: string; readonly kind: 'lazy-subflow'; readonly factory: () => FlowChart; readonly name?: string; readonly mount?: SubflowMountOptions }
  | { readonly id: string; readonly kind: 'fn'; readonly fn: StageFunction; readonly name?: string; readonly description?: string };

/**
 * RoutingConfig — controls what happens after ParseResponse in the agent loop.
 *
 * The default agent loop uses `tool-calls | final` routing. Swarm uses
 * `specialist-A | specialist-B | swarm-tools | final`. Both are expressed
 * as RoutingConfig — one code path, zero forks in buildAgentLoop.
 *
 * **Ordering invariant:** The decider runs AFTER ParseResponse commits.
 * Scope contains `parsedResponse` with tool calls and response content.
 *
 * @internal Not exported from the public API. Consumer-facing builders
 * (Agent, Swarm) construct RoutingConfig internally.
 */
export interface RoutingConfig {
  /** Name for the decider stage (e.g., 'RouteResponse', 'RouteSpecialist'). */
  readonly deciderName: string;
  /** Stable ID for the decider node. */
  readonly deciderId: string;
  /** Description shown in narrative. */
  readonly deciderDescription?: string;
  /**
   * Decider function — called after ParseResponse commits.
   * Returns a branch ID string that matches one of the branches.
   *
   * Receives the scope (with parsedResponse, loopCount, etc.) and must return
   * a string matching one of the branch IDs. maxIterations enforcement is
   * handled structurally by buildAgentLoop — the decider does not need to check it.
   */
  readonly decider: (scope: any, breakFn: () => void, streamCb?: unknown) => string | Promise<string>;
  /** Branch definitions — each maps to a subflow or inline function.
   *  Order matters: branches are added to the decider in array order. */
  readonly branches: readonly RoutingBranch[];
  /** Default branch when decider returns an unknown key or maxIterations is reached.
   *  This branch MUST call $break() or breakFn() to terminate the loop. */
  readonly defaultBranch: string;
}

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

  /**
   * Callback when LLM instructions fire during tool execution.
   * Used to connect InstructionRecorder to the instruction pipeline.
   */
  readonly onInstructionsFired?: (toolId: string, fired: ResolvedInstruction[]) => void;

  /** Agent-level instruction overrides keyed by tool ID. */
  readonly instructionOverrides?: ReadonlyMap<string, InstructionOverride>;

  /**
   * Agent-level instructions evaluated by the InstructionsToLLM subflow.
   * When provided, the subflow is mounted BEFORE the 3 API slots.
   * Instructions inject into system prompt, tools, and tool-result processing
   * based on the current Decision Scope state.
   */
  readonly agentInstructions?: readonly AgentInstruction[];

  /**
   * Initial Decision Scope values. Written to `scope.decision` in the Seed stage.
   * Tool handlers update these values; InstructionsToLLM reads them to evaluate
   * `activeWhen` predicates.
   */
  readonly initialDecision?: Readonly<Record<string, unknown>>;

  /**
   * Pre-computed decide() functions keyed by instruction rule ID.
   * Built once in AgentRunner constructor, passed through to avoid
   * recomputing on every run(). Functions can't travel through scope
   * (stripped on write), so they're captured as a closure map.
   */
  readonly decideFunctions?: ReadonlyMap<string, DecideFn>;

  /** Stream event handler for consumer-facing lifecycle events. */
  readonly onStreamEvent?: AgentStreamEventHandler;

  /** When true, CallLLM uses addStreamingFunction for token-by-token output. */
  readonly streaming?: boolean;

  /** Structured output format — passed to LLM provider as responseFormat option. */
  readonly responseFormat?: ResponseFormat;

  /**
   * Custom routing strategy — replaces the default RouteResponse decider.
   *
   * When provided, buildAgentLoop uses this RoutingConfig instead of the
   * default `tool-calls | final` routing. Used by Swarm to route to
   * specialist subflows.
   *
   * When omitted, the default agent routing is used automatically.
   *
   * @internal Consumers use Agent/Swarm builders, not this field directly.
   */
  readonly routing?: RoutingConfig;
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
