import { describe, it, expect, vi } from 'vitest';
import { FlowChart, mock, LLMCall } from '../../src';
import type { RunnerLike } from '../../src';

function fakeRunner(content: string, narrative?: string[]): RunnerLike {
  return {
    run: vi.fn(async () => ({ content })),
    getNarrative: narrative ? () => narrative : undefined,
  };
}

describe('FlowChart end-to-end flow', () => {
  it('runs two agents sequentially, second reads first output', async () => {
    const runner1: RunnerLike = {
      async run(msg) {
        return { content: `Researched: ${msg}` };
      },
    };
    const runner2: RunnerLike = {
      async run(msg) {
        return { content: `Written from: ${msg}` };
      },
    };

    const pipeline = FlowChart.create()
      .agent('researcher', 'Research', runner1)
      .agent('writer', 'Write', runner2)
      .build();

    const result = await pipeline.run('AI safety');

    expect(result.content).toBe('Written from: Researched: AI safety');
    expect(result.agents).toHaveLength(2);
    expect(result.agents[0].id).toBe('researcher');
    expect(result.agents[0].content).toBe('Researched: AI safety');
    expect(result.agents[1].id).toBe('writer');
    expect(result.agents[1].content).toBe('Written from: Researched: AI safety');
    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('three-stage pipeline chains outputs correctly', async () => {
    const pipeline = FlowChart.create()
      .agent('a', 'StepA', { run: async (m) => ({ content: `A(${m})` }) })
      .agent('b', 'StepB', { run: async (m) => ({ content: `B(${m})` }) })
      .agent('c', 'StepC', { run: async (m) => ({ content: `C(${m})` }) })
      .build();

    const result = await pipeline.run('input');

    expect(result.content).toBe('C(B(A(input)))');
    expect(result.agents).toHaveLength(3);
  });

  it('wraps real LLMCall runners in a pipeline', async () => {
    const summarizer = LLMCall.create({ provider: mock([{ content: 'Summary: AI is cool' }]) })
      .system('Summarize the input.')
      .build();

    const translator = LLMCall.create({ provider: mock([{ content: 'Traducción: IA es genial' }]) })
      .system('Translate to Spanish.')
      .build();

    const pipeline = FlowChart.create()
      .agent('summarizer', 'Summarize', summarizer)
      .agent('translator', 'Translate', translator)
      .build();

    const result = await pipeline.run('Tell me about AI');

    expect(result.content).toBe('Traducción: IA es genial');
    expect(result.agents[0].content).toBe('Summary: AI is cool');
    expect(result.agents[1].content).toBe('Traducción: IA es genial');
  });

  it('captures narrative from the pipeline execution', async () => {
    const pipeline = FlowChart.create().agent('a1', 'Agent1', fakeRunner('output')).build();

    await pipeline.run('test');

    const narrative = pipeline.getNarrative();
    expect(narrative.length).toBeGreaterThan(0);
  });

  it('exposes snapshot after run', async () => {
    const pipeline = FlowChart.create().agent('a1', 'Agent1', fakeRunner('output')).build();

    await pipeline.run('test');

    const snapshot = pipeline.getSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot?.sharedState).toBeDefined();
  });

  it('custom inputMapper transforms input for specific agent', async () => {
    const runner = fakeRunner('key facts');
    const pipeline = FlowChart.create()
      .agent('a1', 'Extract', runner, {
        inputMapper: (state) => `Extract facts from: ${state.pipelineInput}`,
      })
      .build();

    const result = await pipeline.run('long document');

    expect(runner.run).toHaveBeenCalledWith(
      'Extract facts from: long document',
      expect.any(Object),
    );
    expect(result.agents[0].content).toBe('key facts');
  });

  it('custom outputMapper writes to custom scope keys', async () => {
    const pipeline = FlowChart.create()
      .agent('a1', 'Classify', fakeRunner('positive'), {
        outputMapper: (output) => ({ sentiment: output.content, result: output.content }),
      })
      .build();

    const result = await pipeline.run('I love this');

    expect(result.content).toBe('positive');
  });
});
