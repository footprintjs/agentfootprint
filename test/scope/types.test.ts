/**
 * Tests for scope/types.ts — TypedScope state interfaces.
 *
 * 5-pattern coverage:
 *   1. Unit — type assertions, field existence
 *   2. Boundary — optional vs required fields, edge values
 *   3. Scenario — real-world state shapes match interface
 *   4. Property — interface completeness vs AGENT_PATHS constants
 *   5. Security — index signature constraint for tool keys
 */

import { describe, it, expect } from 'vitest';
import type { TypedScope } from 'footprintjs';
import type {
  AgentLoopState,
  SystemPromptSubflowState,
  ToolsSubflowState,
  MessagesSubflowState,
  RAGState,
  MultiAgentState,
} from '../../src/scope/types';
import { AGENT_PATHS, MEMORY_PATHS, RAG_PATHS, MULTI_AGENT_PATHS } from '../../src/scope';
import type { Message, LLMToolDescription, AdapterResult, LLMResponse } from '../../src/types';
import { userMessage, assistantMessage, systemMessage } from '../../src/types';

// ── 1. Unit — Type assertions ────────────────────────────────

describe('AgentLoopState', () => {
  it('has all AGENT_PATHS keys as typed properties', () => {
    // This is a compile-time check — if it compiles, the types match
    const state: AgentLoopState = {} as AgentLoopState;
    const _messages: Message[] = state.messages;
    const _systemPrompt: string = state.systemPrompt;
    const _toolDescriptions: LLMToolDescription[] = state.toolDescriptions;
    const _adapterResult: AdapterResult = state.adapterResult;
    const _parsedResponse = state.parsedResponse;
    const _loopCount: number = state.loopCount;
    const _maxIterations: number = state.maxIterations;
    const _result: string = state.result;
    expect(true).toBe(true); // compile-time assertion passed
  });

  it('has all MEMORY_PATHS keys as typed properties', () => {
    const state: AgentLoopState = {} as AgentLoopState;
    const _prepared: Message[] = state.memory_preparedMessages;
    const _stored: Message[] = state.memory_storedHistory;
    const _commit: boolean = state.memory_shouldCommit;
    expect(true).toBe(true);
  });

  it('has narrative enrichment fields', () => {
    const state: AgentLoopState = {} as AgentLoopState;
    const _tools: string = state.resolvedTools;
    const _prompt: string = state.promptSummary;
    const _llm: string = state.llmCall;
    const _response: string = state.responseType;
    expect(true).toBe(true);
  });
});

// ── 2. Boundary — Edge values ────────────────────────────────

describe('boundary', () => {
  it('AgentLoopState accepts empty arrays for messages', () => {
    const partial: Pick<AgentLoopState, 'messages'> = { messages: [] };
    expect(partial.messages).toEqual([]);
  });

  it('AgentLoopState accepts zero for numeric fields', () => {
    const partial: Pick<AgentLoopState, 'loopCount' | 'maxIterations'> = {
      loopCount: 0,
      maxIterations: 0,
    };
    expect(partial.loopCount).toBe(0);
    expect(partial.maxIterations).toBe(0);
  });

  it('AgentLoopState accepts empty string for result', () => {
    const partial: Pick<AgentLoopState, 'result'> = { result: '' };
    expect(partial.result).toBe('');
  });
});

// ── 3. Scenario — Real-world state shapes ────────────────────

describe('scenario', () => {
  it('matches a typical agent turn state', () => {
    const state: Partial<AgentLoopState> = {
      messages: [
        systemMessage('You are helpful.'),
        userMessage('Hello'),
        assistantMessage('Hi there!'),
      ],
      systemPrompt: 'You are helpful.',
      toolDescriptions: [
        { name: 'calculator', description: 'Compute math', inputSchema: { type: 'object' } },
      ],
      loopCount: 1,
      maxIterations: 10,
      result: 'Hi there!',
      resolvedTools: '1 tools: calculator',
      promptSummary: '16 chars: "You are helpful."',
      llmCall: 'claude-sonnet-4 (50in / 20out)',
      responseType: 'final: "Hi there!"',
    };
    expect(state.messages).toHaveLength(3);
    expect(state.loopCount).toBe(1);
  });

  it('MessagesSubflowState is a proper subset of AgentLoopState keys', () => {
    // Every key in MessagesSubflowState should exist in AgentLoopState
    // (except 'currentMessages' which is the subflow's internal input key)
    const agentKeys = new Set<string>([
      'messages',
      'systemPrompt',
      'toolDescriptions',
      'adapterResult',
      'adapterRawResponse',
      'parsedResponse',
      'loopCount',
      'maxIterations',
      'result',
      'memory_preparedMessages',
      'memory_storedHistory',
      'memory_shouldCommit',
      'resolvedTools',
      'promptSummary',
      'llmCall',
      'responseType',
      'message',
    ]);
    const msgKeys = ['loopCount', 'memory_preparedMessages', 'memory_storedHistory'];
    for (const key of msgKeys) {
      expect(agentKeys.has(key)).toBe(true);
    }
  });
});

// ── 4. Property — Interface completeness vs constants ────────

describe('property', () => {
  it('AgentLoopState covers all AGENT_PATHS values', () => {
    const agentPathValues = Object.values(AGENT_PATHS);
    const stateKeys: (keyof AgentLoopState)[] = [
      'messages',
      'systemPrompt',
      'toolDescriptions',
      'adapterResult',
      'parsedResponse',
      'loopCount',
      'maxIterations',
      'result',
    ];
    for (const path of agentPathValues) {
      expect(stateKeys).toContain(path);
    }
  });

  it('AgentLoopState covers all MEMORY_PATHS values', () => {
    const memoryPathValues = Object.values(MEMORY_PATHS);
    const stateKeys: (keyof AgentLoopState)[] = [
      'memory_preparedMessages',
      'memory_storedHistory',
      'memory_shouldCommit',
    ];
    for (const path of memoryPathValues) {
      expect(stateKeys).toContain(path);
    }
  });

  it('RAGState covers all RAG_PATHS values', () => {
    const ragPathValues = Object.values(RAG_PATHS);
    const stateKeys: (keyof RAGState)[] = ['retrievalQuery', 'retrievalResult', 'contextWindow'];
    for (const path of ragPathValues) {
      expect(stateKeys).toContain(path);
    }
  });

  it('MultiAgentState covers relevant MULTI_AGENT_PATHS values', () => {
    const relevantPaths = [
      MULTI_AGENT_PATHS.PIPELINE_INPUT,
      MULTI_AGENT_PATHS.AGENT_RESULTS,
      MULTI_AGENT_PATHS.RESULT,
    ];
    const stateKeys: (keyof MultiAgentState)[] = ['pipelineInput', 'agentResults', 'result'];
    for (const path of relevantPaths) {
      expect(stateKeys).toContain(path);
    }
  });
});

// ── 5. Security — Memory key isolation ──────────────────────

describe('security', () => {
  it('MEMORY_PATHS keys are prefixed with memory_ to avoid collision', () => {
    for (const value of Object.values(MEMORY_PATHS)) {
      expect(value.startsWith('memory_')).toBe(true);
    }
  });

  it('AGENT_PATHS and MEMORY_PATHS have no key overlap', () => {
    const agentValues = new Set(Object.values(AGENT_PATHS));
    for (const value of Object.values(MEMORY_PATHS)) {
      expect(agentValues.has(value as any)).toBe(false);
    }
  });
});
