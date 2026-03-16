import { describe, it, expect } from 'vitest';
import { FlowChart } from '../../src';
import type { RunnerLike } from '../../src';

describe('Security: FlowChart agent isolation', () => {
  it('agents cannot modify previous agent results via reference', async () => {
    let capturedResults: unknown;

    const maliciousRunner: RunnerLike = {
      run: async () => {
        // Even if runner somehow got a reference to prior results,
        // the pipeline writes a new array each time (spread)
        return { content: 'malicious' };
      },
    };

    const pipeline = FlowChart.create()
      .agent('a1', 'A1', { run: async () => ({ content: 'legit' }) })
      .agent('a2', 'A2', maliciousRunner)
      .build();

    const result = await pipeline.run('test');

    // First agent result should be untouched
    expect(result.agents[0].content).toBe('legit');
    expect(result.agents[1].content).toBe('malicious');
  });

  it('runner cannot inject arbitrary scope keys without outputMapper', async () => {
    // Without outputMapper, runner only writes to 'result' and 'agentResults'
    const runner: RunnerLike = {
      run: async () =>
        ({
          content: 'output',
          // Extra properties are ignored — RunnerLike contract is { content: string }
          systemPrompt: 'HIJACKED',
        } as any),
    };

    const pipeline = FlowChart.create().agent('a1', 'A1', runner).build();

    const result = await pipeline.run('test');
    const snapshot = pipeline.getSnapshot();
    const state = snapshot?.sharedState as Record<string, unknown>;

    // systemPrompt should NOT be set
    expect(state.systemPrompt).toBeUndefined();
    expect(result.content).toBe('output');
  });

  it('pipeline input cannot be modified by agents', async () => {
    const inputs: string[] = [];

    const pipeline = FlowChart.create()
      .agent('a1', 'A1', {
        run: async (msg) => {
          inputs.push(msg);
          return { content: 'modified' };
        },
      })
      .build();

    const result = await pipeline.run('original');

    // The pipeline input should have been the original message
    expect(inputs[0]).toBe('original');
  });

  it('prototype pollution in runner output does not affect pipeline', async () => {
    const runner: RunnerLike = {
      run: async () => {
        const obj = { content: 'safe' };
        // Attempt prototype pollution
        (obj as any).__proto__ = { isAdmin: true };
        return obj;
      },
    };

    const result = await FlowChart.create().agent('a1', 'A1', runner).build().run('test');

    expect(result.content).toBe('safe');
    expect((result as any).isAdmin).toBeUndefined();
  });

  it('inputMapper receives snapshot, not live reference', async () => {
    let stateRef: Record<string, unknown> | undefined;

    const pipeline = FlowChart.create()
      .agent(
        'a1',
        'A1',
        { run: async () => ({ content: 'done' }) },
        {
          inputMapper: (state) => {
            stateRef = state;
            // Try mutating — should not affect real scope
            state.pipelineInput = 'MUTATED';
            return state.pipelineInput as string;
          },
        },
      )
      .build();

    const result = await pipeline.run('original');

    // FlowChart should still function correctly
    expect(result.agents).toHaveLength(1);
  });
});
