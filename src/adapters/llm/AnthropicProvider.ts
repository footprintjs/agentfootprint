/**
 * AnthropicProvider — wraps `@anthropic-ai/sdk` as an `LLMProvider`.
 *
 * Pattern: Adapter (GoF) + Ports-and-Adapters (Cockburn 2005).
 * Role:    Outer ring — translates `LLMRequest`/`LLMResponse` to/from
 *          Anthropic's Messages API. Knows nothing about agents,
 *          recorders, or compositions.
 * Emits:   N/A — providers don't emit; recorders observe via Agent.
 *
 * ─── Limitations ────────────────────────────────────────────────────
 *
 * • Multi-modal content (images, video) NOT supported  — the framework's
 *   `LLMMessage.content` is `string`. The adapter accepts text-only.
 *   May extend in a future release the message shape; this provider will be updated
 *   in lockstep.
 * • `responseFormat` (JSON-Schema-coerced output) NOT exposed
 *   — consumers can pass schema instructions via `systemPrompt`.
 */

import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  WireRole,
} from '../../provider-contract/types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import { abortableIterable, abortErrorOf, throwIfAborted, untilAborted } from '../../lib/abort.js';
import { asContextWindowExceeded } from '../../provider-contract/contextWindow.js';
import { retryAfterMsFromError } from './retryAfter.js';
import { ANTHROPIC_PROMPT_CACHING } from './anthropicCacheWire.js';
import { thinkingModeWith } from './anthropicThinkingWire.js';
import {
  anthropicTakesForcedToolChoice,
  anthropicTakesNativeOutputSchema,
} from './anthropicModels.js';
import { prepareAnthropicReplay, thinkingReplayBinding } from './anthropicThinkingReplay.js';
import { toolManifestOf } from './wireManifest.js';
import { AnthropicToolArguments } from './anthropicToolArguments.js';
import { anthropicThinkingHandler } from '../../thinking/AnthropicThinkingHandler.js';
import type { ThinkingMode } from '../../thinking/types.js';
// The request body has ONE owner, shared with browserAnthropic() and
// invokeModelGateway() — a private copy here once drifted from it, and a
// second copy of the thinking rule would drift the same way.
import {
  buildMessagesBody,
  fromAnthropicResponse,
  type AnthropicMessage,
  type AnthropicMessagesBody,
} from './anthropicMessagesWire.js';

// ─── Anthropic SDK shape (duck-typed; no hard import) ──────────────

interface AnthropicClient {
  messages: {
    create(
      params: AnthropicCreateParams,
      options?: AnthropicRequestOptions,
    ): Promise<AnthropicMessage>;
    stream(params: AnthropicCreateParams, options?: AnthropicRequestOptions): AnthropicStream;
  };
}

/** The SDK's per-request options — the one this adapter sends is the signal,
 *  so an aborted run cancels the HTTP request itself (`lib/abort.ts`). */
interface AnthropicRequestOptions {
  signal?: AbortSignal;
}

/** The shared Messages body (anthropicMessagesWire.ts) plus the `model` the
 *  SDK sends — `system`, `tools`, `thinking`, `tool_choice` and the cache
 *  markers are all decided there. */
interface AnthropicCreateParams extends AnthropicMessagesBody {
  model: string;
}

interface AnthropicStream {
  finalMessage(): Promise<AnthropicMessage>;
  [Symbol.asyncIterator](): AsyncIterator<AnthropicStreamEvent>;
  /** The SDK's own close: aborts the request and ends the stream. */
  abort?(): void;
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
}

// ─── Adapter ────────────────────────────────────────────────────────

export interface AnthropicProviderOptions {
  /** API key. Defaults to `ANTHROPIC_API_KEY` env var. */
  readonly apiKey?: string;
  /**
   * Default model used when `LLMRequest.model` is `'anthropic'` (the
   * shorthand). When the request specifies a full model id, that wins.
   */
  readonly defaultModel?: string;
  /** Default max tokens when the request doesn't set it. Default 4096. */
  readonly defaultMaxTokens?: number;
  /**
   * Per-request timeout in milliseconds, passed to the Anthropic client.
   * Long non-streaming turns (slow models, long conversations, agent loops)
   * can exceed the SDK default and surface as "Request timed out" — raise
   * this for such workloads. Omit to use the SDK default.
   */
  readonly timeout?: number;
  /**
   * How many times the Anthropic client retries a failed request (timeouts,
   * connection errors, 429/5xx) before giving up. Omit to use the SDK default.
   */
  readonly maxRetries?: number;
  /**
   * May the model ask for several tools at once in a single reply?
   *
   * Anthropic's default is `true`: one assistant message can carry many
   * `tool_use` blocks, and the agent runs them all inside ONE loop
   * iteration. Set `false` to cap it at one tool per reply — the model
   * still chooses which tool (or none), it just cannot batch.
   *
   * Set `false` when the SHAPE of the loop is part of what you are
   * measuring, not only its answer. A batched reply collapses several
   * tool results into one iteration, so per-iteration analysis
   * (`localizeContextBug` seeds one `'tool'` suspect per iteration from
   * `lastToolResult`, and `removableSources` de-duplicates by tool name)
   * attributes that iteration to the LAST tool of the batch — the others
   * never appear as separate influence rows and cannot be ablated
   * individually. One tool per iteration keeps every source separately
   * attributable, at the cost of one extra round trip per tool.
   *
   * Prompting for it is not equivalent: "call one tool at a time" in the
   * system prompt is a request the model may ignore, whereas this is a
   * request parameter the API enforces.
   *
   * `true` (and omitting the option) sends nothing — Anthropic's own
   * default already allows batching. Only `false` puts `tool_choice` on
   * the wire, and only on requests that actually carry tools.
   *
   * @default undefined (Anthropic's default — batching allowed)
   */
  readonly parallelToolCalls?: boolean;
  /**
   * Which thinking request a model takes, where the built-in table is not
   * the answer you want: an id it cannot read (a proxy's alias), or a model
   * that takes both shapes and that you want adaptive (Opus 4.6 and Sonnet
   * 4.6 get a budget by default; in budget mode Opus 4.6 does not think
   * between tool calls). Return `undefined` to use the table, which reads an
   * unknown id as adaptive. The provider declares the result
   * (`provider.thinkingMode`) AND sends that shape, so the agent's build
   * check and the wire cannot disagree.
   *
   * @example
   *   anthropic({ thinkingMode: (id) => (id.startsWith('claude-opus-4-6') ? 'adaptive' : undefined) })
   */
  readonly thinkingMode?: (model: string) => ThinkingMode | undefined;
  /** @internal Pre-built client for testing. Skips SDK import. */
  readonly _client?: AnthropicClient;
}

/**
 * Which roles this wire carries inside `messages`.
 *
 * `'system'` is ABSENT and that is the wire's own rule, not a policy choice:
 * `toAnthropicMessages` drops a `role: 'system'` message because Anthropic
 * takes the system prompt as a separate top-level field. Declaring the truth
 * here is what lets a `slot: 'messages'` injection be refused at run start
 * rather than silently vanish between the recording and the request.
 */
const CARRIES_IN_MESSAGES: readonly WireRole[] = Object.freeze(['user', 'assistant']);

/**
 * Build an `LLMProvider` backed by Anthropic's Messages API.
 *
 * @example
 *   import { Agent } from 'agentfootprint';
 *   import { anthropic } from 'agentfootprint/providers';
 *
 *   const agent = Agent.create({
 *     provider: anthropic({ defaultModel: 'claude-sonnet-4-5-20250929' }),
 *     model: 'anthropic',
 *   })
 *     .tool(weatherTool)
 *     .build();
 */
export function anthropic(options: AnthropicProviderOptions = {}): LLMProvider {
  const client = resolveClient(options);
  const defaultModel = options.defaultModel ?? 'claude-sonnet-4-5-20250929';
  const defaultMaxTokens = options.defaultMaxTokens ?? 4096;
  const parallelToolCalls = options.parallelToolCalls;
  /** The model a request goes to — the `'anthropic'` shorthand is the default. */
  const modelOf = (model: string): string => (model === 'anthropic' ? defaultModel : model);
  /** The ONE mode function: declared below and used for every body. */
  const modeOf = thinkingModeWith(options.thinkingMode);
  const buildParams = (req: LLMRequest): AnthropicCreateParams => {
    const model = modelOf(req.model);
    return {
      model,
      ...buildMessagesBody(req, {
        model,
        thinkingMode: modeOf,
        provider: 'anthropic',
        maxTokensDefault: defaultMaxTokens,
        ...(parallelToolCalls !== undefined && { parallelToolCalls }),
        nativeOutputSchema: anthropicTakesNativeOutputSchema,
      }),
    };
  };

  const provider: LLMProvider = {
    name: 'anthropic',
    carriesInMessages: CARRIES_IN_MESSAGES,
    carriesForcedToolChoice: true,
    supportsForcedToolChoice: (model) => anthropicTakesForcedToolChoice(modelOf(model)),
    // `output_config.format` — the `'native'` output strategy — on the models
    // the structured-outputs page lists (anthropicModels.ts).
    carriesNativeOutputSchema: true,
    supportsNativeOutputSchema: (model) => anthropicTakesNativeOutputSchema(modelOf(model)),
    // Explicit `cache_control` breakpoints, four per request, usage reported —
    // the agent's cache strategy is chosen from this, never from `name`.
    promptCaching: ANTHROPIC_PROMPT_CACHING,
    // The signed thinking blocks this wire returns, normalized for the echo.
    thinkingHandler: anthropicThinkingHandler,
    // Which thinking request each model takes — budget, adaptive or none
    // (anthropicThinkingWire.ts); `buildMessagesBody` sends that shape, from
    // the same function.
    thinkingMode: (model) => modeOf(modelOf(model)),
    async complete(req: LLMRequest, hooks?: LLMCallHooks): Promise<LLMResponse> {
      // A cancelled call sends nothing (lib/abort.ts, law 1).
      throwIfAborted(req.signal);
      const preparation = prepareAnthropicReplay(req, modelOf(req.model), 'anthropic');
      const params = buildParams(preparation.request);
      const bindingFactory = thinkingReplayBinding(params, params.model);
      if (preparation.omissions.length > 0) hooks?.onReplayPrepared?.(preparation);
      try {
        // The signal rides the SDK's request options, so an abort cancels the
        // HTTP request itself; the race refuses an answer that lands after it.
        const message = await untilAborted(
          req.signal
            ? client.messages.create(params, { signal: req.signal })
            : client.messages.create(params),
          req.signal,
        );
        // Manifest read from the FINAL params — after tool mapping and cache
        // markers — because the whole point is catching what the body says,
        // not what the request intended (wireManifest.ts).
        return {
          ...fromAnthropicResponse(message, message.id ? bindingFactory(message.id) : undefined),
          wireManifest: toolManifestOf(params.tools, params.output_config),
          ...(preparation.omissions.length > 0 && { replayOmissions: preparation.omissions }),
        };
      } catch (err) {
        throw wrapError(err, req.signal);
      }
    },
    async *stream(req: LLMRequest, hooks?: LLMCallHooks): AsyncIterable<LLMChunk> {
      throwIfAborted(req.signal);
      const preparation = prepareAnthropicReplay(req, modelOf(req.model), 'anthropic');
      const params = buildParams(preparation.request);
      const bindingFactory = thinkingReplayBinding(params, params.model);
      if (preparation.omissions.length > 0) hooks?.onReplayPrepared?.(preparation);
      let stream: AnthropicStream;
      try {
        stream = req.signal
          ? client.messages.stream(params, { signal: req.signal })
          : client.messages.stream(params);
      } catch (err) {
        throw wrapError(err, req.signal);
      }
      const opened = stream;
      let tokenIndex = 0;
      const toolArguments = new AnthropicToolArguments();
      try {
        // An abort closes the SDK stream and ends this loop at once, even
        // when a read is still pending (lib/abort.ts, laws 2–3).
        for await (const event of abortableIterable(opened, req.signal, () => opened.abort?.())) {
          toolArguments.observe(event);
          if (
            event.type === 'content_block_delta' &&
            event.delta?.type === 'text_delta' &&
            event.delta.text
          ) {
            yield { tokenIndex, content: event.delta.text, done: false };
            tokenIndex++;
          }
        }
        const final = await untilAborted(opened.finalMessage(), req.signal);
        toolArguments.assertTerminal(final.content.some((block) => block.type === 'tool_use'));
        const argumentFailures = new Map<
          number,
          NonNullable<LLMResponse['toolCalls'][number]['argumentsFailure']>
        >();
        const checkedMessage = {
          ...final,
          content: final.content.map((block, index) => {
            if (block.type !== 'tool_use') return block;
            const checked = toolArguments.finish(index, block);
            if (checked.failure) argumentFailures.set(index, checked.failure);
            return { ...block, input: checked.input };
          }),
        };
        const response: LLMResponse = {
          ...fromAnthropicResponse(
            checkedMessage,
            final.id ? bindingFactory(final.id) : undefined,
            argumentFailures,
          ),
          wireManifest: toolManifestOf(params.tools, params.output_config),
          ...(preparation.omissions.length > 0 && { replayOmissions: preparation.omissions }),
        };
        yield { tokenIndex, content: '', done: true, response };
      } catch (err) {
        throw wrapError(err, req.signal);
      }
    },
  };

  return provider;
}

/**
 * Class form for consumers who prefer `new AnthropicProvider(...)` over
 * the `anthropic(...)` factory. Identical behavior; trivial wrapper.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly carriesInMessages = CARRIES_IN_MESSAGES;
  readonly carriesForcedToolChoice = true;
  /** The inner declaration resolves this adapter's shorthand before looking up the model. */
  readonly supportsForcedToolChoice: (model: string) => boolean;
  readonly carriesNativeOutputSchema = true;
  /** The inner declaration resolves this adapter's shorthand before looking up the model. */
  readonly supportsNativeOutputSchema: (model: string) => boolean;
  readonly promptCaching = ANTHROPIC_PROMPT_CACHING;
  readonly thinkingHandler = anthropicThinkingHandler;
  /** The inner provider's own function — a closure, safe to forward unbound. */
  readonly thinkingMode: (model: string) => ThinkingMode;
  private readonly inner: LLMProvider;

  constructor(options: AnthropicProviderOptions = {}) {
    this.inner = anthropic(options);
    this.thinkingMode = this.inner.thinkingMode!;
    this.supportsForcedToolChoice = this.inner.supportsForcedToolChoice!;
    this.supportsNativeOutputSchema = this.inner.supportsNativeOutputSchema!;
  }

  // `hooks` is FORWARDED, not dropped — see LLMCallHooks in provider-contract/types.ts.
  complete(req: LLMRequest, hooks?: LLMCallHooks): Promise<LLMResponse> {
    return this.inner.complete(req, hooks);
  }

  stream(req: LLMRequest, hooks?: LLMCallHooks): AsyncIterable<LLMChunk> {
    if (!this.inner.stream) {
      throw new Error('stream() unavailable on inner provider');
    }
    return this.inner.stream(req, hooks);
  }
}

// ─── Internals ──────────────────────────────────────────────────────

function resolveClient(options: AnthropicProviderOptions): AnthropicClient {
  if (options._client) return options._client;
  type AnthropicCtorOptions = { apiKey?: string; timeout?: number; maxRetries?: number };
  let Anthropic: new (opts: AnthropicCtorOptions) => AnthropicClient;
  try {
    const mod = lazyRequire<{ default?: unknown } | unknown>('@anthropic-ai/sdk') as {
      default?: unknown;
    };
    Anthropic = (mod.default ?? mod) as new (opts: AnthropicCtorOptions) => AnthropicClient;
  } catch {
    throw new Error(
      'AnthropicProvider requires @anthropic-ai/sdk.\n' +
        '  Install:  npm install @anthropic-ai/sdk\n' +
        '  Or pass `_client` for test injection.',
    );
  }
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  return new Anthropic({
    apiKey,
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });
}

function wrapError(err: unknown, signal?: AbortSignal): Error {
  // A cancelled call fails AS the cancellation, whatever the SDK threw for it
  // (its own `APIUserAbortError` included) — never as a provider error that a
  // retry would re-send (lib/abort.ts).
  if (signal?.aborted) return abortErrorOf(signal);
  // See OpenAIProvider.wrapError — one shared detector, one typed error, so
  // "prompt is too long" reads the same whichever vendor said it.
  const tooBig = asContextWindowExceeded(err, { provider: 'anthropic' });
  if (tooBig) return tooBig;
  if (err instanceof Error) {
    // The wait the response stated (retry-after-ms / retry-after), declared
    // for withRetry — absent when none, so the error shape is unchanged.
    const retryAfterMs = retryAfterMsFromError(err);
    return Object.assign(new Error(`[anthropic] ${err.message}`), {
      name: 'AnthropicProviderError',
      cause: err,
      // Preserve `status` if the SDK attached one — withRetry uses it.
      status: (err as { status?: number }).status,
      ...(retryAfterMs !== undefined && { retryAfterMs }),
    });
  }
  return new Error(`[anthropic] ${String(err)}`);
}
