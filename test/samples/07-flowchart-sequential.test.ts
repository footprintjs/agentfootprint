/**
 * Sample 07: FlowChart — Sequential Multi-Agent
 *
 * Run agents in order, each feeding into the next.
 * The simplest multi-agent pattern.
 *
 *   Research Agent → Writer Agent → Editor Agent
 *
 * Each agent can be an Agent, LLMCall, RAG, or any RunnerLike.
 * Agents with toFlowChart() are mounted as subflows (drill-down in UI).
 */
import { describe, it, expect } from 'vitest';
import { FlowChart, Agent, LLMCall, mock } from '../../src';
import { listSubflowPaths, getSubtreeSnapshot } from 'footprintjs';

describe('Sample 07: FlowChart Sequential', () => {
  it('chains agents in sequence', async () => {
    const researcher = Agent.create({
      provider: mock([{ content: 'AI is growing in healthcare and education.' }]),
      name: 'researcher',
    })
      .system('Research the given topic thoroughly.')
      .build();

    const writer = Agent.create({
      provider: mock([{ content: 'Article: AI Revolution in Healthcare and Education.' }]),
      name: 'writer',
    })
      .system('Write an article based on the research.')
      .build();

    const pipeline = FlowChart.create()
      .agent('research', 'Research', researcher)
      .agent('write', 'Write', writer)
      .build();

    const result = await pipeline.run('AI trends 2025');

    // Final output comes from the last agent
    expect(result.content).toContain('Article');
    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('mixes Agent and LLMCall runners', async () => {
    // LLMCall for simple one-shot, Agent for tool-using
    const summarizer = LLMCall.create({
      provider: mock([{ content: 'Summary: Key points about AI.' }]),
    })
      .system('Summarize the input.')
      .build();

    const formatter = LLMCall.create({
      provider: mock([{ content: '## AI Summary\n- Key points about AI.' }]),
    })
      .system('Format as markdown.')
      .build();

    const pipeline = FlowChart.create()
      .agent('summarize', 'Summarize', summarizer)
      .agent('format', 'Format', formatter)
      .build();

    const result = await pipeline.run('Long text about AI...');
    expect(result.content).toContain('## AI Summary');
  });

  it('supports subflow drill-down for inspection', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'Done.' }]),
      name: 'worker',
    }).build();

    const pipeline = FlowChart.create().agent('sf-worker', 'Worker', agent).build();

    await pipeline.run('task');

    // Agents with toFlowChart() are mounted as subflows
    const snapshot = pipeline.getSnapshot();
    const paths = listSubflowPaths(snapshot);
    expect(paths).toContain('sf-worker');

    // Drill into the subflow to see its internal execution
    const subtree = getSubtreeSnapshot(snapshot, 'sf-worker');
    expect(subtree).toBeDefined();
    expect(subtree!.executionTree).toBeDefined();
  });

  it('supports custom input/output mapping', async () => {
    const translator = LLMCall.create({
      provider: mock([{ content: 'Hola mundo' }]),
    }).build();

    const pipeline = FlowChart.create()
      .agent('translate', 'Translate', translator, {
        // Custom: read from a specific key instead of default
        inputMapper: (state) =>
          `Translate to Spanish: ${state.pipelineInput ?? state.result ?? ''}`,
      })
      .build();

    const result = await pipeline.run('Hello world');
    expect(result.content).toBe('Hola mundo');
  });

  it('produces combined narrative across all agents', async () => {
    const a1 = Agent.create({
      provider: mock([{ content: 'Step 1 done.' }]),
      name: 'step1',
    }).build();

    const a2 = Agent.create({
      provider: mock([{ content: 'Step 2 done.' }]),
      name: 'step2',
    }).build();

    const pipeline = FlowChart.create().agent('s1', 'Step1', a1).agent('s2', 'Step2', a2).build();

    await pipeline.run('go');

    const narrative = pipeline.getNarrative();
    expect(narrative.length).toBeGreaterThan(0);
  });
});
