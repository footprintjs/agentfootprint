/**
 * Typed state interfaces for TypedScope<T> in agentfootprint patterns.
 *
 * These replace the AgentScope static helpers + AGENT_PATHS string constants.
 * Each pattern has its own state interface — subflows use narrower slices.
 *
 * Usage:
 *   flowChart<AgentLoopState>('Seed', (scope) => {
 *     scope.messages = [userMessage('hello')];  // typed write
 *     scope.loopCount = 0;                       // typed write
 *   })
 */

import type {
  Message,
  AdapterResult,
  LLMResponse,
  LLMToolDescription,
  ToolCall,
  RetrievalResult,
  AgentResultEntry,
} from '../types';
import type { LLMInstruction } from '../lib/instructions/types';

// ── Parsed Response ──────────────────────────────────────────

export interface ParsedResponse {
  readonly hasToolCalls: boolean;
  readonly toolCalls: ToolCall[];
  readonly content: string;
}

// ── Base LLM State (shared by all patterns) ─────────────────
// Stages like CallLLM, ParseResponse are typed against this base —
// no 'as any' needed when used in Agent, RAG, or Swarm patterns.

/** Minimal state shared by all patterns that call an LLM. */
export interface BaseLLMState {
  messages: Message[];
  toolDescriptions?: LLMToolDescription[];
  adapterResult?: AdapterResult;
  adapterRawResponse?: LLMResponse;
  parsedResponse?: ParsedResponse;
  result?: string;
  [key: string]: unknown;
}

// ── Agent Loop State ─────────────────────────────────────────

/**
 * Well-known scope keys for the agent loop.
 * Used by grounding helpers, narrative renderer, and suppression lists.
 * Single source of truth — no magic strings.
 */
export enum AgentScopeKey {
  // Core state
  Messages = 'messages',
  SystemPrompt = 'systemPrompt',
  ToolDescriptions = 'toolDescriptions',
  ParsedResponse = 'parsedResponse',
  Result = 'result',
  LoopCount = 'loopCount',

  // Tool execution
  ToolResultMessages = 'toolResultMessages',

  // Decision / Instructions
  Decision = 'decision',
  MatchedInstructions = 'matchedInstructions',
  PromptInjections = 'promptInjections',
  ToolInjections = 'toolInjections',
  ResponseRules = 'responseRules',
}

/** Full state for the agent loop flowchart (buildAgentLoop). */
export interface AgentLoopState {
  /** Conversation message history. */
  messages: Message[];
  /** Resolved system prompt text. */
  systemPrompt: string;
  /** Available tool descriptions for the LLM. */
  toolDescriptions: LLMToolDescription[];
  /** Normalized LLM response (discriminated union: final | tools | error). */
  adapterResult: AdapterResult;
  /** Raw LLM response for recorders. */
  adapterRawResponse: LLMResponse;
  /** Structured parse of LLM response. */
  parsedResponse: ParsedResponse;
  /**
   * Flat mirror of `parsedResponse.hasToolCalls`. Written by ParseResponse
   * so the RouteResponse decider can use `decide()`'s filter form
   * (`{ hasToolCalls: { eq: true } }`), producing structured
   * `{ key, op, threshold, actual, result }` evidence in the commit log
   * rather than an opaque function-match boolean.
   */
  hasToolCalls: boolean;
  /** Current loop iteration count. */
  loopCount: number;
  /** Max loop iterations allowed. */
  maxIterations: number;
  /** Final answer text (set when turn finalizes). */
  result: string;
  /**
   * Set by Finalize when the turn ended because `loopCount >= maxIterations`
   * (safeDecider force-routed to the default branch), rather than because the
   * LLM chose to stop. Consumers use it to render a distinct "agent gave up"
   * state instead of an ambiguous empty response.
   */
  maxIterationsReached?: boolean;

  // ── Messages slot output ──────────────────────────────────
  /** Prepared messages after strategy applied (Messages slot output). */
  memory_preparedMessages: Message[];

  // ── Memory pipeline integration (AgentBuilder.memoryPipeline) ──
  /**
   * Hierarchical identity for the memory pipeline. Populated from
   * `run(message, { identity })` options via a MemorySeed stage when
   * `memoryPipeline` is configured. Pipeline subflows read this to
   * scope storage calls.
   */
  identity?: import('../memory/identity').MemoryIdentity;
  /** Turn counter for pipeline provenance (source.turn). Defaults to 1. */
  turnNumber?: number;
  /** Budget hint for the picker stage. Defaults to 4000. */
  contextTokensRemaining?: number;
  /**
   * Output of the memory read subflow — formatted system messages that
   * AssemblePrompt prepends to the LLM prompt.
   */
  memoryInjection?: Message[];
  /**
   * Messages packaged for the memory write subflow — populated after the
   * LLM call and Finalize. The write subflow persists these to the store.
   */
  newMessages?: Message[];

  // ── Narrative enrichment (written by stages for BTS visibility) ──
  /** Tool resolution summary (e.g. "3 tools: calculator, datetime, search"). */
  resolvedTools: string;
  /** System prompt summary (e.g. '38 chars: "You are a helpful..."'). */
  promptSummary: string;
  /** LLM call summary (e.g. "claude-sonnet-4 (127in / 45out)"). */
  llmCall: string;
  /** Response type summary (e.g. "tool_calls: [calculator]" or "final: ..."). */
  responseType: string;

  // ── InstructionsToLLM outputs (only present when agentInstructions configured) ──
  /** Decision scope — developer-defined state driving instruction activation. */
  decision?: Record<string, unknown>;
  /** Prompt injections from matched instructions (Position 1). */
  promptInjections?: string[];
  /** Tool description injections from matched instructions (Position 2). */
  toolInjections?: LLMToolDescription[];
  /** Tool-result rules from matched instructions (Position 3). */
  responseRules?: LLMInstruction[];
  /** Narrative: which instructions matched this iteration. */
  matchedInstructions?: string;

  // ── Subflow message key ───────────────────────────────────
  /** User message injected by parent in subflow mode. */
  message: string;
}

// ── Subflow State Slices ─────────────────────────────────────

/** State for the SystemPrompt slot subflow. */
export interface SystemPromptSubflowState {
  messages: Message[];
  loopCount: number;
  systemPrompt: string;
  promptSummary: string;
  promptDecision?: string;
  /** Prompt injections from InstructionsToLLM (merged after base prompt). */
  promptInjections?: string[];
}

/** State for the Tools slot subflow. */
export interface ToolsSubflowState {
  messages: Message[];
  loopCount: number;
  toolDescriptions: LLMToolDescription[];
  resolvedTools: string;
  toolDecision?: string;
  /** Tool description injections from InstructionsToLLM (merged after base tools). */
  toolInjections?: LLMToolDescription[];
}

/** State for the Messages slot subflow. */
export interface MessagesSubflowState {
  /** Current messages passed from parent via inputMapper. */
  currentMessages: Message[];
  loopCount: number;
  memory_preparedMessages: Message[];
}

/** State for the InstructionsToLLM subflow. */
export interface InstructionsToLLMState {
  /** Current decision scope values (from parent via inputMapper). */
  decision: Record<string, unknown>;
  /** Output: prompt text fragments to merge into system prompt. */
  promptInjections: string[];
  /** Output: tool descriptions to merge into tools list (handler stripped). */
  toolInjections: LLMToolDescription[];
  /** Output: tool-result rules for tool execution. */
  responseRules: LLMInstruction[];
  /** Output: IDs of instructions that matched (narrative enrichment). */
  matchedInstructions: string;
}

// ── RAG State ────────────────────────────────────────────────

/** State for RAG pattern flowcharts. */
export interface RAGState extends BaseLLMState {
  systemPrompt: string;
  retrievalQuery: string;
  retrievalResult: RetrievalResult;
  contextWindow: string;
  result: string;
}

// ── Multi-Agent State ────────────────────────────────────────

/** State for multi-agent pipeline flowcharts. */
export interface MultiAgentState {
  pipelineInput: string;
  agentResults: AgentResultEntry[];
  result: string;
}
