import { describe, it, expect } from 'vitest';
import { getSubtreeSnapshot, listSubflowPaths } from 'footprintjs';
import { Agent, LLMCall, RAG, FlowChart, mock, defineTool, mockRetriever } from '../../src';

// ── Helpers ─────────────────────────────────────────────────

const simpleMock = () => mock([{ content: 'Done.' }]);

const toolMock = () =>
  mock([
    { content: 'Searching.', toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'test' } }] },
    { content: 'Found it.' },
  ]);

const searchTool = defineTool({
  id: 'search',
  description: 'Search',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async () => ({ content: 'results' }),
});

// ── AgentRunner.toFlowChart() ───────────────────────────────

describe('AgentRunner.toFlowChart()', () => {
  it('returns a valid FlowChart with root and stageMap', () => {
    const runner = Agent.create({ provider: simpleMock() }).system('You are helpful.').build();

    const chart = runner.toFlowChart();
    expect(chart).toBeDefined();
    expect(chart.root).toBeDefined();
    expect(chart.root.name).toBe('Seed');
    expect(chart.stageMap).toBeInstanceOf(Map);
  });

  it('chart contains all ReAct loop stages', () => {
    const runner = Agent.create({ provider: simpleMock() }).tool(searchTool).build();

    const chart = runner.toFlowChart();
    const stageIds = Array.from(chart.stageMap.keys());
    expect(stageIds).toContain('seed');
    expect(stageIds).toContain('assemble-prompt');
    expect(stageIds).toContain('call-llm');
    expect(stageIds).toContain('parse-response');
    expect(stageIds).toContain('route-response');
  });

  it('run() still works after toFlowChart() is called', async () => {
    const runner = Agent.create({ provider: simpleMock() }).system('Be concise.').build();

    // Call toFlowChart first
    const chart = runner.toFlowChart();
    expect(chart).toBeDefined();

    // Then run — should not interfere
    const result = await runner.run('Hello');
    expect(result.content).toBe('Done.');
  });
});

// ── LLMCallRunner.toFlowChart() ─────────────────────────────

describe('LLMCallRunner.toFlowChart()', () => {
  it('returns a valid FlowChart', () => {
    const runner = LLMCall.create({ provider: simpleMock() }).system('Summarize.').build();

    const chart = runner.toFlowChart();
    expect(chart).toBeDefined();
    expect(chart.root).toBeDefined();
    expect(chart.stageMap).toBeInstanceOf(Map);
  });

  it('chart contains expected stages (no loop)', () => {
    const runner = LLMCall.create({ provider: simpleMock() }).build();
    const chart = runner.toFlowChart();
    const stageIds = Array.from(chart.stageMap.keys());
    expect(stageIds).toContain('system-prompt');
    expect(stageIds).toContain('messages');
    expect(stageIds).toContain('call-llm');
    expect(stageIds).toContain('parse');
    expect(stageIds).toContain('finalize');
  });
});

// ── RAGRunner.toFlowChart() ─────────────────────────────────

describe('RAGRunner.toFlowChart()', () => {
  it('returns a valid FlowChart with retrieval stages', () => {
    const runner = RAG.create({
      provider: simpleMock(),
      retriever: mockRetriever([{ chunks: [{ content: 'ctx', score: 0.9 }], query: 'test' }]),
    }).build();

    const chart = runner.toFlowChart();
    expect(chart).toBeDefined();
    const stageIds = Array.from(chart.stageMap.keys());
    expect(stageIds).toContain('retrieve');
    expect(stageIds).toContain('augment-prompt');
    expect(stageIds).toContain('call-llm');
  });
});

// ── FlowChart subflow composition ────────────────────────────

describe('FlowChart with toFlowChart() subflows', () => {
  it('mounts AgentRunner as subflow (not flat stage)', async () => {
    const researcher = Agent.create({ provider: simpleMock(), name: 'researcher' })
      .system('Research the topic.')
      .build();

    const writer = Agent.create({
      provider: mock([{ content: 'Final article.' }]),
      name: 'writer',
    })
      .system('Write an article.')
      .build();

    const pipeline = FlowChart.create()
      .agent('sf-researcher', 'Research', researcher)
      .agent('sf-writer', 'Write', writer)
      .build();

    const result = await pipeline.run('AI trends');
    expect(result.content).toBeTruthy();

    // Verify subflows appear in snapshot
    const snapshot = pipeline.getSnapshot();
    expect(snapshot).toBeDefined();

    const paths = listSubflowPaths(snapshot);
    expect(paths).toContain('sf-researcher');
    expect(paths).toContain('sf-writer');
  });

  it('enables drill-down into subflow execution', async () => {
    const agent = Agent.create({ provider: simpleMock(), name: 'worker' })
      .system('Do work.')
      .build();

    const pipeline = FlowChart.create().agent('sf-worker', 'Worker', agent).build();

    await pipeline.run('task');
    const snapshot = pipeline.getSnapshot();

    const subtree = getSubtreeSnapshot(snapshot, 'sf-worker');
    expect(subtree).toBeDefined();
    expect(subtree!.subflowId).toBe('sf-worker');
    expect(subtree!.executionTree).toBeDefined();
  });

  it('narrative propagates through subflow nesting', async () => {
    const agent = Agent.create({ provider: simpleMock(), name: 'agent' }).system('Help.').build();

    const pipeline = FlowChart.create().agent('sf-agent', 'Agent', agent).build();

    await pipeline.run('hello');
    const narrative = pipeline.getNarrative();
    expect(narrative.length).toBeGreaterThan(0);

    // Should mention the subflow
    const hasSubflowMention = narrative.some(
      (line) => line.toLowerCase().includes('agent') || line.toLowerCase().includes('subflow'),
    );
    expect(hasSubflowMention).toBe(true);
  });

  it('mixes subflow runners and legacy runners', async () => {
    // AgentRunner has toFlowChart — will be subflow
    const agent = Agent.create({ provider: simpleMock(), name: 'smart' }).build();

    // Plain RunnerLike without toFlowChart — will be flat stage
    const legacyRunner = {
      run: async () => ({ content: 'legacy result' }),
    };

    const pipeline = FlowChart.create()
      .agent('sf-smart', 'Smart', agent)
      .agent('legacy', 'Legacy', legacyRunner)
      .build();

    const result = await pipeline.run('test');
    expect(result.content).toBeTruthy();

    const snapshot = pipeline.getSnapshot();
    const paths = listSubflowPaths(snapshot);
    // Only the agent with toFlowChart appears as subflow
    expect(paths).toContain('sf-smart');
  });

  it('state isolation: subflow does not pollute parent scope', async () => {
    const agent = Agent.create({ provider: simpleMock(), name: 'isolated' })
      .system('Internal prompt.')
      .build();

    const pipeline = FlowChart.create().agent('sf-isolated', 'Isolated', agent).build();

    await pipeline.run('test');
    const snapshot = pipeline.getSnapshot();

    // Parent shared state should not contain agent internal keys
    const parentState = snapshot.sharedState ?? {};
    expect(parentState.systemPrompt).toBeUndefined();
    expect(parentState.loopCount).toBeUndefined();
    expect(parentState.maxIterations).toBeUndefined();
  });
});

// ── LLMCall as subflow ──────────────────────────────────────

describe('LLMCall mounted as subflow in FlowChart', () => {
  it('LLMCallRunner works as subflow via toFlowChart()', async () => {
    const summarizer = LLMCall.create({ provider: mock([{ content: 'Summary: AI is growing.' }]) })
      .system('Summarize the input.')
      .build();

    const composed = FlowChart.create().agent('sf-summarizer', 'Summarizer', summarizer).build();

    const result = await composed.run('Long text about AI...');
    expect(result.content).toBe('Summary: AI is growing.');

    const snapshot = composed.getSnapshot();
    const paths = listSubflowPaths(snapshot);
    expect(paths).toContain('sf-summarizer');
  });
});

// ── Agent with tools mounted as subflow ─────────────────────

describe('Agent with tools as pipeline subflow', () => {
  it('tool loop executes within subflow', async () => {
    const agent = Agent.create({ provider: toolMock(), name: 'toolAgent' })
      .tool(searchTool)
      .build();

    const pipeline = FlowChart.create().agent('sf-tool-agent', 'ToolAgent', agent).build();

    const result = await pipeline.run('Search for something');
    expect(result.content).toBe('Found it.');

    const snapshot = pipeline.getSnapshot();
    const subtree = getSubtreeSnapshot(snapshot, 'sf-tool-agent');
    expect(subtree).toBeDefined();
  });
});
