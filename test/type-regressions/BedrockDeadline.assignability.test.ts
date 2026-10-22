import { describe, expect, it } from 'vitest';

import {
  ProviderTimeoutError,
  type BedrockProviderOptions,
  type ProviderTimeoutWait,
} from '../../src/doors/providers.js';

const valid: BedrockProviderOptions = { timeoutMs: 1_000 };
// @ts-expect-error Timeout configuration is numeric, never a parsed string.
const invalid: BedrockProviderOptions = { timeoutMs: '1000' };
void invalid;

describe('public Bedrock deadline contract', () => {
  it('exports the typed error and each supported phase through providers', () => {
    const phases: ProviderTimeoutWait[] = ['response', 'chunk', 'close', 'fallback'];
    expect(valid.timeoutMs).toBe(1_000);
    for (const phase of phases) {
      const error = new ProviderTimeoutError({
        provider: 'bedrock',
        waitingFor: phase,
        timeoutMs: valid.timeoutMs!,
        afterOutput: false,
      });
      expect(error.code).toBe('ERR_PROVIDER_TIMEOUT');
      expect(error.waitingFor).toBe(phase);
      expect(error.retryable).toBe(true);
    }
  });
});
