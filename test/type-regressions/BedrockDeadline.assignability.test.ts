import { describe, expect, it } from 'vitest';

import {
  BedrockStreamTimeoutError,
  type BedrockProviderOptions,
  type BedrockStreamWait,
} from '../../src/doors/providers.js';

const valid: BedrockProviderOptions = { timeoutMs: 1_000 };
// @ts-expect-error Timeout configuration is numeric, never a parsed string.
const invalid: BedrockProviderOptions = { timeoutMs: '1000' };
void invalid;

describe('public Bedrock deadline contract', () => {
  it('exports the typed error and each supported phase through providers', () => {
    const phases: BedrockStreamWait[] = ['response', 'chunk', 'close', 'fallback'];
    expect(valid.timeoutMs).toBe(1_000);
    for (const phase of phases) {
      const error = new BedrockStreamTimeoutError(phase, valid.timeoutMs!);
      expect(error.code).toBe('BEDROCK_STREAM_TIMEOUT');
      expect(error.phase).toBe(phase);
      expect(error.retryable).toBe(true);
    }
  });
});
