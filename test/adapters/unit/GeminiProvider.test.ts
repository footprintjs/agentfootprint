/**
 * `gemini()` — the translation, both directions, on a structural double.
 *
 * Nothing here reaches Google, and nothing here needs a credential: the whole
 * suite drives the adapter through `_client`, a `{ models: { … } }` object
 * exposing only the two operations this adapter dispatches. That is the same
 * double the Google surface pin injects — see
 * `test/adapters/google/googlePin.ts` for the reality and version halves of the
 * claim.
 *
 * The seven kinds, in order: unit (request mapping), unit (response mapping),
 * functional (streaming), refusals, capabilities, error translation, and one
 * integration run through a real `Agent` so the tool round-trip is proved by a
 * loop rather than by an assertion about one request.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  gemini,
  GeminiProvider,
  type GeminiClientLike,
  type GeminiContent,
  type GeminiGenerateParams,
  type GeminiGenerateResponse,
} from '../../../src/adapters/llm/GeminiProvider.js';
import { Agent, defineTool } from '../../../src/index.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

// ── The double ───────────────────────────────────────────────────────

interface Recorder {
  readonly params: GeminiGenerateParams[];
  readonly client: GeminiClientLike;
}

/**
 * A `{ models: { … } }` double.
 *
 * `generateContentStream` answers with a PROMISE of an async generator, exactly
 * as `@google/genai` does — so an adapter that forgot to await it would iterate
 * a promise and yield nothing, and the streaming tests below would fail rather
 * than quietly pass on a shape the real SDK does not have.
 */
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

/** A response carrying one text part. */
const textAnswer = (text: string): GeminiGenerateResponse => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3 },
  responseId: 'resp-1',
});

const REQUEST: LLMRequest = { model: 'gemini', messages: [{ role: 'user', content: 'hi' }] };

const TOOL = {
  name: 'lookup',
  description: 'look something up',
  inputSchema: {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
    additionalProperties: false,
  },
};

// ── 1. Unit — the request ────────────────────────────────────────────

describe('gemini — what goes on the wire', () => {
  it('puts the system prompt in config.systemInstruction, never in contents', async () => {
    const fake = fakeGemini({ complete: textAnswer('ok') });
    await gemini({ _client: fake.client }).complete({
      model: 'gemini',
      systemPrompt: 'be terse',
      messages: [
        // A `role: 'system'` message inside `messages` is DROPPED — the wire
        // has no place for it, which is exactly what `carriesInMessages`
        // declares so the agent can refuse such an injection at run start.
        { role: 'system', content: 'this one has nowhere to go' },
        { role: 'user', content: 'hi' },
      ],
    });
    const sent = fake.params[0]!;
    expect(sent.config?.systemInstruction).toBe('be terse');
    expect(sent.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('resolves the `gemini` shorthand to the default model and lets a full id win', async () => {
    const fake = fakeGemini({ complete: textAnswer('ok') });
    const provider = gemini({ _client: fake.client, defaultModel: 'gemini-2.5-pro' });
    await provider.complete(REQUEST);
    await provider.complete({ ...REQUEST, model: 'gemini-2.5-flash-lite' });
    expect(fake.params.map((p) => p.model)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash-lite']);
  });

  it('threads temperature, maxTokens, stop and the abort signal', async () => {
    const fake = fakeGemini({ complete: textAnswer('ok') });
    const controller = new AbortController();
    await gemini({ _client: fake.client }).complete({
      ...REQUEST,
      temperature: 0.2,
      maxTokens: 512,
      stop: ['STOP'],
      signal: controller.signal,
    });
    expect(fake.params[0]?.config).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 512,
      stopSequences: ['STOP'],
      abortSignal: controller.signal,
    });
  });

  it('sends tools as functionDeclarations with the JSON Schema UNTRANSLATED', async () => {
    const fake = fakeGemini({ complete: textAnswer('ok') });
    await gemini({ _client: fake.client }).complete({ ...REQUEST, tools: [TOOL] });
    const declarations = fake.params[0]?.config?.tools?.[0]?.functionDeclarations;
    expect(declarations).toEqual([
      {
        name: 'lookup',
        description: 'look something up',
        parametersJsonSchema: TOOL.inputSchema,
      },
    ]);
    // The OpenAPI-flavoured sibling field is never set: sending both is how an
    // adapter's tool schemas quietly stop being the ones it was given.
    expect(declarations?.[0]).not.toHaveProperty('parameters');
    // `additionalProperties` survives, which is the whole point of the JSON
    // Schema door — the OpenAI-compatible endpoint's OpenAPI subset drops it.
    expect(
      (declarations?.[0]?.parametersJsonSchema as { additionalProperties?: unknown })
        .additionalProperties,
    ).toBe(false);
  });

  it('forces one named tool with mode ANY + allowedFunctionNames', async () => {
    const fake = fakeGemini({ complete: textAnswer('{}') });
    await gemini({ _client: fake.client }).complete({
      ...REQUEST,
      tools: [TOOL],
      toolChoice: { type: 'tool', name: 'lookup' },
    });
    expect(fake.params[0]?.config?.toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] },
    });
  });

  it('never sends a tool choice on a request that carries no tools', async () => {
    const fake = fakeGemini({ complete: textAnswer('ok') });
    await gemini({ _client: fake.client }).complete({
      ...REQUEST,
      toolChoice: { type: 'tool', name: 'lookup' },
    });
    expect(fake.params[0]?.config?.toolConfig).toBeUndefined();
  });

  it('threads the thinking BUDGET and asks for nothing it cannot carry back', async () => {
    const fake = fakeGemini({ complete: textAnswer('ok') });
    await gemini({ _client: fake.client }).complete({ ...REQUEST, thinking: { budget: 2048 } });
    expect(fake.params[0]?.config?.thinkingConfig).toEqual({ thinkingBudget: 2048 });
    // `includeThoughts` is deliberately absent: thought parts carry a signature
    // that has to be echoed byte-exact, and there is no Gemini ThinkingHandler
    // in this release to round-trip them.
    expect(fake.params[0]?.config?.thinkingConfig).not.toHaveProperty('includeThoughts');
  });

  it('rebuilds an assistant tool turn as `model` + functionCall, and results as one user turn', async () => {
    const fake = fakeGemini({ complete: textAnswer('done') });
    await gemini({ _client: fake.client }).complete({
      model: 'gemini',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: 'checking',
          toolCalls: [
            { id: 'srv-1', name: 'lookup', args: { q: 'a' } },
            { id: 'srv-2', name: 'lookup', args: { q: 'b' } },
          ],
        },
        { role: 'tool', toolCallId: 'srv-1', toolName: 'lookup', content: 'A' },
        { role: 'tool', toolCallId: 'srv-2', toolName: 'lookup', content: 'B' },
      ],
    });
    const contents = fake.params[0]!.contents as readonly GeminiContent[];
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'weather?' }] },
      {
        role: 'model',
        parts: [
          { text: 'checking' },
          { functionCall: { id: 'srv-1', name: 'lookup', args: { q: 'a' } } },
          { functionCall: { id: 'srv-2', name: 'lookup', args: { q: 'b' } } },
        ],
      },
      // BOTH results in ONE user turn — the coalescing Gemini expects after a
      // reply that called two functions.
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'srv-1', name: 'lookup', response: { output: 'A' } } },
          { functionResponse: { id: 'srv-2', name: 'lookup', response: { output: 'B' } } },
        ],
      },
    ]);
  });

  it('never sends back an id it invented itself', async () => {
    // Round trip: Gemini answered WITHOUT an id, so the adapter made one up for
    // the agent's own bookkeeping. Sending that id back would be a
    // `functionResponse.id` the service never issued.
    const fake = fakeGemini({
      complete: {
        candidates: [{ content: { parts: [{ functionCall: { name: 'lookup', args: {} } }] } }],
      },
    });
    const provider = gemini({ _client: fake.client });
    const first = await provider.complete({ ...REQUEST, tools: [TOOL] });
    const invented = first.toolCalls[0]!.id;
    expect(invented).toBe('gemini-call-1');

    await provider.complete({
      model: 'gemini',
      messages: [
        { role: 'user', content: 'weather?' },
        { role: 'assistant', content: '', toolCalls: [...first.toolCalls] },
        { role: 'tool', toolCallId: invented, toolName: 'lookup', content: 'A' },
      ],
    });
    const contents = fake.params[1]!.contents as readonly GeminiContent[];
    expect(contents[1]?.parts[0]?.functionCall).toEqual({ name: 'lookup', args: {} });
    expect(contents[2]?.parts[0]?.functionResponse).toEqual({
      name: 'lookup',
      response: { output: 'A' },
    });
  });

  it('keeps an empty assistant turn in place so the alternation survives', async () => {
    const fake = fakeGemini({ complete: textAnswer('ok') });
    await gemini({ _client: fake.client }).complete({
      model: 'gemini',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'b' },
      ],
    });
    expect((fake.params[0]!.contents as readonly GeminiContent[])[1]).toEqual({
      role: 'model',
      parts: [{ text: '' }],
    });
  });

  it('sends no `config` at all when the request asks for nothing', async () => {
    const fake = fakeGemini({ complete: textAnswer('ok') });
    await gemini({ _client: fake.client }).complete(REQUEST);
    expect(fake.params[0]).toEqual({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
  });
});

// ── 2. Unit — the response ───────────────────────────────────────────

describe('gemini — what comes back', () => {
  it('joins text parts, reads tool calls, and reports the id Google gave', async () => {
    const fake = fakeGemini({
      complete: {
        candidates: [
          {
            content: {
              parts: [
                { text: 'one ' },
                { text: 'two' },
                { functionCall: { id: 'srv-9', name: 'lookup', args: { q: 'x' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        responseId: 'resp-42',
      },
    });
    const answer = await gemini({ _client: fake.client }).complete({ ...REQUEST, tools: [TOOL] });
    expect(answer.content).toBe('one two');
    expect(answer.toolCalls).toEqual([{ id: 'srv-9', name: 'lookup', args: { q: 'x' } }]);
    expect(answer.providerRef).toBe('resp-42');
  });

  it('keeps a thought-summary part OUT of the visible answer', async () => {
    const fake = fakeGemini({
      complete: {
        candidates: [
          {
            content: {
              parts: [
                { text: 'let me reason about this', thought: true },
                { text: 'the answer is 4' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    });
    const answer = await gemini({ _client: fake.client }).complete(REQUEST);
    expect(answer.content).toBe('the answer is 4');
  });

  it('reports cached and thinking tokens as their own numbers', async () => {
    const fake = fakeGemini({
      complete: {
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 1200,
          candidatesTokenCount: 90,
          cachedContentTokenCount: 1000,
          thoughtsTokenCount: 250,
          totalTokenCount: 1540,
        },
      },
    });
    const answer = await gemini({ _client: fake.client }).complete(REQUEST);
    expect(answer.usage).toEqual({
      input: 1200,
      output: 90,
      cacheRead: 1000,
      thinking: 250,
    });
  });

  it('leaves cacheRead and thinking UNDEFINED when the wire did not say', async () => {
    const fake = fakeGemini({ complete: textAnswer('ok') });
    const answer = await gemini({ _client: fake.client }).complete(REQUEST);
    expect(answer.usage).toEqual({ input: 11, output: 3 });
    expect(answer.usage.cacheRead).toBeUndefined();
    expect(answer.usage.thinking).toBeUndefined();
    // `cacheWrite` has no `generateContent` source at all — caching is created
    // by a separate call this adapter does not make.
    expect(answer.usage.cacheWrite).toBeUndefined();
  });

  it('maps finish reasons conservatively and passes the rest through unchanged', async () => {
    const cases: readonly [string | undefined, boolean, string][] = [
      ['STOP', false, 'stop'],
      // Gemini has NO tool_use finish reason — a function call still ends STOP.
      ['STOP', true, 'tool_use'],
      [undefined, true, 'tool_use'],
      [undefined, false, 'stop'],
      ['MAX_TOKENS', false, 'max_tokens'],
      ['SAFETY', false, 'content_filter'],
      ['PROHIBITED_CONTENT', false, 'content_filter'],
      ['BLOCKLIST', false, 'content_filter'],
      ['SPII', false, 'content_filter'],
      // Real answers with no equivalent in our vocabulary. Guessing the nearest
      // word would be this adapter answering on the model's behalf.
      ['RECITATION', false, 'RECITATION'],
      ['MALFORMED_FUNCTION_CALL', false, 'MALFORMED_FUNCTION_CALL'],
      ['TOO_MANY_TOOL_CALLS', false, 'TOO_MANY_TOOL_CALLS'],
      ['A_REASON_INVENTED_AFTER_THIS_RELEASE', false, 'A_REASON_INVENTED_AFTER_THIS_RELEASE'],
    ];
    for (const [raw, withCall, expected] of cases) {
      const fake = fakeGemini({
        complete: {
          candidates: [
            {
              content: {
                parts: withCall
                  ? [{ functionCall: { name: 'lookup', args: {} } }]
                  : [{ text: 'x' }],
              },
              ...(raw !== undefined && { finishReason: raw }),
            },
          ],
        },
      });
      const answer = await gemini({ _client: fake.client }).complete(REQUEST);
      expect(answer.stopReason, `${String(raw)} + calls:${String(withCall)}`).toBe(expected);
    }
  });

  it('survives a response with no candidates at all', async () => {
    const fake = fakeGemini({ complete: {} });
    const answer = await gemini({ _client: fake.client }).complete(REQUEST);
    expect(answer).toMatchObject({ content: '', toolCalls: [], stopReason: 'stop' });
    expect(answer.usage).toEqual({ input: 0, output: 0 });
  });
});

// ── 3. Functional — streaming ────────────────────────────────────────

describe('gemini — streaming', () => {
  it('yields text deltas and closes with the authoritative response', async () => {
    const fake = fakeGemini({
      chunks: [
        { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'lo' }] } }] },
        {
          candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, thoughtsTokenCount: 5 },
          responseId: 'resp-stream',
        },
      ],
    });
    const chunks = [];
    for await (const chunk of gemini({ _client: fake.client }).stream!(REQUEST)) chunks.push(chunk);

    expect(chunks.filter((c) => !c.done).map((c) => c.content)).toEqual(['Hel', 'lo']);
    const last = chunks[chunks.length - 1]!;
    expect(last.done).toBe(true);
    expect(last.response).toMatchObject({
      content: 'Hello',
      stopReason: 'stop',
      providerRef: 'resp-stream',
    });
    // The counts ride the chunk whose candidate carries NO new text. Reading
    // usage after a content guard is how streamed turns come to bill as zero.
    expect(last.response?.usage).toEqual({ input: 7, output: 2, thinking: 5 });
  });

  it('accumulates function calls across chunks and reports tool_use', async () => {
    const fake = fakeGemini({
      chunks: [
        { candidates: [{ content: { parts: [{ text: 'looking' }] } }] },
        {
          candidates: [
            { content: { parts: [{ functionCall: { name: 'lookup', args: { q: 'a' } } }] } },
          ],
        },
        {
          candidates: [
            {
              content: {
                parts: [{ functionCall: { id: 'srv-2', name: 'lookup', args: { q: 'b' } } }],
              },
              finishReason: 'STOP',
            },
          ],
        },
      ],
    });
    const chunks = [];
    for await (const chunk of gemini({ _client: fake.client }).stream!({
      ...REQUEST,
      tools: [TOOL],
    })) {
      chunks.push(chunk);
    }
    const response = chunks[chunks.length - 1]!.response!;
    expect(response.stopReason).toBe('tool_use');
    expect(response.toolCalls).toEqual([
      { id: 'gemini-call-1', name: 'lookup', args: { q: 'a' } },
      { id: 'srv-2', name: 'lookup', args: { q: 'b' } },
    ]);
  });

  it('reports ZERO rather than an estimate when the stream carried no usage', async () => {
    const fake = fakeGemini({
      chunks: [{ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] }],
    });
    const chunks = [];
    for await (const chunk of gemini({ _client: fake.client }).stream!(REQUEST)) chunks.push(chunk);
    // `countTokens` is on the namespace and is deliberately never called: it
    // answers what a request tokenises to, not what the call was billed for.
    expect(chunks[chunks.length - 1]!.response?.usage).toEqual({ input: 0, output: 0 });
  });

  it('never streams a thought part as visible content', async () => {
    const fake = fakeGemini({
      chunks: [
        { candidates: [{ content: { parts: [{ text: 'hmm', thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] },
      ],
    });
    const chunks = [];
    for await (const chunk of gemini({ _client: fake.client }).stream!(REQUEST)) chunks.push(chunk);
    expect(chunks.filter((c) => !c.done).map((c) => c.content)).toEqual(['answer']);
    expect(chunks[chunks.length - 1]!.response?.content).toBe('answer');
  });
});

// ── 4. Refusals ──────────────────────────────────────────────────────

describe('gemini — refuses rather than half-configures', () => {
  /** An EMPTY variable is not a setting — `FOO=` must read as absent. */
  const clearGoogleEnv = (): void => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', '');
  };

  it('names BOTH doors when neither a project nor a key is resolvable', () => {
    clearGoogleEnv();
    try {
      expect(() => gemini()).toThrow(/no Google project and no API key/);
      expect(() => gemini()).toThrow(/GOOGLE_CLOUD_PROJECT/);
      expect(() => gemini()).toThrow(/GEMINI_API_KEY/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses `vertexai: true` without a project, and says which field addresses Vertex', () => {
    clearGoogleEnv();
    try {
      expect(() => gemini({ vertexai: true, apiKey: 'a-key-is-not-a-project' })).toThrow(
        /addressed by PROJECT/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('an injected _client short-circuits every one of those checks', () => {
    clearGoogleEnv();
    try {
      expect(() => gemini({ _client: fakeGemini().client })).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('names the install when @google/genai cannot be resolved', async () => {
    // The package IS a devDependency here (the pin's reality half needs it), so
    // absence has to be simulated — the same module stub the sqlite and MCP
    // suites use for their own peer deps.
    vi.resetModules();
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: (specifier: string): unknown => {
        throw new Error(`Cannot find module '${specifier}'`);
      },
    }));
    try {
      const { gemini: isolated } = await import('../../../src/adapters/llm/GeminiProvider.js');
      expect(() => isolated({ apiKey: 'k' })).toThrow(/requires the `@google\/genai` package/);
      expect(() => isolated({ apiKey: 'k' })).toThrow(/npm install @google\/genai/);
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });
});

// ── 5. Capabilities ──────────────────────────────────────────────────

describe('gemini — the capabilities it declares', () => {
  it('is an Anthropic-family wire: system rides OUTSIDE the turn list', () => {
    const provider = gemini({ _client: fakeGemini().client });
    expect(provider.carriesInMessages).toEqual(['user', 'assistant']);
    expect(provider.name).toBe('gemini');
  });

  it('declares forced tool choice, on both doors', () => {
    expect(gemini({ _client: fakeGemini().client }).carriesForcedToolChoice).toBe(true);
  });

  it('the class form is the factory, forwarding hooks', async () => {
    const fake = fakeGemini({ complete: textAnswer('ok') });
    const provider = new GeminiProvider({ _client: fake.client });
    expect(provider.carriesInMessages).toEqual(['user', 'assistant']);
    expect(provider.carriesForcedToolChoice).toBe(true);
    expect((await provider.complete(REQUEST)).content).toBe('ok');
    const chunks = [];
    for await (const chunk of provider.stream(REQUEST)) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

// ── 6. Error translation ─────────────────────────────────────────────

describe('gemini — errors', () => {
  const throwingClient = (err: unknown): GeminiClientLike => ({
    models: {
      generateContent: () => Promise.reject(err),
      generateContentStream: () => Promise.reject(err),
    },
  });

  it('prefixes and names an ordinary failure, keeping the status a retry policy reads', async () => {
    const provider = gemini({
      _client: throwingClient(Object.assign(new Error('service unavailable'), { status: 503 })),
    });
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      name: 'GeminiProviderError',
      message: '[gemini] service unavailable',
      status: 503,
    });
  });

  it('translates Google’s over-long-request sentence, with both numbers', async () => {
    const provider = gemini({
      _client: throwingClient(
        Object.assign(
          new Error(
            'The input token count (1200293) exceeds the maximum number of tokens allowed ' +
              '(1048576).',
          ),
          { status: 400 },
        ),
      ),
    });
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      name: 'ContextWindowExceededError',
      provider: 'gemini',
      actualTokens: 1_200_293,
      limitTokens: 1_048_576,
      status: 400,
    });
  });

  it('translates on the STREAM path too', async () => {
    const provider = gemini({
      _client: throwingClient(
        new Error(
          'The input token count () exceeds the maximum number of tokens allowed (131072).',
        ),
      ),
    });
    await expect(async () => {
      for await (const _chunk of provider.stream!(REQUEST)) {
        /* drain */
      }
    }).rejects.toMatchObject({
      name: 'ContextWindowExceededError',
      // Google sometimes ships the first parenthesis EMPTY. The half it stated
      // is still reported; the half it did not is absent rather than invented.
      limitTokens: 131_072,
      actualTokens: undefined,
    });
  });
});

// ── 7. Integration — a real Agent loop over the double ───────────────

describe('gemini — a whole tool round-trip through Agent', () => {
  it('calls the tool, sends the result back as a functionResponse, and finishes', async () => {
    const calls: GeminiGenerateParams[] = [];
    let turn = 0;
    /** Turn 1 asks for the tool; turn 2 answers. Both wires serve both turns,
     *  because an Agent picks the wire and this test is about the round trip. */
    const scripted = (): GeminiGenerateResponse => {
      turn++;
      return turn === 1
        ? {
            candidates: [
              {
                content: { parts: [{ functionCall: { name: 'lookup', args: { q: 'fabric' } } }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
          }
        : {
            candidates: [
              { content: { parts: [{ text: 'there are 12 rolls' }] }, finishReason: 'STOP' },
            ],
            usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 6 },
          };
    };
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

    const lookup = defineTool({
      name: 'lookup',
      description: 'look something up',
      parameters: { q: { type: 'string', description: 'what to look up' } },
      execute: ({ q }: { q: string }) => `12 rolls of ${q}`,
    });

    const agent = Agent.create({ provider: gemini({ _client: client }), model: 'gemini' })
      .tool(lookup)
      .build();

    const answer = await agent.run({ message: 'how much fabric?' });
    expect(String(answer)).toContain('12 rolls');
    expect(calls).toHaveLength(2);

    // The SECOND request is the proof: the tool result went back as a
    // functionResponse inside a user turn, carrying the tool's NAME (which is
    // what Gemini matches on) and not the id this adapter invented.
    const second = calls[1]!.contents as readonly GeminiContent[];
    const responsePart = second
      .flatMap((c) => c.parts)
      .find((p) => p.functionResponse !== undefined)!;
    expect(responsePart.functionResponse?.name).toBe('lookup');
    expect(responsePart.functionResponse?.id).toBeUndefined();
    expect(String(responsePart.functionResponse?.response?.output)).toContain('12 rolls');
  });
});
