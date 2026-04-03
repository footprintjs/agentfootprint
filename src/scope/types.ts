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

// ── Parsed Response ──────────────────────────────────────────

export interface ParsedResponse {
  readonly hasToolCalls: boolean;
  readonly toolCalls: ToolCall[];
  readonly content: string;
}

// ── Agent Loop State ─────────────────────────────────────────

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
  /** Current loop iteration count. */
  loopCount: number;
  /** Max loop iterations allowed. */
  maxIterations: number;
  /** Final answer text (set when turn finalizes). */
  result: string;

  // ── Memory internal keys ──────────────────────────────────
  /** Prepared messages after strategy applied (Messages slot output). */
  memory_preparedMessages: Message[];
  /** Raw history loaded from ConversationStore. */
  memory_storedHistory: Message[];
  /** Flag: HandleResponse sets true when finalizing; CommitMemory reads. */
  memory_shouldCommit: boolean;

  // ── Narrative enrichment (written by stages for BTS visibility) ──
  /** Tool resolution summary (e.g. "3 tools: calculator, datetime, search"). */
  resolvedTools: string;
  /** System prompt summary (e.g. '38 chars: "You are a helpful..."'). */
  promptSummary: string;
  /** LLM call summary (e.g. "claude-sonnet-4 (127in / 45out)"). */
  llmCall: string;
  /** Response type summary (e.g. "tool_calls: [calculator]" or "final: ..."). */
  responseType: string;

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
}

/** State for the Tools slot subflow. */
export interface ToolsSubflowState {
  messages: Message[];
  loopCount: number;
  toolDescriptions: LLMToolDescription[];
  resolvedTools: string;
  toolDecision?: string;
}

/** State for the Messages slot subflow (in-memory path). */
export interface MessagesSubflowState {
  /** Current messages passed from parent via inputMapper. */
  currentMessages: Message[];
  loopCount: number;
  memory_preparedMessages: Message[];
  memory_storedHistory: Message[];
}

// ── RAG State ────────────────────────────────────────────────

/** State for RAG pattern flowcharts. */
export interface RAGState {
  messages: Message[];
  systemPrompt: string;
  retrievalQuery: string;
  retrievalResult: RetrievalResult;
  contextWindow: string;
  adapterResult: AdapterResult;
  adapterRawResponse: LLMResponse;
  parsedResponse: ParsedResponse;
  result: string;
}

// ── Multi-Agent State ────────────────────────────────────────

/** State for multi-agent pipeline flowcharts. */
export interface MultiAgentState {
  pipelineInput: string;
  agentResults: AgentResultEntry[];
  result: string;
}
