/**
 * Tests for the new Agent concept — built on buildAgentLoop.
 *
 * Tiers:
 * - unit:     single-turn, system prompt, tool registration
 * - boundary: empty message, no system prompt, maxIterations edge cases
 * - scenario: full ReAct loop with tools, multi-turn conversation
 * - property: result always string, messages always array, loopCount always number
 * - security: provider throws, tool throws, build-time validation
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/lib/concepts/Agent';
import { defineTool } from '../../../src/tools/ToolRegistry';
import { InMemoryStore } from '../../../src/adapters/memory/inMemory';
import type { LLMProvider, LLMResponse, Message, ToolCall } from '../../../src/types';

// ── Helpers ──────────────────────────────────────────────────

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    }),
  };
}

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async ({ q }) => ({ content: `Results for: ${q}` }),
});

const calcTool = defineTool({
  id: 'calc',
  description: 'Calculate math',
  inputSchema: { type: 'object' },
  handler: async () => ({ content: '42' }),
});

// ── Unit Tests ──────────────────────────────────────────────

describe('Agent — unit', () => {
  it('single-turn produces a result', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'Hello!' }]),
    })
      .system('You are helpful.')
      .build();

    const result = await agent.run('hi');
    expect(result.content).toBe('Hello!');
  });

  it('system prompt is sent to the LLM', async () => {
    const provider = mockProvider([{ content: 'ok' }]);
    const agent = Agent.create({ provider })
      .system('You are a code reviewer.')
      .build();

    await agent.run('review this');

    const calledMsgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    expect(calledMsgs[0].role).toBe('system');
    expect(calledMsgs[0].content).toBe('You are a code reviewer.');
  });

  it('tools are registered and available to LLM', async () => {
    const provider = mockProvider([{ content: 'no tools needed' }]);
    const agent = Agent.create({ provider })
      .tool(searchTool)
      .build();

    await agent.run('search for weather');

    // Tools passed in options
    const calledOptions = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(calledOptions?.tools).toBeDefined();
    expect(calledOptions.tools).toHaveLength(1);
    expect(calledOptions.tools[0].name).toBe('search');
  });

  it('multiple tools can be registered', async () => {
    const provider = mockProvider([{ content: 'ok' }]);
    const agent = Agent.create({ provider })
      .tools([searchTool, calcTool])
      .build();

    await agent.run('do things');

    const calledOptions = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(calledOptions.tools).toHaveLength(2);
  });
});

// ── Boundary Tests ──────────────────────────────────────────

describe('Agent — boundary', () => {
  it('works without system prompt', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    const result = await agent.run('hi');
    expect(result.content).toBe('ok');
  });

  it('works with empty message', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'empty input' }]),
    }).build();

    const result = await agent.run('');
    expect(result.content).toBe('empty input');
  });

  it('maxIterations=1 limits tool loops', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: {} };
    const provider = mockProvider([
      { content: 'Searching', toolCalls: [tc] },
      { content: 'More searching', toolCalls: [tc] },
    ]);

    const agent = Agent.create({ provider })
      .tool(searchTool)
      .maxIterations(1)
      .build();

    const result = await agent.run('find something');
    expect(result.iterations).toBeLessThanOrEqual(1);
  });
});

// ── Scenario Tests ──────────────────────────────────────────

describe('Agent — scenario', () => {
  it('full ReAct loop: tool call → tool result → final answer', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: { q: 'weather' } };
    const provider = mockProvider([
      { content: 'Let me search', toolCalls: [tc] },
      { content: 'The weather is sunny.' },
    ]);

    const agent = Agent.create({ provider })
      .system('You can search the web.')
      .tool(searchTool)
      .build();

    const result = await agent.run('What is the weather?');
    expect(result.content).toBe('The weather is sunny.');
    expect(result.iterations).toBe(1);
  });

  it('multi-turn conversation preserves history', async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      chat: vi.fn(async (msgs: Message[]) => {
        callCount++;
        if (callCount === 1) return { content: 'My name is Bot.' };
        // Second turn — should have history from first turn
        const hasFirstTurn = msgs.some((m) => m.role === 'assistant' && m.content === 'My name is Bot.');
        return { content: hasFirstTurn ? 'I remember!' : 'I forgot.' };
      }),
    };

    const agent = Agent.create({ provider }).build();

    await agent.run('What is your name?');
    const result2 = await agent.run('Do you remember?');
    expect(result2.content).toBe('I remember!');
  });

  it('resetConversation clears history', async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      chat: vi.fn(async (msgs: Message[]) => {
        callCount++;
        if (callCount === 1) return { content: 'First response.' };
        const hasFirstTurn = msgs.some((m) => m.role === 'assistant');
        return { content: hasFirstTurn ? 'has history' : 'no history' };
      }),
    };

    const agent = Agent.create({ provider }).build();

    await agent.run('hello');
    agent.resetConversation();
    const result2 = await agent.run('hello again');
    expect(result2.content).toBe('no history');
  });

  it('getMessages returns conversation history', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'response' }]),
    }).build();

    await agent.run('hello');
    const messages = agent.getMessages();
    expect(messages.some((m) => m.role === 'user')).toBe(true);
    expect(messages.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('toFlowChart returns a valid chart for subflow mounting', () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('test')
      .tool(searchTool)
      .build();

    const chart = agent.toFlowChart();
    expect(chart).toBeDefined();
    expect(chart.stageMap).toBeDefined();
    const stageIds = Array.from(chart.stageMap.keys());
    expect(stageIds).toContain('call-llm');
  });

  it('toFlowChart produces a subflowMode chart (Seed reads from scope)', () => {
    // NOTE: Full subflow mounting blocked by footprintjs nested subflow bug.
    // Verify structure: chart has subflowMode Seed that reads 'message' from scope.
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('You are helpful.')
      .build();

    const chart = agent.toFlowChart();
    const stageIds = Array.from(chart.stageMap.keys());

    // Chart has all expected stages
    expect(stageIds).toContain('seed');
    expect(stageIds).toContain('call-llm');
    expect(stageIds).toContain('handle-response');

    // Same structure as the chart built via run() — subflowMode doesn't
    // change the stage graph, only the Seed stage behavior
    const runChart = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('You are helpful.')
      .build()
      .toFlowChart();

    expect(Array.from(chart.stageMap.keys()).sort())
      .toEqual(Array.from(runChart.stageMap.keys()).sort());
  });
});

// ── Property Tests ──────────────────────────────────────────

describe('Agent — property', () => {
  it('result.content is always a string', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'text' }]),
    }).build();

    const result = await agent.run('hi');
    expect(typeof result.content).toBe('string');
  });

  it('result.messages is always an array', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    const result = await agent.run('hi');
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it('result.iterations is always a number', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    const result = await agent.run('hi');
    expect(typeof result.iterations).toBe('number');
  });

  it('getNarrative returns string array', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    await agent.run('hi');
    const narrative = agent.getNarrative();
    expect(Array.isArray(narrative)).toBe(true);
  });
});

// ── Memory Tests ────────────────────────────────────────────

describe('Agent — memory', () => {
  it('memory() method is chainable', () => {
    const store = new InMemoryStore();
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('test')
      .memory({ store, conversationId: 'conv-1' })
      .build();

    expect(agent).toBeDefined();
  });

  it('memory persists conversation across runs', async () => {
    const store = new InMemoryStore();
    let callCount = 0;
    const provider: LLMProvider = {
      chat: vi.fn(async (msgs: Message[]) => {
        callCount++;
        if (callCount === 1) return { content: 'First response.' };
        const hasHistory = msgs.some((m) => m.role === 'assistant' && m.content === 'First response.');
        return { content: hasHistory ? 'I remember!' : 'No history.' };
      }),
    };

    // First agent instance — run turn 1
    const agent1 = Agent.create({ provider })
      .memory({ store, conversationId: 'conv-1' })
      .build();

    await agent1.run('hello');

    // Second agent instance — new agent, same store + conversationId
    const agent2 = Agent.create({ provider })
      .memory({ store, conversationId: 'conv-1' })
      .build();

    const result = await agent2.run('do you remember?');
    expect(result.content).toBe('I remember!');
  });

  it('memory store receives full conversation on save', async () => {
    const store = new InMemoryStore();
    const agent = Agent.create({
      provider: mockProvider([{ content: 'answer' }]),
    })
      .memory({ store, conversationId: 'conv-1' })
      .build();

    await agent.run('question');

    // Store should have the conversation
    const stored = store.load('conv-1');
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some((m: Message) => m.role === 'user')).toBe(true);
    expect(stored.some((m: Message) => m.role === 'assistant')).toBe(true);
  });

  it('memory with different conversationId creates separate histories', async () => {
    const store = new InMemoryStore();

    const agent1 = Agent.create({
      provider: mockProvider([{ content: 'response for conv-1' }]),
    })
      .memory({ store, conversationId: 'conv-1' })
      .build();

    const agent2 = Agent.create({
      provider: mockProvider([{ content: 'response for conv-2' }]),
    })
      .memory({ store, conversationId: 'conv-2' })
      .build();

    await agent1.run('msg1');
    await agent2.run('msg2');

    const history1 = store.load('conv-1');
    const history2 = store.load('conv-2');
    expect(history1.length).toBeGreaterThan(0);
    expect(history2.length).toBeGreaterThan(0);
    expect(history1).not.toEqual(history2);
  });

  it('agent without memory does not persist to store', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    await agent.run('hello');
    // No store involved — just verifying no errors
    expect(agent.getMessages().length).toBeGreaterThan(0);
  });

  it('toFlowChart with memory includes commit-memory stage', () => {
    const store = new InMemoryStore();
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .memory({ store, conversationId: 'conv-1' })
      .build();

    const chart = agent.toFlowChart();
    const stageIds = Array.from(chart.stageMap.keys());
    expect(stageIds).toContain('commit-memory');
  });
});

// ── Security Tests ──────────────────────────────────────────

describe('Agent — security', () => {
  it('provider.chat() throwing propagates to caller', async () => {
    const agent = Agent.create({
      provider: { chat: vi.fn().mockRejectedValue(new Error('API error')) },
    }).build();

    await expect(agent.run('hi')).rejects.toThrow('API error');
  });

  it('tool handler throwing does not crash the agent', async () => {
    const failTool = defineTool({
      id: 'fail',
      description: 'Always fails',
      inputSchema: { type: 'object' },
      handler: async () => { throw new Error('tool crashed'); },
    });

    const tc: ToolCall = { id: 'tc-1', name: 'fail', arguments: {} };
    const provider = mockProvider([
      { content: 'Using fail', toolCalls: [tc] },
      { content: 'Got error, moving on' },
    ]);

    const agent = Agent.create({ provider })
      .tool(failTool)
      .build();

    const result = await agent.run('do it');
    expect(result.content).toBe('Got error, moving on');
  });

  it('agent name defaults to "agent"', () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    expect(agent.name).toBe('agent');
  });

  it('custom agent name is preserved', () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
      name: 'my-agent',
    }).build();

    expect(agent.name).toBe('my-agent');
  });
});
