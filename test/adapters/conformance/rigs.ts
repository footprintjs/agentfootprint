/**
 * One rig per LLM adapter factory AND per class form, for the cancellation
 * conformance (`abortConformance.ts`). Each builds the REAL adapter over a
 * mocked SDK client or `fetch` that ignores its signal, records it, and holds
 * its answer.
 *
 * Adding an adapter under `src/adapters/llm/`? Add its rig here — the listing
 * test in `abort.conformance.test.ts` fails until every runtime export of the
 * folder is either rigged or named, with its reason, as no adapter.
 */

import * as AnthropicProviderModule from '../../../src/adapters/llm/AnthropicProvider.js';
import * as BedrockProviderModule from '../../../src/adapters/llm/BedrockProvider.js';
import * as BrowserAnthropicProviderModule from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import * as BrowserOpenAIProviderModule from '../../../src/adapters/llm/BrowserOpenAIProvider.js';
import * as FoundryLocalProviderModule from '../../../src/adapters/llm/FoundryLocalProvider.js';
import * as FoundryProviderModule from '../../../src/adapters/llm/FoundryProvider.js';
import * as GeminiProviderModule from '../../../src/adapters/llm/GeminiProvider.js';
import * as InvokeModelGatewayProviderModule from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import * as MockProviderModule from '../../../src/adapters/llm/MockProvider.js';
import * as OllamaProviderModule from '../../../src/adapters/llm/OllamaProvider.js';
import * as OpenAIProviderModule from '../../../src/adapters/llm/OpenAIProvider.js';
import type { LLMProvider } from '../../../src/provider-contract/types.js';
import {
  gate,
  heldFetch,
  heldIterable,
  type AbortRig,
  type AdapterRig,
  type RigMode,
  type RigOptions,
} from './abortConformance.js';

/**
 * The adapter modules a rig list is built over, by file name under
 * `src/adapters/llm/`. The source's own (`SOURCE_MODULES`) for the main run;
 * the built package's, ESM or CJS, for `abort.conformance.dist.test.ts`.
 */
export interface AdapterModules {
  readonly AnthropicProvider: typeof AnthropicProviderModule;
  readonly BedrockProvider: typeof BedrockProviderModule;
  readonly BrowserAnthropicProvider: typeof BrowserAnthropicProviderModule;
  readonly BrowserOpenAIProvider: typeof BrowserOpenAIProviderModule;
  readonly FoundryLocalProvider: typeof FoundryLocalProviderModule;
  readonly FoundryProvider: typeof FoundryProviderModule;
  readonly GeminiProvider: typeof GeminiProviderModule;
  readonly InvokeModelGatewayProvider: typeof InvokeModelGatewayProviderModule;
  readonly MockProvider: typeof MockProviderModule;
  readonly OllamaProvider: typeof OllamaProviderModule;
  readonly OpenAIProvider: typeof OpenAIProviderModule;
}

export const SOURCE_MODULES: AdapterModules = {
  AnthropicProvider: AnthropicProviderModule,
  BedrockProvider: BedrockProviderModule,
  BrowserAnthropicProvider: BrowserAnthropicProviderModule,
  BrowserOpenAIProvider: BrowserOpenAIProviderModule,
  FoundryLocalProvider: FoundryLocalProviderModule,
  FoundryProvider: FoundryProviderModule,
  GeminiProvider: GeminiProviderModule,
  InvokeModelGatewayProvider: InvokeModelGatewayProviderModule,
  MockProvider: MockProviderModule,
  OllamaProvider: OllamaProviderModule,
  OpenAIProvider: OpenAIProviderModule,
};

type Build = (o: never) => LLMProvider;

// ─── Wire fixtures ──────────────────────────────────────────────────

const ANTHROPIC_MESSAGE = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5',
  content: [{ type: 'text', text: 'Hello there.' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 5, output_tokens: 3 },
};

const ANTHROPIC_EVENTS_FIRST = [
  {
    type: 'message_start',
    message: { ...ANTHROPIC_MESSAGE, content: [], stop_reason: null },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
];
const ANTHROPIC_EVENTS_REST = [
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'the' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 're.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
  { type: 'message_stop' },
];

/** `event:` + `data:` frames — the Anthropic API's own SSE framing. */
const namedSse = (events: readonly { type: string }[]): string =>
  events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
/** Bare `data:` frames — the InvokeModel gateway's and the OpenAI dialect's. */
const dataSse = (events: readonly unknown[]): string =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

const OPENAI_COMPLETION = {
  id: 'chatcmpl-1',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'Hello there.' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 3 },
};
const OPENAI_CHUNKS_FIRST = [
  { id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: 'Hello ' }, finish_reason: null }] },
];
const OPENAI_CHUNKS_REST = [
  {
    id: 'chatcmpl-1',
    choices: [{ index: 0, delta: { content: 'the' }, finish_reason: null }],
  },
  {
    id: 'chatcmpl-1',
    choices: [{ index: 0, delta: { content: 're.' }, finish_reason: 'stop' }],
  },
  { id: 'chatcmpl-1', choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } },
];

const OPENAI_SSE_WIRE = {
  completeBody: JSON.stringify(OPENAI_COMPLETION),
  streamFirst: dataSse(OPENAI_CHUNKS_FIRST),
  streamRest: `${dataSse(OPENAI_CHUNKS_REST)}data: [DONE]\n\n`,
  streamContentType: 'text/event-stream',
};

const GEMINI_RESPONSE = {
  candidates: [{ content: { parts: [{ text: 'Hello there.' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
  responseId: 'gem-1',
};

const CONVERSE_RESPONSE = {
  output: { message: { role: 'assistant', content: [{ text: 'Hello there.' }] } },
  stopReason: 'end_turn',
  usage: { inputTokens: 5, outputTokens: 3 },
};

// ─── SDK rigs ───────────────────────────────────────────────────────

/** The bookkeeping every SDK rig shares. */
function sdkState(options: RigOptions = {}) {
  const held = gate();
  const state = {
    held,
    hangingClose: options.hangingClose === true,
    signal: undefined as AbortSignal | undefined,
    dispatched: 0,
    closed: false,
    dispatch(signal: AbortSignal | undefined): void {
      state.dispatched++;
      state.signal = signal;
    },
  };
  return state;
}

function rigOf(provider: LLMProvider, s: ReturnType<typeof sdkState>): AbortRig {
  return {
    provider,
    signalSeen: () => s.signal,
    dispatched: () => s.dispatched,
    closed: () => s.closed,
    release: s.held.release,
  };
}

function anthropicRig(build: Build, options?: RigOptions): AbortRig {
  const s = sdkState(options);
  const client = {
    messages: {
      create(_params: unknown, options?: { signal?: AbortSignal }) {
        s.dispatch(options?.signal);
        return s.held.promise.then(() => ANTHROPIC_MESSAGE);
      },
      stream(_params: unknown, options?: { signal?: AbortSignal }) {
        s.dispatch(options?.signal);
        // A pending `return()` has closed nothing; the stream's `abort()` has.
        const events = heldIterable(
          ANTHROPIC_EVENTS_FIRST,
          ANTHROPIC_EVENTS_REST,
          s.held,
          () => {
            if (!s.hangingClose) s.closed = true;
          },
          s.hangingClose,
        );
        return {
          [Symbol.asyncIterator]: () => events[Symbol.asyncIterator](),
          finalMessage: async () => ANTHROPIC_MESSAGE,
          abort: () => {
            s.closed = true;
          },
        };
      },
    },
  };
  return rigOf(build({ _client: client } as never), s);
}

/** The `openai` SDK's shape: `create()` resolves to a completion or to a stream. */
function openaiClient(s: ReturnType<typeof sdkState>) {
  return {
    chat: {
      completions: {
        create(params: { stream?: boolean }, options?: { signal?: AbortSignal }) {
          s.dispatch(options?.signal);
          if (params.stream !== true) return s.held.promise.then(() => OPENAI_COMPLETION);
          // A pending `return()` has closed nothing; the controller's `abort()` has.
          const chunks = heldIterable(
            OPENAI_CHUNKS_FIRST,
            OPENAI_CHUNKS_REST,
            s.held,
            () => {
              if (!s.hangingClose) s.closed = true;
            },
            s.hangingClose,
          );
          return Promise.resolve({
            [Symbol.asyncIterator]: () => chunks[Symbol.asyncIterator](),
            controller: {
              abort: () => {
                s.closed = true;
              },
            },
          });
        },
      },
    },
  };
}

function openaiRig(build: Build, options?: RigOptions, extra: { baseURL?: string } = {}): AbortRig {
  const s = sdkState(options);
  return rigOf(build({ _client: openaiClient(s), ...extra } as never), s);
}

function azureOpenaiRig(build: Build, options?: RigOptions): AbortRig {
  const s = sdkState(options);
  return rigOf(build({ _client: openaiClient(s), deployment: 'dep-a' } as never), s);
}

function foundryRig(build: Build, options?: RigOptions): AbortRig {
  const s = sdkState(options);
  return rigOf(
    build({
      _client: openaiClient(s) as never,
      projectEndpoint: 'https://acct.services.ai.azure.com/api/projects/proj-1',
      deployment: 'dep-a',
    } as never),
    s,
  );
}

function bedrockRig(build: Build, options?: RigOptions): AbortRig {
  const s = sdkState(options);
  class Converse {
    constructor(public input: unknown) {}
  }
  class ConverseStream {
    constructor(public input: unknown) {}
  }
  const client = {
    send(cmd: unknown, options?: { abortSignal?: AbortSignal }) {
      s.dispatch(options?.abortSignal);
      if (!(cmd instanceof ConverseStream)) return s.held.promise.then(() => CONVERSE_RESPONSE);
      return Promise.resolve({
        stream: heldIterable(
          [{ contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'Hello ' } } }],
          [
            { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'there.' } } },
            { messageStop: { stopReason: 'end_turn' } },
            { metadata: { usage: { inputTokens: 5, outputTokens: 3 } } },
          ],
          s.held,
          () => {
            s.closed = true;
          },
          s.hangingClose,
        ),
      });
    },
  };
  return rigOf(
    build({
      client: client,
      sdk: { ConverseCommand: Converse, ConverseStreamCommand: ConverseStream },
    } as never),
    s,
  );
}

function geminiRig(build: Build, options?: RigOptions): AbortRig {
  const s = sdkState(options);
  const client = {
    models: {
      generateContent(params: { config?: { abortSignal?: AbortSignal } }) {
        s.dispatch(params.config?.abortSignal);
        return s.held.promise.then(() => GEMINI_RESPONSE);
      },
      generateContentStream(params: { config?: { abortSignal?: AbortSignal } }) {
        s.dispatch(params.config?.abortSignal);
        return Promise.resolve(
          heldIterable(
            [{ candidates: [{ content: { parts: [{ text: 'Hello ' }] } }] }],
            [
              {
                candidates: [{ content: { parts: [{ text: 'there.' }] }, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
                responseId: 'gem-1',
              },
            ],
            s.held,
            () => {
              s.closed = true;
            },
            s.hangingClose,
          ),
        );
      },
    },
  };
  return rigOf(build({ _client: client } as never), s);
}

// ─── fetch rigs ─────────────────────────────────────────────────────

function fetchRig(
  mode: RigMode,
  options: RigOptions | undefined,
  wire: Parameters<typeof heldFetch>[2],
  build: (fetchImpl: typeof fetch) => LLMProvider,
): AbortRig {
  const { fetch: fetchDouble, rig } = heldFetch(mode, options ?? {}, wire);
  return { provider: build(fetchDouble as typeof fetch), ...rig };
}

const ANTHROPIC_SSE_WIRE = {
  completeBody: JSON.stringify(ANTHROPIC_MESSAGE),
  streamFirst: namedSse(ANTHROPIC_EVENTS_FIRST),
  streamRest: namedSse(ANTHROPIC_EVENTS_REST),
  streamContentType: 'text/event-stream',
};

const GATEWAY_WIRE = {
  completeBody: JSON.stringify(ANTHROPIC_MESSAGE),
  streamFirst: dataSse(ANTHROPIC_EVENTS_FIRST),
  streamRest: dataSse(ANTHROPIC_EVENTS_REST),
  streamContentType: 'text/event-stream',
};

const OLLAMA_WIRE = {
  completeBody: JSON.stringify({
    message: { role: 'assistant', content: 'Hello there.' },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 5,
    eval_count: 3,
  }),
  streamFirst: `${JSON.stringify({
    message: { role: 'assistant', content: 'Hello ' },
    done: false,
  })}\n`,
  streamRest:
    `${JSON.stringify({ message: { role: 'assistant', content: 'the' }, done: false })}\n` +
    `${JSON.stringify({ message: { role: 'assistant', content: 're.' }, done: false })}\n` +
    `${JSON.stringify({
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 5,
      eval_count: 3,
    })}\n`,
  streamContentType: 'application/x-ndjson',
};

const GATEWAY_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

// ─── The list ───────────────────────────────────────────────────────

/** The mock has no wire; its hold is a long think, or a long gap after the first word. */
function mockRig(mode: RigMode, build: Build): AbortRig {
  let answered = 0;
  const provider = build({
    respond: () => {
      answered++;
      return 'Hello there, from the mock.';
    },
    thinkingMs: mode === 'complete' ? 60_000 : 0,
    chunkDelayMs: 60_000,
  } as never);
  return {
    provider,
    signalSeen: () => undefined,
    dispatched: () => answered,
    closed: () => false,
    release: () => undefined,
  };
}

const AZURE_BROWSER = {
  apiKey: 'az-test',
  endpoint: 'https://res.openai.azure.com',
  apiVersion: '2024-12-01-preview',
  deployment: 'dep-a',
};

const GATEWAY_OPTIONS = {
  baseUrl: 'https://gw.example.test',
  apiKeyHeader: 'api-key',
  apiKey: 'key-one',
  model: GATEWAY_MODEL,
};

const FOUNDRY_LOCAL_MODEL = 'qwen2.5-0.5b-instruct-generic-cpu:1';

/** One rig per factory and class form, over `m`. */
export function adapterRigs(m: AdapterModules): readonly AdapterRig[] {
  const { anthropic, AnthropicProvider } = m.AnthropicProvider;
  const { bedrock, BedrockProvider } = m.BedrockProvider;
  const { browserAnthropic, BrowserAnthropicProvider } = m.BrowserAnthropicProvider;
  const { browserAzureOpenai, BrowserAzureOpenAIProvider, browserOpenai, BrowserOpenAIProvider } =
    m.BrowserOpenAIProvider;
  const { foundry } = m.FoundryProvider;
  const { foundryLocal, FoundryLocalProvider } = m.FoundryLocalProvider;
  const { gemini, GeminiProvider } = m.GeminiProvider;
  const { invokeModelGateway, InvokeModelGatewayProvider } = m.InvokeModelGatewayProvider;
  const { mock, MockProvider } = m.MockProvider;
  const { ollama, OllamaProvider } = m.OllamaProvider;
  const { azureOpenai, openai, OpenAIProvider } = m.OpenAIProvider;
  return [
    {
      factory: 'anthropic',
      model: 'anthropic',
      make: (_mode, o) => anthropicRig(anthropic as Build, o),
    },
    { factory: 'openai', model: 'gpt-4o-mini', make: (_mode, o) => openaiRig(openai as Build, o) },
    {
      factory: 'openai',
      variant: 'OpenAI-compatible baseURL',
      model: 'llama3.2',
      make: (_mode, o) => openaiRig(openai as Build, o, { baseURL: 'http://localhost:1234/v1' }),
    },
    {
      factory: 'azureOpenai',
      model: 'dep-a',
      make: (_mode, o) => azureOpenaiRig(azureOpenai as Build, o),
    },
    { factory: 'foundry', model: 'dep-a', make: (_mode, o) => foundryRig(foundry as Build, o) },
    {
      factory: 'bedrock',
      model: 'bedrock',
      closeHandle: false,
      make: (_mode, o) => bedrockRig(bedrock as Build, o),
    },
    {
      factory: 'gemini',
      model: 'gemini-2.5-flash',
      closeHandle: false,
      make: (_mode, o) => geminiRig(gemini as Build, o),
    },
    {
      factory: 'browserAnthropic',
      model: 'claude-sonnet-4-5',
      make: (mode, o) =>
        fetchRig(mode, o, ANTHROPIC_SSE_WIRE, (f) =>
          browserAnthropic({ apiKey: 'sk-test', _fetch: f }),
        ),
    },
    {
      factory: 'browserOpenai',
      model: 'gpt-4o-mini',
      make: (mode, o) =>
        fetchRig(mode, o, OPENAI_SSE_WIRE, (f) => browserOpenai({ apiKey: 'sk-test', _fetch: f })),
    },
    {
      factory: 'browserAzureOpenai',
      model: 'dep-a',
      make: (mode, o) =>
        fetchRig(mode, o, OPENAI_SSE_WIRE, (f) =>
          browserAzureOpenai({ ...AZURE_BROWSER, _fetch: f }),
        ),
    },
    {
      factory: 'ollama',
      model: 'llama3.2',
      make: (mode, o) => fetchRig(mode, o, OLLAMA_WIRE, (f) => ollama('llama3.2', { _fetch: f })),
    },
    {
      factory: 'foundryLocal',
      model: FOUNDRY_LOCAL_MODEL,
      make: (mode, o) =>
        fetchRig(mode, o, OPENAI_SSE_WIRE, (f) => foundryLocal(FOUNDRY_LOCAL_MODEL, { _fetch: f })),
    },
    {
      factory: 'invokeModelGateway',
      model: GATEWAY_MODEL,
      make: (mode, o) =>
        fetchRig(mode, o, GATEWAY_WIRE, (f) =>
          invokeModelGateway({ ...GATEWAY_OPTIONS, fetch: f }),
        ),
    },
    {
      factory: 'invokeModelGateway',
      variant: 'with its own timeoutMs (a linked signal)',
      model: GATEWAY_MODEL,
      make: (mode, o) =>
        fetchRig(mode, o, GATEWAY_WIRE, (f) =>
          invokeModelGateway({ ...GATEWAY_OPTIONS, timeoutMs: 60_000, fetch: f }),
        ),
    },

    {
      factory: 'mock',
      model: 'mock',
      transport: 'none',
      make: (mode) => mockRig(mode, mock as Build),
    },
    // ── Class forms: each delegates to its factory, and is held to the same law.
    {
      factory: 'AnthropicProvider',
      model: 'anthropic',
      make: (_mode, o) => anthropicRig((x) => new AnthropicProvider(x), o),
    },
    {
      factory: 'OpenAIProvider',
      model: 'gpt-4o-mini',
      make: (_mode, o) => openaiRig((x) => new OpenAIProvider(x), o),
    },
    {
      factory: 'BedrockProvider',
      model: 'bedrock',
      closeHandle: false,
      make: (_mode, o) => bedrockRig((x) => new BedrockProvider(x), o),
    },
    {
      factory: 'GeminiProvider',
      model: 'gemini-2.5-flash',
      closeHandle: false,
      make: (_mode, o) => geminiRig((x) => new GeminiProvider(x), o),
    },
    {
      factory: 'BrowserAnthropicProvider',
      model: 'claude-sonnet-4-5',
      make: (mode, o) =>
        fetchRig(
          mode,
          o,
          ANTHROPIC_SSE_WIRE,
          (f) => new BrowserAnthropicProvider({ apiKey: 'sk-test', _fetch: f }),
        ),
    },
    {
      factory: 'BrowserOpenAIProvider',
      model: 'gpt-4o-mini',
      make: (mode, o) =>
        fetchRig(
          mode,
          o,
          OPENAI_SSE_WIRE,
          (f) => new BrowserOpenAIProvider({ apiKey: 'sk-test', _fetch: f }),
        ),
    },
    {
      factory: 'BrowserAzureOpenAIProvider',
      model: 'dep-a',
      make: (mode, o) =>
        fetchRig(
          mode,
          o,
          OPENAI_SSE_WIRE,
          (f) => new BrowserAzureOpenAIProvider({ ...AZURE_BROWSER, _fetch: f }),
        ),
    },
    {
      factory: 'OllamaProvider',
      model: 'llama3.2',
      make: (mode, o) =>
        fetchRig(mode, o, OLLAMA_WIRE, (f) => new OllamaProvider('llama3.2', { _fetch: f })),
    },
    {
      factory: 'FoundryLocalProvider',
      model: FOUNDRY_LOCAL_MODEL,
      make: (mode, o) =>
        fetchRig(
          mode,
          o,
          OPENAI_SSE_WIRE,
          (f) => new FoundryLocalProvider(FOUNDRY_LOCAL_MODEL, { _fetch: f }),
        ),
    },
    {
      factory: 'InvokeModelGatewayProvider',
      model: GATEWAY_MODEL,
      make: (mode, o) =>
        fetchRig(
          mode,
          o,
          GATEWAY_WIRE,
          (f) => new InvokeModelGatewayProvider({ ...GATEWAY_OPTIONS, fetch: f }),
        ),
    },
    {
      factory: 'MockProvider',
      model: 'mock',
      transport: 'none',
      make: (mode) => mockRig(mode, (x) => new MockProvider(x)),
    },
  ];
}

/** The rigs over the source, which `abort.conformance.test.ts` runs. */
export const ADAPTER_RIGS: readonly AdapterRig[] = adapterRigs(SOURCE_MODULES);
