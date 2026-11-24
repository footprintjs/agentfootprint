import { describe, expect, it, vi } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';
import { LLMCall } from '../../src/core/LLMCall.js';
import { Parallel } from '../../src/core-flow/Parallel.js';
import { buildMessageApiChart } from '../../src/core/agent/buildMessageApiChart.js';
import { buildAgentMessageApiChart } from '../../src/core/agent/buildAgentMessageApiChart.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';

function response(outcome: 'blocked' | 'unknown' | 'masked') {
  return {
    content: 'Returned [EMAIL] text.',
    toolCalls: [],
    usage: { input: 1, output: 2 },
    stopReason: 'content_filter',
    intervention: { outcome, code: 'guardrail_intervened', filters: [] },
  };
}

function leaf() {
  return LLMCall.create({
    model: 'mock',
    provider: {
      name: 'fixed',
      complete: async () => ({
        content: 'branch',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      }),
    },
  }).build();
}

describe('every direct native model caller admits provider intervention', () => {
  for (const door of ['parallel merge', 'message API', 'agent message API'] as const) {
    for (const outcome of ['blocked', 'unknown', 'masked'] as const) {
      it(`${door}: ${outcome}`, async () => {
        const complete = vi.fn(async () => response(outcome));
        const provider: LLMProvider = { name: 'guarded-double', complete };
        const ends: { content: string; usage: { input: number; output: number } }[] = [];
        let run: () => Promise<unknown>;
        if (door === 'parallel merge') {
          const parallel = Parallel.create()
            .branch('left', leaf())
            .branch('right', leaf())
            .mergeWithLLM({ provider, model: 'mock', prompt: 'Synthesize.' })
            .build();
          parallel.on('agentfootprint.stream.llm_end', (event) => ends.push(event.payload));
          run = () => parallel.run('hello');
        } else {
          const chart =
            door === 'message API'
              ? buildMessageApiChart({ provider, model: 'mock', systemPrompt: 'answer' })
              : buildAgentMessageApiChart({
                  provider,
                  model: 'mock',
                  systemPrompt: 'answer',
                  tools: [],
                });
          const executor = new FlowChartExecutor(chart);
          executor.attachCombinedRecorder({
            id: 'test.completed-intervention-accounting',
            onEmit(event: { name: string; payload: (typeof ends)[number] }) {
              if (event.name === 'agentfootprint.stream.llm_end') ends.push(event.payload);
            },
          } as never);
          run = async () => {
            await executor.run({ input: { message: 'hello' } });
            return executor.getSnapshot()?.sharedState;
          };
        }
        if (outcome === 'masked') {
          const result = await run();
          expect(JSON.stringify(result)).toContain('Returned [EMAIL] text.');
        } else {
          await expect(run()).rejects.toMatchObject({
            code:
              outcome === 'blocked' ? 'ERR_PROVIDER_BLOCKED' : 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
          });
        }
        expect(complete).toHaveBeenCalledTimes(1);
        // A bare chart deliberately serves a redacted placeholder. Only a
        // real Parallel run exposes its safe accounting payload to this tap.
        const ownEnd =
          door === 'parallel merge' ? ends.filter((event) => event.usage.output === 2) : ends;
        expect(ownEnd).toHaveLength(1);
        if (door === 'parallel merge')
          expect(ownEnd[0]).toMatchObject({
            content: outcome === 'masked' ? 'Returned [EMAIL] text.' : '',
            usage: { input: 1, output: 2 },
          });
      });
    }
  }
});
