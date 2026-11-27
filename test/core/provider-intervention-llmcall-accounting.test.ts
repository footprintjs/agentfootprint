import { describe, expect, it, vi } from 'vitest';
import { LLMCall } from '../../src/core/LLMCall.js';
import type { LLMResponse, PricingTable } from '../../src/provider-contract/types.js';
import { agentThinkingTrace } from '../../src/recorders/observability/AgentThinkingTraceRecorder.js';

const USAGE = { input: 7, output: 11, cacheRead: 2, cacheWrite: 3, thinking: 5 };

function terminalFixture(outcome: 'blocked' | 'unknown') {
  const reads = vi.fn(() => {
    throw new Error('foreign response accessor was read');
  });
  const usage = { ...USAGE, fixtureNumeric: 31337 };
  Object.defineProperty(usage, 'fixtureAccessor', { enumerable: true, get: reads });
  const response = {
    usage,
    intervention: { outcome, code: 'guardrail_intervened', filters: [] },
  };
  for (const key of ['content', 'toolCalls', 'rawThinking', 'replay', 'replayOmissions']) {
    Object.defineProperty(response, key, { enumerable: true, get: reads });
  }
  const stopReads = vi.fn(() => 'untrusted-stop');
  Object.defineProperty(response, 'stopReason', { enumerable: true, get: stopReads });
  return { response: response as LLMResponse, usage, reads, stopReads };
}

describe('LLMCall terminal accounting uses the captured response', () => {
  for (const outcome of ['blocked', 'unknown'] as const) {
    const code =
      outcome === 'blocked' ? 'ERR_PROVIDER_BLOCKED' : 'ERR_PROVIDER_INTERVENTION_UNKNOWN';

    it(`${outcome}: listeners and pricing cannot re-read foreign response fields`, async () => {
      const fixture = terminalFixture(outcome);
      const pricePerToken = vi.fn<PricingTable['pricePerToken']>(() => {
        fixture.usage.output = 9000;
        return 1;
      });
      const complete = vi.fn(async () => fixture.response);
      const call = LLMCall.create({
        provider: { name: 'local-terminal', complete },
        model: 'mock',
        pricingTable: { name: 'local-prices', pricePerToken },
      }).build();
      const thinking = agentThinkingTrace();
      call.attach(thinking);
      const ends: unknown[] = [];
      const ticks: unknown[] = [];
      call.on('agentfootprint.stream.llm_end', (event) => {
        ends.push(event.payload);
        fixture.usage.input = 8000;
      });
      call.on('agentfootprint.cost.tick', (event) => ticks.push(event.payload));

      await expect(call.run('hello')).rejects.toMatchObject({ code });
      expect(complete).toHaveBeenCalledTimes(1);
      expect(fixture.reads).not.toHaveBeenCalled();
      expect(fixture.stopReads).not.toHaveBeenCalled();
      expect(ends).toEqual([
        expect.objectContaining({
          content: '',
          contentWithheld: true,
          toolCallCount: 0,
          usage: USAGE,
          stopReason: 'guardrail_intervened',
        }),
      ]);
      expect(ticks).toEqual([
        expect.objectContaining({ tokensInput: 7, tokensOutput: 11, estimatedUsd: 23 }),
      ]);
      expect(pricePerToken.mock.calls).toEqual([
        ['mock', 'input'],
        ['mock', 'output'],
        ['mock', 'cacheRead'],
        ['mock', 'cacheWrite'],
      ]);
      expect(thinking.getTrace().steps.filter((step) => step.kind === 'answer')).toEqual([]);
    });

    it(`${outcome}: pricing failure preserves the terminal error and its cause`, async () => {
      const fixture = terminalFixture(outcome);
      const cause = new Error('pricing failed');
      const call = LLMCall.create({
        provider: { name: 'local-terminal', complete: async () => fixture.response },
        model: 'mock',
        pricingTable: {
          name: 'throwing',
          pricePerToken: () => {
            throw cause;
          },
        },
      }).build();
      const error = await call.run('hello').then(
        () => undefined,
        (value: unknown) => value,
      );
      expect(error).toMatchObject({ code, cause });
      expect(fixture.reads).not.toHaveBeenCalled();
      expect(fixture.stopReads).not.toHaveBeenCalled();
    });
  }

  for (const outcome of ['masked', 'ordinary'] as const) {
    it(`${outcome}: keeps normal completion, pricing, and answer recording`, async () => {
      const response: LLMResponse = {
        content: 'Returned [EMAIL] text.',
        toolCalls: [],
        usage: { ...USAGE },
        stopReason: 'stop',
        ...(outcome === 'masked' && {
          intervention: { outcome, code: 'guardrail_intervened', filters: [] },
        }),
      };
      const call = LLMCall.create({
        provider: { name: 'local-control', complete: async () => response },
        model: 'mock',
        pricingTable: { name: 'local-prices', pricePerToken: () => 1 },
      }).build();
      const thinking = agentThinkingTrace();
      call.attach(thinking);
      const ends: { contentWithheld?: true }[] = [];
      const ticks: unknown[] = [];
      call.on('agentfootprint.stream.llm_end', (event) => ends.push(event.payload));
      call.on('agentfootprint.cost.tick', (event) => ticks.push(event.payload));
      await expect(call.run('hello')).resolves.toBe(response.content);
      expect(ends).toHaveLength(1);
      expect(ends[0]?.contentWithheld).toBeUndefined();
      expect(ticks).toEqual([
        expect.objectContaining({ tokensInput: 7, tokensOutput: 11, estimatedUsd: 23 }),
      ]);
      expect(thinking.getTrace().steps.filter((step) => step.kind === 'answer')).toHaveLength(1);
    });
  }
});
