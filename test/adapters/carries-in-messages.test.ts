/**
 * `carriesInMessages` — what each wire admits it can carry, and what happens
 * to a provider that says nothing.
 *
 * ── Why this is a declared capability and not a lookup table ─────────
 * The Anthropic-family adapters DROP a `role: 'system'` message inside
 * `messages` (system is a separate top-level field) while the OpenAI-family
 * adapters carry it. That difference is invisible from the outside, and a
 * feature that delivered on one and silently vanished on the other would make
 * the recording provider-dependently true — worse than uniformly false,
 * because nothing in the recording distinguishes the two. So each adapter
 * states what it carries, and the engine refuses what is not stated.
 *
 * Pinned here: every first-party adapter's declaration matches what its own
 * serializer actually does, the floor applies to anyone who declares nothing,
 * and the resilience decorators do not quietly lose the capability when they
 * rebuild the provider object.
 *
 * Test types (Convention 3): unit (each adapter) / regression (a wrapper that
 * drops the field degrades every wrapped OpenAI agent to the floor) /
 * contract (the declaration vs the serializer).
 */

import { describe, it, expect } from 'vitest';
import { anthropic } from '../../src/adapters/llm/AnthropicProvider.js';
import { bedrock } from '../../src/adapters/llm/BedrockProvider.js';
import { browserAnthropic } from '../../src/adapters/llm/BrowserAnthropicProvider.js';
import { openai, azureOpenai, ollama } from '../../src/adapters/llm/OpenAIProvider.js';
import { browserOpenai, browserAzureOpenai } from '../../src/adapters/llm/BrowserOpenAIProvider.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import { withRetry } from '../../src/resilience/withRetry.js';
import { withFallback } from '../../src/resilience/withFallback.js';
import { withCircuitBreaker } from '../../src/resilience/withCircuitBreaker.js';
import { DEFAULT_CARRIES_IN_MESSAGES } from '../../src/adapters/types.js';
import type { LLMProvider, LLMRequest, LLMResponse, WireRole } from '../../src/adapters/types.js';

const FLOOR: readonly WireRole[] = ['user', 'assistant'];
const ALL: readonly WireRole[] = ['system', 'user', 'assistant'];

function stub(name: string, carriesInMessages?: readonly WireRole[]): LLMProvider {
  return {
    name,
    ...(carriesInMessages !== undefined && { carriesInMessages }),
    complete: (_req: LLMRequest): Promise<LLMResponse> =>
      Promise.resolve({
        content: 'ok',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      } as LLMResponse),
  };
}

describe('the declared capability matches the wire', () => {
  it("the Anthropic family carries user and assistant — never 'system'", () => {
    // Each of these drops `role: 'system'` in its own message serializer,
    // because system rides a separate top-level field.
    expect(anthropic({ _client: {} as never }).carriesInMessages).toEqual(FLOOR);
    expect(bedrock({ _client: {} as never, _commands: {} as never }).carriesInMessages).toEqual(
      FLOOR,
    );
    expect(browserAnthropic({ apiKey: 'k' }).carriesInMessages).toEqual(FLOOR);
  });

  it('the OpenAI family carries all three', () => {
    // The chat-completions shape takes the system prompt as a message like any
    // other (as `developer` on reasoning models).
    expect(openai({ _client: {} as never }).carriesInMessages).toEqual(ALL);
    expect(ollama({ _client: {} as never }).carriesInMessages).toEqual(ALL);
    expect(azureOpenai({ _client: {} as never, deployment: 'd' }).carriesInMessages).toEqual(ALL);
    expect(browserOpenai({ apiKey: 'k' }).carriesInMessages).toEqual(ALL);
    expect(
      browserAzureOpenai({
        apiKey: 'k',
        endpoint: 'https://x.openai.azure.com',
        apiVersion: '2024-12-01-preview',
        deployment: 'd',
      }).carriesInMessages,
    ).toEqual(ALL);
  });

  it('the mock carries all three — it never filters by role', () => {
    expect(new MockProvider().carriesInMessages).toEqual(ALL);
  });

  it('the floor is user/assistant, and it is what absence means', () => {
    expect(DEFAULT_CARRIES_IN_MESSAGES).toEqual(FLOOR);
    // A third-party adapter that declares nothing is NOT assumed permissive.
    expect(stub('third-party').carriesInMessages).toBeUndefined();
  });
});

describe('decorators forward the capability instead of losing it', () => {
  it('withRetry and withCircuitBreaker keep the inner wire’s roles', () => {
    // Both rebuild the provider object; a dropped field would silently narrow
    // a wrapped OpenAI provider to the floor and start refusing system-role
    // delivery it can perfectly well do.
    expect(withRetry(stub('openai-like', ALL)).carriesInMessages).toEqual(ALL);
    expect(withCircuitBreaker(stub('openai-like', ALL)).carriesInMessages).toEqual(ALL);
    // And absence stays absence — a wrapper does not invent a capability.
    expect(withRetry(stub('third-party')).carriesInMessages).toBeUndefined();
    expect(withCircuitBreaker(stub('third-party')).carriesInMessages).toBeUndefined();
  });

  it('withFallback publishes the INTERSECTION of the pair', () => {
    // Either side may serve the call, so a role only one of them carries is a
    // role the call might drop — exactly the provider-dependent recording the
    // capability exists to prevent.
    expect(
      withFallback(stub('openai-like', ALL), stub('anthropic-like', FLOOR)).carriesInMessages,
    ).toEqual(FLOOR);
    expect(
      withFallback(stub('anthropic-like', FLOOR), stub('openai-like', ALL)).carriesInMessages,
    ).toEqual(FLOOR);
    // Two permissive providers keep the permissive answer.
    expect(withFallback(stub('a', ALL), stub('b', ALL)).carriesInMessages).toEqual(ALL);
    // An undeclared partner clamps the pair to the floor.
    expect(withFallback(stub('a', ALL), stub('b')).carriesInMessages).toEqual(FLOOR);
  });
});
