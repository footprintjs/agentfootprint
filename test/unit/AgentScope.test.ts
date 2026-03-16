import { describe, it, expect, vi } from 'vitest';
import { AgentScope, AGENT_PATHS } from '../../src';
import type { ScopeFacade } from 'footprintjs';

function mockScope(): ScopeFacade {
  const store: Record<string, unknown> = {};
  return {
    getValue: vi.fn((key: string) => store[key]),
    setValue: vi.fn((key: string, value: unknown) => {
      store[key] = value;
    }),
    updateValue: vi.fn(),
    deleteValue: vi.fn(),
    getArgs: vi.fn(() => ({})),
    attachRecorder: vi.fn(),
  } as unknown as ScopeFacade;
}

describe('AgentScope', () => {
  describe('getMessages / setMessages', () => {
    it('returns empty array when no messages set', () => {
      const scope = mockScope();
      expect(AgentScope.getMessages(scope)).toEqual([]);
    });

    it('sets and gets messages', () => {
      const scope = mockScope();
      const msgs = [{ role: 'user' as const, content: 'hi' }];
      AgentScope.setMessages(scope, msgs);
      expect(scope.setValue).toHaveBeenCalledWith(AGENT_PATHS.MESSAGES, msgs);
    });

    it('returns defensive copy of messages', () => {
      const scope = mockScope();
      const msgs = [{ role: 'user' as const, content: 'hi' }];
      AgentScope.setMessages(scope, msgs);
      const result = AgentScope.getMessages(scope);
      // Should be a copy, not same reference
      expect(result).not.toBe(msgs);
    });
  });

  describe('getSystemPrompt / setSystemPrompt', () => {
    it('returns undefined when not set', () => {
      const scope = mockScope();
      expect(AgentScope.getSystemPrompt(scope)).toBeUndefined();
    });

    it('sets and reads system prompt', () => {
      const scope = mockScope();
      AgentScope.setSystemPrompt(scope, 'Be helpful');
      expect(scope.setValue).toHaveBeenCalledWith(AGENT_PATHS.SYSTEM_PROMPT, 'Be helpful');
    });
  });

  describe('getLoopCount / setLoopCount', () => {
    it('defaults to 0', () => {
      const scope = mockScope();
      expect(AgentScope.getLoopCount(scope)).toBe(0);
    });

    it('sets and reads loop count', () => {
      const scope = mockScope();
      AgentScope.setLoopCount(scope, 5);
      expect(scope.setValue).toHaveBeenCalledWith(AGENT_PATHS.LOOP_COUNT, 5);
    });
  });

  describe('getMaxIterations / setMaxIterations', () => {
    it('defaults to 10', () => {
      const scope = mockScope();
      expect(AgentScope.getMaxIterations(scope)).toBe(10);
    });

    it('sets max iterations', () => {
      const scope = mockScope();
      AgentScope.setMaxIterations(scope, 25);
      expect(scope.setValue).toHaveBeenCalledWith(AGENT_PATHS.MAX_ITERATIONS, 25);
    });
  });

  describe('getAdapterResult / setAdapterResult', () => {
    it('returns undefined when not set', () => {
      const scope = mockScope();
      expect(AgentScope.getAdapterResult(scope)).toBeUndefined();
    });

    it('stores adapter result', () => {
      const scope = mockScope();
      const result = { type: 'final' as const, content: 'hi' };
      AgentScope.setAdapterResult(scope, result);
      expect(scope.setValue).toHaveBeenCalledWith(AGENT_PATHS.ADAPTER_RESULT, result);
    });
  });

  describe('getParsedResponse / setParsedResponse', () => {
    it('returns undefined when not set', () => {
      const scope = mockScope();
      expect(AgentScope.getParsedResponse(scope)).toBeUndefined();
    });

    it('stores parsed response', () => {
      const scope = mockScope();
      const parsed = { hasToolCalls: false, toolCalls: [], content: 'ok' };
      AgentScope.setParsedResponse(scope, parsed);
      expect(scope.setValue).toHaveBeenCalledWith(AGENT_PATHS.PARSED_RESPONSE, parsed);
    });
  });

  describe('getResult / setResult', () => {
    it('returns undefined when not set', () => {
      const scope = mockScope();
      expect(AgentScope.getResult(scope)).toBeUndefined();
    });

    it('stores result string', () => {
      const scope = mockScope();
      AgentScope.setResult(scope, 'final answer');
      expect(scope.setValue).toHaveBeenCalledWith(AGENT_PATHS.RESULT, 'final answer');
    });
  });

  describe('getToolDescriptions / setToolDescriptions', () => {
    it('returns empty array when not set', () => {
      const scope = mockScope();
      expect(AgentScope.getToolDescriptions(scope)).toEqual([]);
    });

    it('stores tool descriptions', () => {
      const scope = mockScope();
      const tools = [{ name: 'search', description: 'Search', inputSchema: {} }];
      AgentScope.setToolDescriptions(scope, tools);
      expect(scope.setValue).toHaveBeenCalledWith(AGENT_PATHS.TOOL_DESCRIPTIONS, tools);
    });
  });
});

describe('AGENT_PATHS', () => {
  it('has all expected keys', () => {
    expect(AGENT_PATHS.MESSAGES).toBe('messages');
    expect(AGENT_PATHS.SYSTEM_PROMPT).toBe('systemPrompt');
    expect(AGENT_PATHS.TOOL_DESCRIPTIONS).toBe('toolDescriptions');
    expect(AGENT_PATHS.ADAPTER_RESULT).toBe('adapterResult');
    expect(AGENT_PATHS.PARSED_RESPONSE).toBe('parsedResponse');
    expect(AGENT_PATHS.LOOP_COUNT).toBe('loopCount');
    expect(AGENT_PATHS.MAX_ITERATIONS).toBe('maxIterations');
    expect(AGENT_PATHS.RESULT).toBe('result');
  });
});
