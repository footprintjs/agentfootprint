/**
 * AgentScope — typed wrapper over ScopeFacade for agent state.
 *
 * Instead of raw scope.getValue('messages'), use scope.getMessages().
 * All paths come from AGENT_PATHS constants (single source of truth).
 */

import type { ScopeFacade } from 'footprintjs';
import type {
  Message,
  AdapterResult,
  ToolCall,
  LLMToolDescription,
  RetrievalResult,
  AgentResultEntry,
} from '../types';

/** Well-known scope paths for agent state. */
export const AGENT_PATHS = {
  MESSAGES: 'messages',
  SYSTEM_PROMPT: 'systemPrompt',
  TOOL_DESCRIPTIONS: 'toolDescriptions',
  ADAPTER_RESULT: 'adapterResult',
  PARSED_RESPONSE: 'parsedResponse',
  LOOP_COUNT: 'loopCount',
  MAX_ITERATIONS: 'maxIterations',
  RESULT: 'result',
} as const;

/** Well-known scope paths for multi-agent pipeline state. */
export const MULTI_AGENT_PATHS = {
  PIPELINE_INPUT: 'pipelineInput',
  AGENT_RESULTS: 'agentResults',
  RESULT: 'result',
  SIGNAL: '_signal',
  TIMEOUT_MS: '_timeoutMs',
} as const;

/** Well-known scope paths for RAG state. */
export const RAG_PATHS = {
  RETRIEVAL_QUERY: 'retrievalQuery',
  RETRIEVAL_RESULT: 'retrievalResult',
  CONTEXT_WINDOW: 'contextWindow',
} as const;

export interface ParsedResponse {
  readonly hasToolCalls: boolean;
  readonly toolCalls: ToolCall[];
  readonly content: string;
}

/**
 * Typed accessors for agent state in scope.
 * These are pure functions — no class inheritance needed.
 */
export const AgentScope = {
  // ── Reads ──────────────────────────────────────────────

  getMessages(scope: ScopeFacade): Message[] {
    const msgs = scope.getValue(AGENT_PATHS.MESSAGES) as Message[] | undefined;
    return msgs ? [...msgs] : [];
  },

  getSystemPrompt(scope: ScopeFacade): string | undefined {
    return scope.getValue(AGENT_PATHS.SYSTEM_PROMPT) as string | undefined;
  },

  getToolDescriptions(scope: ScopeFacade): LLMToolDescription[] {
    return (scope.getValue(AGENT_PATHS.TOOL_DESCRIPTIONS) as LLMToolDescription[]) ?? [];
  },

  getAdapterResult(scope: ScopeFacade): AdapterResult | undefined {
    return scope.getValue(AGENT_PATHS.ADAPTER_RESULT) as AdapterResult | undefined;
  },

  getParsedResponse(scope: ScopeFacade): ParsedResponse | undefined {
    return scope.getValue(AGENT_PATHS.PARSED_RESPONSE) as ParsedResponse | undefined;
  },

  getLoopCount(scope: ScopeFacade): number {
    return (scope.getValue(AGENT_PATHS.LOOP_COUNT) as number) ?? 0;
  },

  getMaxIterations(scope: ScopeFacade): number {
    return (scope.getValue(AGENT_PATHS.MAX_ITERATIONS) as number) ?? 10;
  },

  getResult(scope: ScopeFacade): string | undefined {
    return scope.getValue(AGENT_PATHS.RESULT) as string | undefined;
  },

  // ── Writes ─────────────────────────────────────────────

  setMessages(scope: ScopeFacade, messages: Message[]): void {
    scope.setValue(AGENT_PATHS.MESSAGES, messages);
  },

  setSystemPrompt(scope: ScopeFacade, prompt: string): void {
    scope.setValue(AGENT_PATHS.SYSTEM_PROMPT, prompt);
  },

  setToolDescriptions(scope: ScopeFacade, tools: LLMToolDescription[]): void {
    scope.setValue(AGENT_PATHS.TOOL_DESCRIPTIONS, tools);
  },

  setAdapterResult(scope: ScopeFacade, result: AdapterResult): void {
    scope.setValue(AGENT_PATHS.ADAPTER_RESULT, result);
  },

  setParsedResponse(scope: ScopeFacade, parsed: ParsedResponse): void {
    scope.setValue(AGENT_PATHS.PARSED_RESPONSE, parsed);
  },

  setLoopCount(scope: ScopeFacade, count: number): void {
    scope.setValue(AGENT_PATHS.LOOP_COUNT, count);
  },

  setMaxIterations(scope: ScopeFacade, max: number): void {
    scope.setValue(AGENT_PATHS.MAX_ITERATIONS, max);
  },

  setResult(scope: ScopeFacade, result: string): void {
    scope.setValue(AGENT_PATHS.RESULT, result);
  },

  // ── RAG Reads ───────────────────────────────────────────

  getRetrievalQuery(scope: ScopeFacade): string | undefined {
    return scope.getValue(RAG_PATHS.RETRIEVAL_QUERY) as string | undefined;
  },

  getRetrievalResult(scope: ScopeFacade): RetrievalResult | undefined {
    return scope.getValue(RAG_PATHS.RETRIEVAL_RESULT) as RetrievalResult | undefined;
  },

  getContextWindow(scope: ScopeFacade): string | undefined {
    return scope.getValue(RAG_PATHS.CONTEXT_WINDOW) as string | undefined;
  },

  // ── RAG Writes ──────────────────────────────────────────

  setRetrievalQuery(scope: ScopeFacade, query: string): void {
    scope.setValue(RAG_PATHS.RETRIEVAL_QUERY, query);
  },

  setRetrievalResult(scope: ScopeFacade, result: RetrievalResult): void {
    scope.setValue(RAG_PATHS.RETRIEVAL_RESULT, result);
  },

  setContextWindow(scope: ScopeFacade, context: string): void {
    scope.setValue(RAG_PATHS.CONTEXT_WINDOW, context);
  },

  // ── Multi-Agent Reads ──────────────────────────────────────

  getPipelineInput(scope: ScopeFacade): string | undefined {
    return scope.getValue(MULTI_AGENT_PATHS.PIPELINE_INPUT) as string | undefined;
  },

  getAgentResults(scope: ScopeFacade): AgentResultEntry[] {
    return (scope.getValue(MULTI_AGENT_PATHS.AGENT_RESULTS) as AgentResultEntry[]) ?? [];
  },

  // ── Multi-Agent Writes ─────────────────────────────────────

  setPipelineInput(scope: ScopeFacade, input: string): void {
    scope.setValue(MULTI_AGENT_PATHS.PIPELINE_INPUT, input);
  },

  setAgentResults(scope: ScopeFacade, results: AgentResultEntry[]): void {
    scope.setValue(MULTI_AGENT_PATHS.AGENT_RESULTS, results);
  },
} as const;
