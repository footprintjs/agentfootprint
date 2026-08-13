/**
 * THE GEMINI FIELD-TRUTH SUITE (9.29.0).
 *
 * Every case here exists because an independent field trial on a live Google
 * Cloud project produced a fact this package did not have. Nothing is
 * speculative and nothing reaches Google: each observed shape — the 400, the
 * 404, the usage triple — is reproduced against the `{ models: { … } }` double
 * the rest of the Gemini suite uses.
 *
 * The four facts, and where they came from:
 *
 *   1. **thought signatures** — `gemini-3.1-flash-lite` refused the SECOND call
 *      of an ordinary tool loop with HTTP 400 *"Function call is missing a
 *      thought_signature in functionCall parts"* — after the tool had already
 *      run (FINDINGS "Failure 4").
 *   2. **per-door model defaults** — the key door answered the package's
 *      documented default with HTTP 404 *"no longer available to new users"*
 *      (FINDINGS "Failure 1"), while the same model completed a full tool loop
 *      on Vertex.
 *   3. **typed thinking usage** — a 256-token stream reported
 *      `input 21, output 9, thinking 243`, and the third number had no home in
 *      the public event payload (FINDINGS "Failure 5" + documentation gaps).
 *   4. **apiKey as a callback** — an expired OAuth token returned HTTP 401 with
 *      nowhere to put a fresh one (FINDINGS "Part 2B").
 *
 * The seven kinds, in order: unit (response), unit (request), functional
 * (streaming), refusals, capabilities/doors, error translation (redaction under
 * a rotating key), and integration through a real `Agent` — the Failure-4 loop,
 * end to end. Zero-delta pins ride beside the cases they belong to.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  gemini,
  type GeminiClientLike,
  type GeminiContent,
  type GeminiGenerateParams,
  type GeminiGenerateResponse,
} from '../../../src/adapters/llm/GeminiProvider.js';
import { resolveGoogleDoor } from '../../../src/adapters/llm/googleGenAI.js';
import { Agent, defineTool } from '../../../src/index.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

// ── The double ───────────────────────────────────────────────────────

interface Recorder {
  readonly params: GeminiGenerateParams[];
  readonly client: GeminiClientLike;
}

function fakeGemini(
  answers: {
    complete?: GeminiGenerateResponse | (() => GeminiGenerateResponse);
    chunks?: readonly GeminiGenerateResponse[];
  } = {},
): Recorder {
  const params: GeminiGenerateParams[] = [];
  return {
    params,
    client: {
      models: {
        async generateContent(p) {
          params.push(p);
          const answer = answers.complete ?? {};
          return typeof answer === 'function' ? answer() : answer;
        },
        async generateContentStream(p) {
          params.push(p);
          const chunks = answers.chunks ?? [];
          return (async function* () {
            for (const chunk of chunks) yield chunk;
          })();
        },
      },
    },
  };
}

/** The signature the trial's model attached to its function call, in shape. */
const SIGNATURE = 'Cs4BAdHtim9wZWFzZS1kby1ub3QtZWRpdC1tZQ==';

/** A Vertex-door provider: the door with a default model. */
const vertexDoor = (client: GeminiClientLike): ReturnType<typeof gemini> =>
  gemini({ project: 'trial-project', location: 'global', _client: client });

const REQUEST: LLMRequest = { model: 'gemini', messages: [{ role: 'user', content: 'hi' }] };

/** One signed function call, the way the trial's model sent it. */
const signedCall = (signature = SIGNATURE): GeminiGenerateResponse => ({
  candidates: [
    {
      content: {
        parts: [
          {
            thoughtSignature: signature,
            functionCall: { name: 'trial_lookup', args: { record: 'vertex-alpha' } },
          },
        ],
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 154, candidatesTokenCount: 30 },
});

// ── 1. Unit — the response side ──────────────────────────────────────

describe('the thought signature comes OFF the part it belongs to', () => {
  it('lands on the tool call, under providerMeta', async () => {
    const fake = fakeGemini({ complete: signedCall() });
    const answer = await vertexDoor(fake.client).complete(REQUEST);

    expect(answer.toolCalls).toHaveLength(1);
    expect(answer.toolCalls[0]?.providerMeta).toEqual({ thoughtSignature: SIGNATURE });
    // The signature is not the call: name and args are untouched by it.
    expect(answer.toolCalls[0]?.name).toBe('trial_lookup');
    expect(answer.toolCalls[0]?.args).toEqual({ record: 'vertex-alpha' });
  });

  it('ZERO-DELTA: a call with no signature carries no providerMeta at all', async () => {
    const fake = fakeGemini({
      complete: {
        candidates: [
          {
            content: { parts: [{ functionCall: { id: 'srv-1', name: 'lookup', args: {} } }] },
            finishReason: 'STOP',
          },
        ],
      },
    });
    const answer = await vertexDoor(fake.client).complete(REQUEST);

    // Not `{}`, not `{ thoughtSignature: undefined }` — absent. An empty bag on
    // every 2.5-series tool call would be noise in every recording ever made.
    expect(answer.toolCalls[0]).toEqual({ id: 'srv-1', name: 'lookup', args: {} });
    expect('providerMeta' in answer.toolCalls[0]!).toBe(false);
  });

  it('ZERO-DELTA: an empty-string signature is treated as none', async () => {
    const fake = fakeGemini({ complete: signedCall('') });
    const answer = await vertexDoor(fake.client).complete(REQUEST);
    expect('providerMeta' in answer.toolCalls[0]!).toBe(false);
  });
});

// ── 2. Unit — the request side ───────────────────────────────────────

describe('and goes back onto the part it came from', () => {
  const assistantTurn = (providerMeta?: Record<string, unknown>): LLMRequest => ({
    model: 'gemini',
    messages: [
      { role: 'user', content: 'look up vertex-alpha' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'gemini-call-1',
            name: 'trial_lookup',
            args: { record: 'vertex-alpha' },
            ...(providerMeta && { providerMeta }),
          },
        ],
      },
      {
        role: 'tool',
        content: 'VERTEX-AF-9137',
        toolCallId: 'gemini-call-1',
        toolName: 'trial_lookup',
      },
    ],
  });

  it('byte-exact, on the part beside the functionCall', async () => {
    const fake = fakeGemini({ complete: { candidates: [] } });
    await vertexDoor(fake.client).complete(assistantTurn({ thoughtSignature: SIGNATURE }));

    const modelTurn = (fake.params[0]!.contents as readonly GeminiContent[]).find(
      (c) => c.role === 'model',
    )!;
    const part = modelTurn.parts.find((p) => p.functionCall !== undefined)!;
    expect(part.thoughtSignature).toBe(SIGNATURE);
    expect(part.functionCall?.name).toBe('trial_lookup');
  });

  it('ZERO-DELTA: no signature in, no thoughtSignature field out', async () => {
    const fake = fakeGemini({ complete: { candidates: [] } });
    await vertexDoor(fake.client).complete(assistantTurn());

    const modelTurn = (fake.params[0]!.contents as readonly GeminiContent[]).find(
      (c) => c.role === 'model',
    )!;
    const part = modelTurn.parts.find((p) => p.functionCall !== undefined)!;
    expect('thoughtSignature' in part).toBe(false);
  });

  it('refuses to invent one from a providerMeta that is not a string', async () => {
    const fake = fakeGemini({ complete: { candidates: [] } });
    // A checkpoint round trip, a consumer's history edit, a JSON re-parse: any
    // of them can leave something here that is not a signature. Sending it
    // would be a GARBLED signature, which the service rejects less clearly
    // than a missing one.
    await vertexDoor(fake.client).complete(assistantTurn({ thoughtSignature: { nope: 1 } }));

    const modelTurn = (fake.params[0]!.contents as readonly GeminiContent[]).find(
      (c) => c.role === 'model',
    )!;
    expect('thoughtSignature' in modelTurn.parts.find((p) => p.functionCall)!).toBe(false);
  });
});

// ── 3. Functional — streaming ────────────────────────────────────────

describe('a STREAMED function call keeps its signature too', () => {
  it('reads it off the streamed part, not off the chunk', async () => {
    const fake = fakeGemini({
      chunks: [
        { candidates: [{ content: { parts: [{ text: 'looking…' }] } }] },
        signedCall(),
        {
          usageMetadata: { promptTokenCount: 22, candidatesTokenCount: 9, thoughtsTokenCount: 243 },
        },
      ],
    });

    const chunks = [];
    for await (const chunk of vertexDoor(fake.client).stream!(REQUEST)) chunks.push(chunk);
    const final = chunks[chunks.length - 1]!.response!;

    expect(final.toolCalls[0]?.providerMeta).toEqual({ thoughtSignature: SIGNATURE });
    // The trial's exact usage triple, and the reason `output` alone under-counts.
    expect(final.usage).toEqual({ input: 22, output: 9, thinking: 243 });
  });
});

// ── 4. Refusals — the doors do not share a default ───────────────────

describe('the model default is per DOOR, because the doors answered differently', () => {
  it('Vertex still resolves the shorthand — to the model the trial ran', async () => {
    const fake = fakeGemini({ complete: { candidates: [] } });
    await vertexDoor(fake.client).complete(REQUEST);
    expect(fake.params[0]!.model).toBe('gemini-2.5-flash');
  });

  it('the key door REFUSES the shorthand, and says what happened in the field', async () => {
    const fake = fakeGemini({ complete: { candidates: [] } });
    const provider = gemini({ apiKey: 'AIza-not-a-real-key-000000', _client: fake.client });

    await expect(provider.complete(REQUEST)).rejects.toThrow(/Gemini API \(AI Studio\) door/);
    await expect(provider.complete(REQUEST)).rejects.toThrow(/404/);
    await expect(provider.complete(REQUEST)).rejects.toThrow(/defaultModel/);
    // And it refused BEFORE the client was reached — no request was built.
    expect(fake.params).toHaveLength(0);
  });

  it('a request that NAMES a model is never refused, on either door', async () => {
    const fake = fakeGemini({ complete: { candidates: [] } });
    const provider = gemini({ apiKey: 'AIza-not-a-real-key-000000', _client: fake.client });
    await provider.complete({ ...REQUEST, model: 'gemini-3.1-flash-lite' });
    expect(fake.params[0]!.model).toBe('gemini-3.1-flash-lite');
  });

  it('and `defaultModel` answers the shorthand on the key door', async () => {
    const fake = fakeGemini({ complete: { candidates: [] } });
    const provider = gemini({
      apiKey: 'AIza-not-a-real-key-000000',
      defaultModel: 'gemini-3.1-flash-lite',
      _client: fake.client,
    });
    await provider.complete(REQUEST);
    expect(fake.params[0]!.model).toBe('gemini-3.1-flash-lite');
  });

  it('the streaming path refuses identically — one rule, both calls', async () => {
    const provider = gemini({ apiKey: 'AIza-not-a-real-key-000000', _client: fakeGemini().client });
    await expect(async () => {
      for await (const _c of provider.stream!(REQUEST)) {
        /* drain */
      }
    }).rejects.toThrow(/has no default/);
  });
});

// ── 5. Doors — which service a set of options addresses ──────────────

describe('resolveGoogleDoor names the service, the way the client does', () => {
  it('project → Vertex, key → the Gemini API, explicit `vertexai` wins both', () => {
    expect(resolveGoogleDoor({ project: 'p' }, false)).toBe('vertex');
    expect(resolveGoogleDoor({ apiKey: 'k' }, false)).toBe('gemini-api');
    expect(resolveGoogleDoor({ apiKey: 'k', vertexai: true }, false)).toBe('vertex');
    expect(resolveGoogleDoor({ project: 'p', vertexai: false }, false)).toBe('gemini-api');
    // A callback is a key that has not been fetched yet — still the key door.
    expect(resolveGoogleDoor({ apiKey: () => 'k' }, false)).toBe('gemini-api');
  });

  it('reads the environment only when asked to', () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-from-the-shell');
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', '');
    try {
      expect(resolveGoogleDoor({}, true)).toBe('gemini-api');
      // Which is why an injected `_client` does NOT read it: a double talks to
      // nobody, and an offline suite must not depend on a developer's shell.
      expect(resolveGoogleDoor({}, false)).toBe('vertex');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('an injected client keeps the Vertex default whatever the shell holds', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-from-the-shell');
    try {
      const fake = fakeGemini({ complete: { candidates: [] } });
      await gemini({ _client: fake.client }).complete(REQUEST);
      expect(fake.params[0]!.model).toBe('gemini-2.5-flash');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ── 6. The credential callback, and what it does to error redaction ──

describe('apiKey as a callback — the one-hour token, answered', () => {
  it('is called once per request, and the CURRENT key is what gets redacted', async () => {
    const keys = ['ya29.first-token-aaaaaaaaaaaa', 'ya29.second-token-bbbbbbbbbb'];
    let issued = 0;
    const echoing: GeminiClientLike = {
      models: {
        generateContent: () => Promise.reject(new Error(`401 from ${keys[issued - 1]}`)),
        generateContentStream: () => Promise.reject(new Error('unused')),
      },
    };
    const provider = gemini({
      apiKey: () => keys[issued++]!,
      defaultModel: 'gemini-2.5-flash',
      _client: echoing,
    });

    const first = await provider.complete(REQUEST).catch((e: Error) => e.message);
    const second = await provider.complete(REQUEST).catch((e: Error) => e.message);

    expect(issued).toBe(2);
    // Each failure was redacted against the key THAT call used — a redactor
    // pinned to construction time would have missed the second one entirely.
    expect(first).not.toContain(keys[0]);
    expect(second).not.toContain(keys[1]);
    expect(second).toContain('[redacted apiKey]');
  });

  it('an async callback is awaited', async () => {
    const fake = fakeGemini({ complete: { candidates: [] } });
    const provider = gemini({
      apiKey: async () => Promise.resolve('ya29.async-token-cccccccccc'),
      defaultModel: 'gemini-2.5-flash',
      _client: fake.client,
    });
    await provider.complete(REQUEST);
    expect(fake.params).toHaveLength(1);
  });

  it('refuses an empty answer without printing what it got', async () => {
    const provider = gemini({
      apiKey: () => '',
      defaultModel: 'gemini-2.5-flash',
      _client: fakeGemini().client,
    });
    await expect(provider.complete(REQUEST)).rejects.toThrow(/callback returned an empty string/);
    await expect(provider.complete(REQUEST)).rejects.toThrow(/before every request/);
  });

  it("a callback that throws reports the consumer's own reason", async () => {
    const provider = gemini({
      apiKey: () => {
        throw new Error('metadata server unreachable');
      },
      defaultModel: 'gemini-2.5-flash',
      _client: fakeGemini().client,
    });
    await expect(provider.complete(REQUEST)).rejects.toThrow(/metadata server unreachable/);
  });

  it('ZERO-DELTA: a string key is read once, not per call', async () => {
    // The string path must not have grown a per-request hop. Proved by the
    // absence of any callback to count, and by the request still arriving.
    const fake = fakeGemini({ complete: { candidates: [] } });
    const provider = gemini({ apiKey: 'AIza-fixed', defaultModel: 'm', _client: fake.client });
    await provider.complete(REQUEST);
    await provider.complete(REQUEST);
    expect(fake.params).toHaveLength(2);
  });
});

// ── 6b. The thinking tokens reach the event a consumer subscribes to ─

describe('thinking tokens survive all the way to stream.llm_end', () => {
  it('the trial\'s "one visible chunk" run is explainable from the payload alone', async () => {
    // The exact numbers the field trial saw: a 256-token budget where thinking
    // ate 243 and the answer got 9. Reading `input` and `output` alone, the run
    // is a mystery; reading `thinking`, it is arithmetic.
    const answer: GeminiGenerateResponse = {
      candidates: [{ content: { parts: [{ text: 'Sunny.' }] }, finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 21, candidatesTokenCount: 9, thoughtsTokenCount: 243 },
    };
    const client: GeminiClientLike = {
      models: {
        async generateContent() {
          return answer;
        },
        async generateContentStream() {
          return (async function* () {
            yield answer;
          })();
        },
      },
    };

    const agent = Agent.create({
      provider: gemini({ project: 'trial-project', _client: client }),
      model: 'gemini',
    }).build();

    const ends: { usage: { input: number; output: number; thinking?: number } }[] = [];
    agent.on('agentfootprint.stream.llm_end', (e) => {
      ends.push(e.payload as (typeof ends)[number]);
    });

    await agent.run({ message: 'weather?' });

    expect(ends).toHaveLength(1);
    expect(ends[0]!.usage.thinking).toBe(243);
    // And it is NOT folded into output — the two numbers are separate line
    // items on this wire, which is what makes `input + output` under-count.
    expect(ends[0]!.usage.output).toBe(9);
  });
});

// ── 7. Integration — the Failure-4 loop, end to end ──────────────────

describe('the tool loop the field trial could not complete', () => {
  it('sends the signature back on the second call, so the 400 cannot happen', async () => {
    const calls: GeminiGenerateParams[] = [];
    let turn = 0;
    /** Turn 1 asks for the tool, signed. Turn 2 answers. */
    const scripted = (): GeminiGenerateResponse => {
      turn += 1;
      if (turn === 1) return signedCall();
      return {
        candidates: [
          {
            content: { parts: [{ text: 'The validation code is VERTEX-AF-9137.' }] },
            finishReason: 'STOP',
          },
        ],
      };
    };
    // Both operations, because the agent streams by default and falls back to
    // `complete()` — a double that served only one would prove only one.
    const client: GeminiClientLike = {
      models: {
        async generateContent(params) {
          calls.push(params);
          return scripted();
        },
        async generateContentStream(params) {
          calls.push(params);
          const answer = scripted();
          return (async function* () {
            yield answer;
          })();
        },
      },
    };

    const trialLookup = defineTool({
      name: 'trial_lookup',
      description: 'look up a trial record',
      parameters: { record: { type: 'string', description: 'the record id' } },
      execute: () => 'VERTEX-AF-9137',
    });

    const agent = Agent.create({
      provider: gemini({ project: 'trial-project', _client: client }),
      model: 'gemini',
    })
      .tool(trialLookup)
      .build();

    const answer = await agent.run({ message: 'what is the code for vertex-alpha?' });
    expect(String(answer)).toContain('VERTEX-AF-9137');
    expect(calls).toHaveLength(2);

    // THE assertion. On the second request the assistant turn carries the
    // function call back — and the signature the model signed it with,
    // unchanged, on the same part. Without this the live service answered 400
    // AFTER the tool had already executed.
    const second = calls[1]!.contents as readonly GeminiContent[];
    const signedPart = second
      .flatMap((c) => c.parts)
      .find((p) => p.functionCall?.name === 'trial_lookup')!;
    expect(signedPart.thoughtSignature).toBe(SIGNATURE);

    // And the tool result still rides where Gemini expects it, by NAME.
    const responsePart = second.flatMap((c) => c.parts).find((p) => p.functionResponse)!;
    expect(responsePart.functionResponse?.name).toBe('trial_lookup');
  });
});
