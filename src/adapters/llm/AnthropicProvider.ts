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
} from '../types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import { asContextWindowExceeded } from './contextWindow.js';
import { retryAfterMsFromError } from './retryAfter.js';
import { ANTHROPIC_PROMPT_CACHING, readCacheUsage } from './anthropicCacheWire.js';
import { anthropicThinkingMode } from './anthropicThinkingWire.js';
import { toolManifestOf } from './wireManifest.js';
import { anthropicThinkingHandler } from '../../thinking/AnthropicThinkingHandler.js';
import type { ThinkingMode } from '../../thinking/types.js';
// The request body has ONE owner, shared with browserAnthropic() and
// invokeModelGateway() — a private copy here once drifted from it, and a
// second copy of the thinking rule would drift the same way.
import {
  buildMessagesBody,
  type AnthropicContentBlock,
  type AnthropicMessagesBody,
} from './anthropicMessagesWire.js';

// ─── Anthropic SDK shape (duck-typed; no hard import) ──────────────

interface AnthropicClient {
  messages: {
    create(params: AnthropicCreateParams): Promise<AnthropicMessage>;
    stream(params: AnthropicCreateParams): AnthropicStream;
  };
}

/** The shared Messages body (anthropicMessagesWire.ts) plus the `model` the
 *  SDK sends — `system`, `tools`, `thinking`, `tool_choice` and the cache
 *  markers are all decided there. */
interface AnthropicCreateParams extends AnthropicMessagesBody {
  model: string;
}

interface AnthropicMessage {
  id: string;
  model: string;
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    // Cache traffic — present only when the request carried cache_control.
    // Absent means "no caching asked for", never zero. See anthropicCacheWire.
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

interface AnthropicStream {
  finalMessage(): Promise<AnthropicMessage>;
  [Symbol.asyncIterator](): AsyncIterator<AnthropicStreamEvent>;
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
  const buildParams = (req: LLMRequest): AnthropicCreateParams => {
    const model = modelOf(req.model);
    return {
      model,
      ...buildMessagesBody(req, {
        model,
        provider: 'anthropic',
        maxTokensDefault: defaultMaxTokens,
        ...(parallelToolCalls !== undefined && { parallelToolCalls }),
      }),
    };
  };

  const provider: LLMProvider = {
    name: 'anthropic',
    carriesInMessages: CARRIES_IN_MESSAGES,
    carriesForcedToolChoice: true,
    // Explicit `cache_control` breakpoints, four per request, usage reported —
    // the agent's cache strategy is chosen from this, never from `name`.
    promptCaching: ANTHROPIC_PROMPT_CACHING,
    // The signed thinking blocks this wire returns, normalized for the echo.
    thinkingHandler: anthropicThinkingHandler,
    // Which thinking request each model takes — budget, adaptive or none
    // (anthropicThinkingWire.ts); `buildMessagesBody` sends that shape.
    thinkingMode: (model) => anthropicThinkingMode(modelOf(model)),
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const params = buildParams(req);
      try {
        const message = await client.messages.create(params);
        // Manifest read from the FINAL params — after tool mapping and cache
        // markers — because the whole point is catching what the body says,
        // not what the request intended (wireManifest.ts).
        return { ...fromAnthropicResponse(message), wireManifest: toolManifestOf(params.tools) };
      } catch (err) {
        throw wrapError(err);
      }
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const params = buildParams(req);
      let stream: AnthropicStream;
      try {
        stream = client.messages.stream(params);
      } catch (err) {
        throw wrapError(err);
      }
      let tokenIndex = 0;
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta?.type === 'text_delta' &&
            event.delta.text
          ) {
            yield { tokenIndex, content: event.delta.text, done: false };
            tokenIndex++;
          }
        }
        const final = await stream.finalMessage();
        const response: LLMResponse = {
          ...fromAnthropicResponse(final),
          wireManifest: toolManifestOf(params.tools),
        };
        yield { tokenIndex, content: '', done: true, response };
      } catch (err) {
        throw wrapError(err);
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
  readonly promptCaching = ANTHROPIC_PROMPT_CACHING;
  readonly thinkingHandler = anthropicThinkingHandler;
  /** The inner provider's own function — a closure, safe to forward unbound. */
  readonly thinkingMode: (model: string) => ThinkingMode;
  private readonly inner: LLMProvider;

  constructor(options: AnthropicProviderOptions = {}) {
    this.inner = anthropic(options);
    this.thinkingMode = this.inner.thinkingMode!;
  }

  // `hooks` is FORWARDED, not dropped — see LLMCallHooks in adapters/types.ts.
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

function fromAnthropicResponse(message: AnthropicMessage): LLMResponse {
  const textParts: string[] = [];
  const toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
  // v2.14 — detect whether the response contains any thinking blocks.
  // When present, surface the FULL `message.content` array as
  // `rawThinking` so AnthropicThinkingHandler can normalize it.
  // (Handler filters for thinking + redacted_thinking blocks; passes
  // through other types without modification — but the handler
  // expects the full array as input shape per Phase 4a contract.)
  let hasThinking = false;
  for (const block of message.content) {
    if (block.type === 'text') textParts.push(block.text);
    else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, args: block.input });
    } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      hasThinking = true;
    }
  }
  return {
    content: textParts.join(''),
    toolCalls,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      // Cache traffic, when Anthropic reported it. Absent stays absent —
      // see anthropicCacheWire.readCacheUsage.
      ...readCacheUsage(message.usage),
      // v2.14 — Anthropic doesn't expose thinking tokens as a separate
      // field today (bundled in output_tokens). When the API surfaces
      // a dedicated field in the future, populate here. Per Phase 2
      // contract: undefined means "provider doesn't expose / no thinking".
    },
    stopReason: normalizeStopReason(message.stop_reason),
    providerRef: message.id,
    // v2.14 — when thinking blocks present, hand the full content array
    // to the framework's NormalizeThinking sub-subflow (which routes to
    // AnthropicThinkingHandler). Undefined when no thinking — the
    // subflow's early-return path skips work.
    ...(hasThinking && { rawThinking: message.content }),
  };
}

function normalizeStopReason(raw: string): string {
  // Map Anthropic's vocabulary onto agentfootprint's vocabulary.
  // Keep unknown values as-is so providers can surface novel reasons.
  switch (raw) {
    case 'end_turn':
      return 'stop';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return raw;
  }
}

function wrapError(err: unknown): Error {
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
