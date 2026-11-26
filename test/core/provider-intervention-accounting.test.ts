import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import { LLMCall } from '../../src/core/LLMCall.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';

describe('provider interventions retain response accounting without answer delivery', () => {
  for (const outcome of ['blocked', 'unknown'] as const) {
    it(`LLMCall: ${outcome} retains the accepted response accounting`, async () => {
      const runner = LLMCall.create({
        model: 'scripted',
        provider: {
          name: 'leaf',
          complete: async () => ({
            content: 'UNUSABLE',
            toolCalls: [],
            usage: { input: 7, output: 3 },
            stopReason: 'content_filter',
            intervention: { outcome, code: 'guardrail_intervened', filters: [] },
          }),
        },
        pricingTable: { name: 'prices', pricePerToken: () => 0.01 },
      }).build();
      const end = vi.fn();
      const cost = vi.fn();
      runner.on('agentfootprint.stream.llm_end', end);
      runner.on('agentfootprint.cost.tick', cost);
      await expect(runner.run('hello')).rejects.toHaveProperty(
        'code',
        outcome === 'blocked' ? 'ERR_PROVIDER_BLOCKED' : 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
      );
      expect(end).toHaveBeenCalledTimes(1);
      expect(end.mock.calls[0]?.[0].payload).toMatchObject({
        content: '',
        usage: { input: 7, output: 3 },
      });
      expect(cost).toHaveBeenCalledTimes(1);
      expect(cost.mock.calls[0]?.[0].payload.estimatedUsd).toBeCloseTo(0.1);
    });
  }
  for (const outcome of ['blocked', 'unknown'] as const) {
    it(`${outcome} remains terminal if the pricing strategy throws`, async () => {
      const pricingError = new Error('application pricing failed');
      const complete = vi.fn(async () => ({
        content: '',
        toolCalls: [],
        usage: { input: 7, output: 3 },
        stopReason: 'content_filter',
        intervention: { outcome, code: 'guardrail_intervened', filters: [] },
      }));
      const provider: LLMProvider = { name: 'accounted-provider', complete };
      const agent = Agent.create({
        provider,
        model: 'accounted-model',
        pricingTable: {
          name: 'throwing-prices',
          pricePerToken: () => {
            throw pricingError;
          },
        },
      }).build();
      await expect(agent.run('hello')).rejects.toMatchObject({
        code: outcome === 'blocked' ? 'ERR_PROVIDER_BLOCKED' : 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
        cause: pricingError,
      });
      expect(complete).toHaveBeenCalledTimes(1);
    });
  }
  for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    for (const outcome of ['blocked', 'unknown', 'masked'] as const) {
      it(`${reactMode}: ${outcome} records one end and one cost tick`, async () => {
        const usage = { input: 7, output: 3, cacheRead: 2, cacheWrite: 1 };
        const complete = vi.fn(async () => ({
          content: 'Returned [EMAIL].',
          toolCalls: [],
          usage,
          stopReason: 'content_filter',
          intervention: { outcome, code: 'guardrail_intervened', filters: [] },
        }));
        const provider: LLMProvider = { name: 'accounted-provider', complete };
        const agent = Agent.create({
          provider,
          model: 'accounted-model',
          reactMode,
          pricingTable: { name: 'scripted-prices', pricePerToken: () => 0.01 },
        }).build();
        const end = vi.fn();
        const cost = vi.fn();
        const fatal = vi.fn();
        agent.on('agentfootprint.stream.llm_end', end);
        agent.on('agentfootprint.cost.tick', cost);
        agent.on('agentfootprint.error.fatal', fatal);
        const result = await agent.run('hello').then(
          (value) => ({ value, error: undefined }),
          (error: unknown) => ({ value: undefined, error }),
        );
        expect(complete).toHaveBeenCalledTimes(1);
        expect(end).toHaveBeenCalledTimes(1);
        expect(end.mock.calls[0]?.[0].payload).toMatchObject({
          content: outcome === 'masked' ? 'Returned [EMAIL].' : '',
          toolCallCount: 0,
          usage,
        });
        expect(cost).toHaveBeenCalledTimes(1);
        expect(cost.mock.calls[0]?.[0].payload).toMatchObject({
          provider: 'accounted-provider',
          model: 'accounted-model',
          tokensInput: 7,
          tokensOutput: 3,
        });
        expect(cost.mock.calls[0]?.[0].payload.estimatedUsd).toBeCloseTo(0.13);
        expect(fatal).toHaveBeenCalledTimes(outcome === 'masked' ? 0 : 1);
        if (outcome !== 'masked') {
          expect(fatal.mock.calls[0]?.[0].payload.error).toContain(
            outcome === 'blocked' ? 'blocked' : 'unknown',
          );
          expect(JSON.stringify(fatal.mock.calls)).not.toContain('Returned [EMAIL].');
        }
        if (outcome === 'masked') {
          expect(result.value).toBe('Returned [EMAIL].');
        } else {
          expect(result.error).toMatchObject({
            code:
              outcome === 'blocked' ? 'ERR_PROVIDER_BLOCKED' : 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
          });
        }
      });
    }
  }
});
