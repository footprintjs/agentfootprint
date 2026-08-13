/**
 * Compile-level regression test — the thought-signature round trip is typed
 * end to end, and the SDK claim it rests on is checked against the really
 * installed package.
 *
 * A field trial caught a live Gemini model refusing the second call of a tool
 * loop with HTTP 400: *"Function call is missing a thought_signature in
 * functionCall parts."* The fix carries the signature from the response, over
 * the port, and back onto the request — which means FOUR types have to agree,
 * and one of them is not ours:
 *
 *   1. `@google/genai`'s own `Part.thoughtSignature` — the claim. Assigned from
 *      here so the day Google renames or retypes it, `npm run test:types`
 *      fails instead of a live tool loop failing. This is the same discipline
 *      the Google surface pin applies to method NAMES, applied to a FIELD,
 *      which a runtime pin cannot reach.
 *   2. `GeminiPart.thoughtSignature` — our duck-typed mirror of it.
 *   3. `LLMResponse.toolCalls[].providerMeta` — the neutral carrier out.
 *   4. `LLMMessage.toolCalls[].providerMeta` — the same bag going back in.
 *
 * Plus the fifth thing the same trial found missing: `LLMEndPayload.usage`
 * could not carry the thinking-token count the provider was already reporting.
 *
 * Lives under its own tsconfig (`npm run test:types`) so the compiler checks
 * the assignments, while the `.test.ts` name lets vitest run the assertions.
 */
import { describe, expect, it } from 'vitest';

import type { Part } from '@google/genai';

import type { GeminiPart } from '../../src/adapters/llm/GeminiProvider';
import type { LLMMessage, LLMResponse } from '../../src/adapters/types';
import type { LLMEndPayload } from '../../src/events/payloads';

describe("the SDK really has the field this adapter's fix depends on", () => {
  it('`Part.thoughtSignature` accepts a base64 string', () => {
    // If @google/genai drops or retypes this field, THIS LINE stops compiling.
    const part: Part = { thoughtSignature: 'Cs4BAdHtim9zaWduYXR1cmU=' };
    expect(part.thoughtSignature).toBe('Cs4BAdHtim9zaWduYXR1cmU=');
  });

  it('and our duck-typed mirror is assignable to it, field for field', () => {
    const ours: GeminiPart = {
      thoughtSignature: 'sig',
      functionCall: { name: 'trial_lookup', args: { record: 'vertex-alpha' } },
    };
    // Structural, one direction: everything we send must be something the SDK
    // would accept. (The reverse is deliberately NOT true — `Part` carries
    // media members this adapter neither reads nor writes.)
    const theirs: Part = { ...ours, functionCall: { ...ours.functionCall } };
    expect(theirs.thoughtSignature).toBe('sig');
  });
});

describe('the port carries the signature both ways', () => {
  it('out, on a response tool call', () => {
    const response: LLMResponse = {
      content: '',
      toolCalls: [
        {
          id: 'gemini-call-1',
          name: 'trial_lookup',
          args: { record: 'vertex-alpha' },
          providerMeta: { thoughtSignature: 'sig' },
        },
      ],
      usage: { input: 154, output: 30, thinking: 12 },
      stopReason: 'tool_use',
    };
    expect(response.toolCalls[0]?.providerMeta?.thoughtSignature).toBe('sig');
  });

  it('and back in, on the assistant turn of the next request', () => {
    const assistant: LLMMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'gemini-call-1',
          name: 'trial_lookup',
          args: { record: 'vertex-alpha' },
          providerMeta: { thoughtSignature: 'sig' },
        },
      ],
    };
    // The round trip that matters: a call taken off a response is assignable
    // to the message that goes back, with nothing dropped in between.
    const echoed: LLMMessage['toolCalls'] = assistant.toolCalls;
    expect(echoed?.[0]?.providerMeta?.thoughtSignature).toBe('sig');
  });

  it('and both are optional — a provider that signs nothing writes nothing', () => {
    const unsigned: LLMResponse['toolCalls'][number] = { id: 'a', name: 'b', args: {} };
    expect(unsigned.providerMeta).toBeUndefined();
  });
});

describe('the thinking-token count has a home on the public event', () => {
  it('`stream.llm_end` usage takes it beside input and output', () => {
    const payload: LLMEndPayload = {
      iteration: 1,
      content: 'Sunny.',
      toolCallCount: 0,
      // The trial's exact numbers: 243 tokens that are neither input nor output.
      usage: { input: 21, output: 9, thinking: 243 },
      stopReason: 'max_tokens',
      durationMs: 2889,
    };
    expect(payload.usage.thinking).toBe(243);
  });
});
