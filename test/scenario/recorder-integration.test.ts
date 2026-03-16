import { describe, it, expect } from 'vitest';
import {
  Agent,
  LLMCall,
  mock,
  defineTool,
  LLMRecorder,
  ScopeCostRecorder as CostRecorder,
  ADAPTER_PATHS,
} from '../../src';

describe('Scenario: LLMRecorder captures calls through flowchart', () => {
  it('records single LLM call stats', async () => {
    const recorder = new LLMRecorder();

    const caller = LLMCall.create({
      provider: mock([
        { content: 'Hello!', usage: { inputTokens: 100, outputTokens: 50 }, model: 'gpt-4o' },
      ]),
    }).build();

    // Manually simulate — recorder is a scope recorder
    recorder.onStageStart();
    recorder.onWrite({
      key: ADAPTER_PATHS.RESULT,
      value: {
        type: 'final',
        content: 'Hello!',
        model: 'gpt-4o',
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    });
    recorder.onStageEnd();

    const stats = recorder.getStats();
    expect(stats.totalCalls).toBe(1);
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.totalOutputTokens).toBe(50);
    expect(stats.entries[0].model).toBe('gpt-4o');
  });

  it('records multiple LLM calls across tool loop', () => {
    const recorder = new LLMRecorder();

    // Simulate 3 LLM calls (initial + 2 tool loops)
    for (let i = 0; i < 3; i++) {
      recorder.onStageStart();
      recorder.onWrite({
        key: ADAPTER_PATHS.RESULT,
        value: { model: 'claude-3', usage: { inputTokens: 50 * (i + 1), outputTokens: 25 } },
      });
      recorder.onStageEnd();
    }

    expect(recorder.getTotalCalls()).toBe(3);
    expect(recorder.getTotalInputTokens()).toBe(300); // 50+100+150
  });

  it('responds to both RESPONSE and RESULT adapter paths', () => {
    const recorder = new LLMRecorder();

    recorder.onWrite({
      key: ADAPTER_PATHS.RESPONSE,
      value: { model: 'raw', usage: { inputTokens: 10, outputTokens: 5 } },
    });
    recorder.onWrite({
      key: ADAPTER_PATHS.RESULT,
      value: { model: 'normalized', usage: { inputTokens: 20, outputTokens: 10 } },
    });

    expect(recorder.getTotalCalls()).toBe(2);
  });
});

describe('Scenario: CostRecorder integration', () => {
  it('calculates cost using ADAPTER_PATHS constants', () => {
    const recorder = new CostRecorder();

    recorder.onWrite({
      key: ADAPTER_PATHS.RESULT,
      value: {
        model: 'gpt-4o',
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      },
    });

    expect(recorder.getTotalCost()).toBeGreaterThan(0);
  });

  it('ignores writes to non-adapter keys', () => {
    const recorder = new CostRecorder();

    recorder.onWrite({ key: 'messages', value: [] });
    recorder.onWrite({ key: 'parsedResponse', value: {} });

    expect(recorder.getEntries()).toHaveLength(0);
  });
});

describe('Scenario: Agent conversation history grows correctly', () => {
  it('multi-turn messages accumulate with tool calls', async () => {
    const tool = defineTool({
      id: 'search',
      description: 'Search',
      inputSchema: {},
      handler: async () => ({ content: 'Found it' }),
    });

    const agent = Agent.create({
      provider: mock([
        // Turn 1: tool call + final
        {
          content: 'Searching.',
          toolCalls: [{ id: 'tc-1', name: 'search', arguments: {} }],
        },
        { content: 'Found the answer.' },
        // Turn 2: direct answer
        { content: 'I remember.' },
      ]),
    })
      .system('Helpful assistant')
      .tool(tool)
      .build();

    const r1 = await agent.run('Find something');
    // system + user + assistant(tool) + tool_result + assistant(final)
    expect(r1.messages.length).toBeGreaterThanOrEqual(4);

    const r2 = await agent.run('Do you remember?');
    // Previous messages + user + assistant
    expect(r2.messages.length).toBeGreaterThan(r1.messages.length);
  });

  it('resetConversation truly clears all history', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'First' }, { content: 'Fresh' }]),
    })
      .system('Remember')
      .build();

    await agent.run('Message 1');
    agent.resetConversation();
    const result = await agent.run('Message 2');

    // Should only have: system + user + assistant = 3
    expect(result.messages).toHaveLength(3);
  });
});
