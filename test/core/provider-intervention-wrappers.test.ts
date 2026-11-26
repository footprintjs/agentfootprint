import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../src/resilience/withRetry.js';
import { withFallback } from '../../src/resilience/withFallback.js';
import { withCircuitBreaker } from '../../src/resilience/withCircuitBreaker.js';
import {
  ProviderBlockedError,
  ProviderInterventionUnknownError,
  ProviderGuardrailLimitError,
} from '../../src/provider-contract/intervention.js';
import type { LLMProvider, LLMRequest } from '../../src/provider-contract/types.js';

const request: LLMRequest = { model: 'scripted', messages: [] };
describe('terminal intervention cannot enter an automatic resend policy', () => {
  for (const terminal of [
    () =>
      new ProviderBlockedError({ outcome: 'blocked', code: 'guardrail_intervened', filters: [] }),
    () =>
      new ProviderInterventionUnknownError({
        outcome: 'unknown',
        code: 'guardrail_intervened',
        filters: [],
      }),
    () => new ProviderGuardrailLimitError(),
  ]) {
    for (const wrapper of ['retry', 'fallback', 'circuit'] as const) {
      for (const stream of [false, true]) {
        it(`${terminal().code} bypasses ${wrapper} policy (stream=${stream})`, async () => {
          const error = terminal();
          const complete = vi.fn(async () => {
            throw error;
          });
          const source: LLMProvider = {
            name: 'scripted',
            complete,
            stream: async function* () {
              yield await complete();
            },
          };
          // A policy that must never run also stops the old branch before any
          // timer or second scripted send. This test never schedules a retry.
          const policy = vi.fn(() => {
            throw new Error('terminal reached resend policy');
          });
          const fallback = vi.fn(async () => ({
            content: 'bad success',
            toolCalls: [],
            usage: { input: 0, output: 0 },
            stopReason: 'stop',
          }));
          const provider =
            wrapper === 'retry'
              ? withRetry(source, { shouldRetry: policy })
              : wrapper === 'fallback'
              ? withFallback(
                  source,
                  { name: 'fallback', complete: fallback },
                  { shouldFallback: policy },
                )
              : withCircuitBreaker(source, { shouldCount: policy });
          const run = async () => {
            if (stream) {
              for await (const chunk of provider.stream!(request)) void chunk;
            } else await provider.complete(request);
          };
          await expect(run()).rejects.toBe(error);
          expect(policy).not.toHaveBeenCalled();
          expect(complete).toHaveBeenCalledTimes(1);
          expect(fallback).not.toHaveBeenCalled();
        });
      }
    }
  }
});
