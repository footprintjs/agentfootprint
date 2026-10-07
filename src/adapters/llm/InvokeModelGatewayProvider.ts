/**
 * InvokeModelGatewayProvider — Anthropic models behind a gateway that speaks the
 * Bedrock InvokeModel wire over plain HTTPS with an API-key header.
 *
 * Pattern: Adapter (GoF). Zero peer dependencies — uses `fetch`.
 * Role:    Outer ring. Translates `LLMRequest`/`LLMResponse` to and from the
 *          gateway's wire. Knows nothing about agents, skills or routing.
 *
 * ─── Why this is not `bedrock()` ────────────────────────────────────
 *
 * `bedrock()` drives the AWS SDK: SigV4 credentials against the CONVERSE
 * operation. Many organisations put the models behind their own gateway
 * instead — one that authenticates with an API-key header and forwards the
 * INVOKE operation. Neither the auth nor the operation matches, and
 * `providerFromEnv()` has no base URL for this wire, so until this adapter an
 * app had to write its own (the field case that prompted it was ~450 lines).
 *
 * ─── The wire ───────────────────────────────────────────────────────
 *
 *   POST {baseUrl}/model/{modelId}/invoke                      complete()
 *   POST {baseUrl}/model/{modelId}/invoke-with-response-stream stream()
 *   headers: content-type: application/json, {apiKeyHeader}: <key>
 *
 * The body is Anthropic's Messages API with two differences: the literal
 * `anthropic_version: "bedrock-2023-05-31"`, and NO `model` field — the model
 * is in the path. Everything else (`system` as a top-level field, content
 * blocks, `tools` with `input_schema`, `tool_choice`) is the shape
 * `anthropicMessagesWire.ts` owns.
 *
 * The stream answers SSE (`data: {…}` lines, with or without `event:` lines):
 * the gateway has already decoded AWS's binary event-stream framing, so there
 * is no SDK and no event-stream parser here.
 *
 * ─── Retries are NOT here ───────────────────────────────────────────
 *
 * This adapter makes ONE attempt per call. Every failure it raises is an
 * {@link InvokeModelGatewayError} carrying the two fields `withRetry`'s default
 * predicate reads: `status` on an HTTP refusal (429 and 5xx retried, other 4xx
 * not) and `retryable: false` on every failure that asking again cannot mend —
 * a refusal raised before any request, or a 2xx answer it could not read (a
 * re-send may run and bill the model again). So the default policy retries a
 * 429, a 5xx, a network failure and a timeout, and nothing else. Compose:
 *
 *   withRetry(invokeModelGateway({ ... }))
 *
 * A retry loop inside an adapter is a second policy nobody can see or tune.
 *
 * ─── What this adapter DOES own ─────────────────────────────────────
 *
 * - The stated wait. A throttled gateway says how long to wait — a
 *   `Retry-After` header when it feels like it, and often only in the body
 *   ("Rate limit is exceeded. Try again in 4 seconds."). The wording is this
 *   wire's, so it is read HERE and declared as `retryAfterMs` (header first);
 *   `withRetry` waits max(its schedule, that), capped by its `maxDelayMs`.
 * - The deadline. `timeoutMs` bounds the wait for the response headers, for a
 *   complete() body, and for EACH stream read (the first chunk and every gap
 *   between chunks — a stream that is still talking is never cut off). A miss
 *   aborts the request and raises `reason: 'timeout'`, retryable; the
 *   caller's `req.signal` still wins.
 */

import type { LLMCallHooks, LLMChunk, LLMProvider, LLMRequest, LLMResponse } from '../types.js';
import { asContextWindowExceeded } from './contextWindow.js';
import {
  assembleAnthropicStream,
  buildMessagesBody,
  fromAnthropicResponse,
  type AnthropicMessage,
  type AnthropicMessagesBody,
  type AnthropicStreamEvent,
} from './anthropicMessagesWire.js';
import { toolManifestOf } from './wireManifest.js';
import { anthropicThinkingHandler } from '../../thinking/AnthropicThinkingHandler.js';
import { retryAfterMsFromHeaders } from './retryAfter.js';

/** The literal this wire requires in the body in place of a version header. */
export const INVOKE_MODEL_ANTHROPIC_VERSION = 'bedrock-2023-05-31';

const PROVIDER_NAME = 'invoke-model-gateway';
const DEFAULT_MAX_TOKENS = 4096;
/** How much of a refusal body an error carries — enough for the gateway's reason. */
const BODY_EXCERPT_CHARS = 400;

// ─── Options ────────────────────────────────────────────────────────

/**
 * Where the key for a call comes from.
 *
 * - a string — one key for every model;
 * - a map from model id to key — for gateways that scope a key to a set of
 *   models (asking with the wrong key answers 403). A model id missing from
 *   the map is refused by name before any request is sent;
 * - a function of the model id — re-read before EVERY request, so a rotated
 *   key is picked up without rebuilding the provider.
 */
export type InvokeModelGatewayKey =
  | string
  | Readonly<Record<string, string>>
  | ((modelId: string) => string | undefined | Promise<string | undefined>);

/** Anything `fetch`-shaped — an mTLS agent, a proxy, or a scripted test double. */
export type InvokeModelGatewayFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface InvokeModelGatewayOptions {
  /**
   * The gateway root. Requests go to `{baseUrl}/model/{modelId}/invoke` and
   * `…/invoke-with-response-stream`. A trailing slash is ignored.
   */
  readonly baseUrl: string;
  /**
   * The header the gateway reads the key from, e.g. `'api-key'` or
   * `'x-api-key'`. Required — a guessed default would fail as a 401 that looks
   * like a bad key. For a bearer scheme use `'authorization'` and put
   * `'Bearer …'` in the key.
   */
  readonly apiKeyHeader: string;
  /** The key, a key per model id, or a function of the model id. */
  readonly apiKey: InvokeModelGatewayKey;
  /**
   * The model id the gateway knows, e.g. `'us.anthropic.claude-haiku-4-5-20251001-v1:0'`.
   * Used when `LLMRequest.model` is the shorthand `'invoke-model-gateway'`;
   * any other request model is sent as given.
   */
  readonly model?: string;
  /** Default `max_tokens` when the request sets none. Default 4096. */
  readonly defaultMaxTokens?: number;
  /**
   * May the model ask for several tools in one reply? `false` sends
   * `tool_choice: { type: 'auto', disable_parallel_tool_use: true }`.
   * Omitted sends nothing (the model's default — batching allowed).
   */
  readonly parallelToolCalls?: boolean;
  /** Replace `fetch` — for an mTLS agent, a proxy, or a test. Default: global `fetch`. */
  readonly fetch?: InvokeModelGatewayFetch;
  /**
   * Per-request deadline in ms. Bounds the wait for the response headers, for
   * a complete() body, and for each stream read — the first chunk and every
   * gap between chunks (an idle deadline: a stream that keeps talking is never
   * cut off). A miss aborts the request and raises an
   * {@link InvokeModelGatewayError} with `reason: 'timeout'`, `retryable:
   * true` — `withRetry` asks again only while no chunk has reached the caller.
   * A wrapper of your own that re-sends on `retryable` alone must make the
   * same check: a timeout BETWEEN chunks is also `retryable`, and re-sending
   * then would deliver the start of the answer twice. The caller's `req.signal` still wins. Omitted: no deadline (the default).
   */
  readonly timeoutMs?: number;
}

// ─── Errors ─────────────────────────────────────────────────────────

/** Which failure an {@link InvokeModelGatewayError} is. */
export type InvokeModelGatewayErrorReason =
  /** The options cannot make a request (no base URL, header, or key). */
  | 'invalid-options'
  /** The request named no model and the provider has no `model` to fall back to. */
  | 'no-model'
  /** No key for this model id — the map lacks it, or the function returned none. */
  | 'no-key'
  /** The gateway answered non-2xx. `status` is set; `bodyExcerpt` says why. */
  | 'http-status'
  /** The request never got an answer (DNS, TLS, connection reset). */
  | 'network'
  /** No answer — headers, body, or the next stream chunk — within `timeoutMs`. */
  | 'timeout'
  /** complete() answered 2xx with a body that is not a Messages response. */
  | 'unreadable-response'
  /** The stream answered 2xx with no body, sent an error event, or an unreadable event. */
  | 'stream'
  /** A tool call's streamed argument JSON did not parse. Refused, never run as `{}`. */
  | 'malformed-tool-args';

/**
 * Every failure `invokeModelGateway()` raises, told in words that name the
 * model and the fix. `reason` is the discriminator.
 *
 * `retryable` is `true` for a 429, a 5xx, a network failure and a timeout, and `false`
 * for every other reason, and `withRetry`'s default predicate honours the
 * `false` — so a refusal raised before any request (`no-key`, `no-model`,
 * `invalid-options`) is never repeated, and a 2xx answer it could not read
 * (`unreadable-response`) is never re-sent to a model that may already have
 * run. `status` is set ONLY for `'http-status'`. The key is never in the
 * message.
 */
export class InvokeModelGatewayError extends Error {
  override readonly name = 'InvokeModelGatewayError';
  readonly reason: InvokeModelGatewayErrorReason;
  /** The model id the call was for, when one was resolved. */
  readonly modelId?: string;
  /** The HTTP status, for `'http-status'` only. */
  readonly status?: number;
  /**
   * Whether asking again can mend it: a 429, a 5xx, a network failure, or a
   * timeout. `withRetry`'s default predicate reads the `false`.
   */
  readonly retryable: boolean;
  /** The gateway's `Retry-After` header, in seconds, when it sent a number. */
  readonly retryAfterSeconds?: number;
  /**
   * The wait the gateway STATED, in ms: its `Retry-After` header (seconds or
   * an HTTP-date) or, when there is none, its body's "try again in N
   * seconds". `withRetry` waits at least this long (capped by `maxDelayMs`).
   */
  readonly retryAfterMs?: number;
  /** The first 400 characters of the gateway's refusal body. */
  readonly bodyExcerpt?: string;
  /** For `'malformed-tool-args'`: the tool whose arguments did not parse. */
  readonly toolName?: string;

  constructor(init: {
    reason: InvokeModelGatewayErrorReason;
    message: string;
    modelId?: string;
    status?: number;
    retryAfterSeconds?: number;
    retryAfterMs?: number;
    bodyExcerpt?: string;
    toolName?: string;
    cause?: unknown;
  }) {
    super(`[${PROVIDER_NAME}] ${init.message}`);
    this.reason = init.reason;
    if (init.modelId !== undefined) this.modelId = init.modelId;
    if (init.status !== undefined) this.status = init.status;
    this.retryable = isTransient(init.reason, init.status);
    if (init.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
    if (init.bodyExcerpt !== undefined) this.bodyExcerpt = init.bodyExcerpt;
    if (init.toolName !== undefined) this.toolName = init.toolName;
    if (init.cause !== undefined) this.cause = init.cause;
  }
}

/**
 * The ONE owner of which failures are worth asking again: the gateway throttled
 * or failed (429, 5xx), or no answer came back (network, timeout). Everything
 * else is either refused before a request (nothing to repeat) or an answer
 * already given.
 */
function isTransient(reason: InvokeModelGatewayErrorReason, status: number | undefined): boolean {
  if (reason === 'network' || reason === 'timeout') return true;
  if (reason !== 'http-status' || status === undefined) return false;
  return status === 429 || status >= 500;
}

// ─── Adapter ────────────────────────────────────────────────────────

/**
 * An `LLMProvider` for Anthropic models behind a gateway that speaks the
 * Bedrock InvokeModel wire with an API-key header.
 *
 * @example
 * ```ts
 * import { Agent } from 'agentfootprint';
 * import { invokeModelGateway } from 'agentfootprint/providers';
 * import { withRetry } from 'agentfootprint/resilience';
 *
 * const provider = withRetry(
 *   invokeModelGateway({
 *     baseUrl: 'https://llm-gateway.example.com/bedrock',
 *     apiKeyHeader: 'api-key',
 *     apiKey: process.env.GATEWAY_KEY!,
 *     model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
 *   }),
 * );
 * const agent = Agent.create({ provider, model: 'invoke-model-gateway' }).build();
 * ```
 */
export function invokeModelGateway(options: InvokeModelGatewayOptions): LLMProvider {
  const baseUrl = checkedBaseUrl(options.baseUrl);
  const apiKeyHeader = checkedHeader(options.apiKeyHeader);
  checkKeySource(options.apiKey);
  const timeoutMs = checkedTimeout(options.timeoutMs);
  const defaultMaxTokens = options.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  const fetchImpl: InvokeModelGatewayFetch = options.fetch ?? ((input, init) => fetch(input, init));

  /** POST one request; a non-2xx becomes a typed error before anything is read. */
  async function post(
    req: LLMRequest,
    operation: 'invoke' | 'invoke-with-response-stream',
    deadline: Deadline,
  ): Promise<{ response: Response; body: InvokeModelBody }> {
    const modelId = modelIdFor(req, options.model);
    const key = await keyFor(options.apiKey, modelId);
    const body = buildInvokeBody(req, defaultMaxTokens, options.parallelToolCalls);
    let response: Response;
    try {
      response = await deadline.within(
        fetchImpl(`${baseUrl}/model/${encodeURIComponent(modelId)}/${operation}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [apiKeyHeader]: key },
          body: JSON.stringify(body),
          ...(deadline.signal && { signal: deadline.signal }),
        }),
        'the response',
      );
    } catch (err) {
      throw networkError(err, modelId);
    }
    if (!response.ok) throw await deadline.within(statusError(response, modelId), 'the response');
    return { response, body };
  }

  return {
    name: PROVIDER_NAME,
    // `carriesInMessages` is deliberately ABSENT. The default is
    // ['user', 'assistant'] (DEFAULT_CARRIES_IN_MESSAGES), which is exactly
    // this wire: `system` rides the top-level field and a `role: 'system'`
    // message is dropped by `toAnthropicMessages`. Declaring more would let a
    // system-role injection vanish between the recording and the request
    // instead of being refused at run start, by name.
    //
    // `tool_choice: { type: 'tool', name }` is part of the Anthropic body this
    // wire forwards, and a field deployment verified the gateway honours it.
    carriesForcedToolChoice: true,
    // `promptCaching` is deliberately ABSENT, for the same reason the line
    // above is present: a capability is declared where it is true of the
    // ENDPOINT. This adapter builds the body `anthropic()` builds, so it
    // writes `cache_control` wherever markers point — but no deployment has
    // verified that a gateway forwards the field to InvokeModel, and until
    // one does the agent sends it none. An operator who has verified theirs
    // declares it on the instance:
    //   { ...invokeModelGateway(opts), promptCaching: { mode: 'breakpoints', maxBreakpoints: 4, reportsUsage: true } }
    //
    // The thinking handler IS declared: the response is Anthropic's, parsed
    // by `fromAnthropicResponse`, which passes thinking blocks through as
    // `rawThinking`. Matched by name until now, this adapter never had one —
    // so its signed blocks were never normalized for the echo back.
    thinkingHandler: anthropicThinkingHandler,

    async complete(req: LLMRequest, _hooks?: LLMCallHooks): Promise<LLMResponse> {
      const modelId = modelIdFor(req, options.model);
      const deadline = deadlineFor(timeoutMs, req.signal, modelId);
      try {
        const { response, body } = await post(req, 'invoke', deadline);
        const message = await deadline.within(readMessage(response, modelId), 'the response body');
        return { ...fromAnthropicResponse(message), wireManifest: toolManifestOf(body.tools) };
      } finally {
        deadline.dispose();
      }
    },

    async *stream(req: LLMRequest, _hooks?: LLMCallHooks): AsyncIterable<LLMChunk> {
      const modelId = modelIdFor(req, options.model);
      const deadline = deadlineFor(timeoutMs, req.signal, modelId);
      try {
        const { response, body } = await post(req, 'invoke-with-response-stream', deadline);
        if (!response.body) {
          throw new InvokeModelGatewayError({
            reason: 'stream',
            modelId,
            message: `the stream for model ${modelId} answered ${response.status} with no body.`,
          });
        }
        yield* assembleAnthropicStream(readGatewayEvents(response.body, modelId, deadline), {
          wireManifest: toolManifestOf(body.tools),
          onMalformedToolArgs: (call) => {
            throw new InvokeModelGatewayError({
              reason: 'malformed-tool-args',
              modelId,
              toolName: call.name,
              message:
                `model ${modelId} streamed arguments for tool '${call.name}' that are not JSON ` +
                `(${call.raw.length} chars). The call is refused rather than run with its ` +
                `arguments dropped. Asking again usually recovers; nothing re-sends it for you.`,
            });
          },
        });
      } finally {
        deadline.dispose();
      }
    },
  };
}

/**
 * Class form of {@link invokeModelGateway}, for code that prefers `new`.
 */
export class InvokeModelGatewayProvider implements LLMProvider {
  readonly name = PROVIDER_NAME;
  readonly carriesForcedToolChoice = true;
  readonly thinkingHandler = anthropicThinkingHandler;
  private readonly inner: LLMProvider;

  constructor(options: InvokeModelGatewayOptions) {
    this.inner = invokeModelGateway(options);
  }

  // `hooks` is FORWARDED, not dropped — see LLMCallHooks in adapters/types.ts.
  complete(req: LLMRequest, hooks?: LLMCallHooks): Promise<LLMResponse> {
    return this.inner.complete(req, hooks);
  }

  stream(req: LLMRequest, hooks?: LLMCallHooks): AsyncIterable<LLMChunk> {
    if (!this.inner.stream) throw new Error('stream() unavailable');
    return this.inner.stream(req, hooks);
  }
}

// ─── Request ────────────────────────────────────────────────────────

interface InvokeModelBody extends AnthropicMessagesBody {
  anthropic_version: typeof INVOKE_MODEL_ANTHROPIC_VERSION;
}

function buildInvokeBody(
  req: LLMRequest,
  defaultMaxTokens: number,
  parallelToolCalls: boolean | undefined,
): InvokeModelBody {
  // No `model` field: the id is in the path, and this wire rejects it here.
  return {
    anthropic_version: INVOKE_MODEL_ANTHROPIC_VERSION,
    ...buildMessagesBody(req, defaultMaxTokens, parallelToolCalls),
  };
}

function modelIdFor(req: LLMRequest, fallback: string | undefined): string {
  const asked = req.model;
  if (asked && asked !== PROVIDER_NAME) return asked;
  if (fallback) return fallback;
  throw new InvokeModelGatewayError({
    reason: 'no-model',
    message:
      `the request asked for '${asked ?? ''}' and the provider has no model to send. ` +
      `Pass invokeModelGateway({ model: '<the id your gateway knows>' }), or name the ` +
      `model per call.`,
  });
}

async function keyFor(source: InvokeModelGatewayKey, modelId: string): Promise<string> {
  let key: string | undefined;
  if (typeof source === 'string') key = source;
  else if (typeof source === 'function') key = await source(modelId);
  else key = Object.prototype.hasOwnProperty.call(source, modelId) ? source[modelId] : undefined;
  if (typeof key === 'string' && key.length > 0) return key;
  const known =
    typeof source === 'object' ? ` The key map names: ${Object.keys(source).join(', ')}.` : '';
  throw new InvokeModelGatewayError({
    reason: 'no-key',
    modelId,
    message: `no key for model ${modelId}.${known} Add one for this model id, or send another model.`,
  });
}

/**
 * A 2xx body must be a Messages response (`content` array + `usage`). Anything
 * else — an HTML error page a proxy answered 200 with, an SSE body on the wrong
 * endpoint — is refused by name rather than read as an empty answer.
 */
async function readMessage(response: Response, modelId: string): Promise<AnthropicMessage> {
  const text = await response.text();
  const parsed = tryParse(text) as Partial<AnthropicMessage> | undefined;
  if (parsed && Array.isArray(parsed.content) && parsed.usage && typeof parsed.usage === 'object') {
    return parsed as AnthropicMessage;
  }
  throw new InvokeModelGatewayError({
    reason: 'unreadable-response',
    modelId,
    bodyExcerpt: text.slice(0, BODY_EXCERPT_CHARS),
    message:
      `model ${modelId} answered ${response.status} with a body that is not a Messages ` +
      `response (no content array and usage). Check that baseUrl points at the gateway's ` +
      `InvokeModel root.`,
  });
}

// ─── Stream framing ─────────────────────────────────────────────────

/**
 * The gateway's SSE → named events.
 *
 * Tolerates both framings a gateway sends: bare `data: {…}` lines (the event
 * name is the JSON's `type`) and `event:` + `data:` pairs. A `data:` line that
 * is not JSON on its own is joined with the next ones until it parses or a
 * blank line ends the event; one that never parses is refused — a dropped
 * event could be a dropped piece of the answer. An `error` event, or an AWS
 * exception object the gateway forwarded, ends the stream as a typed error.
 */
async function* readGatewayEvents(
  body: ReadableStream<Uint8Array>,
  modelId: string,
  deadline: Deadline,
): AsyncIterable<AnthropicStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let eventName: string | undefined;
  let pending: string[] = [];

  function* flushPending(final: boolean): Generator<AnthropicStreamEvent> {
    if (pending.length === 0) return;
    const joined = pending.join('\n');
    const data = tryParse(joined);
    if (data === undefined) {
      if (!final) return;
      throw unreadableEvent(joined, modelId);
    }
    pending = [];
    const name = eventName ?? typeOf(data) ?? 'message';
    eventName = undefined;
    throwIfErrorEvent(name, data, modelId);
    yield { event: name, data };
  }

  function* onLine(rawLine: string): Generator<AnthropicStreamEvent> {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      yield* flushPending(true);
      eventName = undefined;
      return;
    }
    if (line.startsWith(':')) return; // SSE comment / keep-alive
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      return;
    }
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') return;
    pending.push(payload);
    yield* flushPending(false);
  }

  let chunks = 0;
  try {
    for (;;) {
      // Each read has its own deadline — the first chunk, then every gap.
      const { value, done } = await deadline.within(
        reader.read(),
        chunks === 0 ? 'the first stream chunk' : 'the next stream chunk',
      );
      if (done) break;
      chunks++;
      buffered += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        yield* onLine(line);
      }
    }
    buffered += decoder.decode();
    if (buffered.length > 0) yield* onLine(buffered);
    yield* flushPending(true);
  } finally {
    // A read the deadline (or the caller) gave up on may still be pending;
    // cancelling the body settles it, so the lock is released cleanly.
    if (deadline.signal?.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function typeOf(data: unknown): string | undefined {
  const t = (data as { type?: unknown } | null)?.type;
  return typeof t === 'string' ? t : undefined;
}

/**
 * An Anthropic `error` event, or an AWS exception the gateway forwarded as one
 * object keyed by its name (`{ "throttlingException": { "message": … } }`).
 */
function throwIfErrorEvent(name: string, data: unknown, modelId: string): void {
  if (name === 'error') {
    const inner = (data as { error?: { type?: string; message?: string } }).error;
    throw new InvokeModelGatewayError({
      reason: 'stream',
      modelId,
      message: `model ${modelId} ended the stream with an error: ${inner?.type ?? 'error'} — ${
        inner?.message ?? JSON.stringify(data).slice(0, BODY_EXCERPT_CHARS)
      }`,
    });
  }
  if (data !== null && typeof data === 'object' && typeOf(data) === undefined) {
    const [only, ...rest] = Object.keys(data);
    if (only !== undefined && rest.length === 0 && /exception$/i.test(only)) {
      const inner = (data as Record<string, { message?: string }>)[only];
      throw new InvokeModelGatewayError({
        reason: 'stream',
        modelId,
        message: `model ${modelId} ended the stream with ${only}: ${inner?.message ?? ''}`,
      });
    }
  }
}

function unreadableEvent(text: string, modelId: string): InvokeModelGatewayError {
  return new InvokeModelGatewayError({
    reason: 'stream',
    modelId,
    bodyExcerpt: text.slice(0, BODY_EXCERPT_CHARS),
    message:
      `the stream for model ${modelId} sent an event that is not JSON ` +
      `(${text.length} chars). Refused rather than dropped — it may have carried part of the answer.`,
  });
}

// ─── Errors from the transport ──────────────────────────────────────

async function statusError(response: Response, modelId: string): Promise<Error> {
  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    /* the status alone still says enough */
  }
  // "Prompt is too long" is a refusal with its own type and its own fixes.
  const tooBig = asContextWindowExceeded(new Error(bodyText), {
    provider: PROVIDER_NAME,
    bodyText,
    status: response.status,
  });
  if (tooBig) return tooBig;
  const excerpt = bodyText.slice(0, BODY_EXCERPT_CHARS);
  const retryAfterSeconds = readRetryAfter(response.headers.get('retry-after'));
  const retryAfterMs = statedWaitMs(response.headers, bodyText);
  return new InvokeModelGatewayError({
    reason: 'http-status',
    modelId,
    status: response.status,
    ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
    ...(retryAfterMs !== undefined && { retryAfterMs }),
    ...(excerpt.length > 0 && { bodyExcerpt: excerpt }),
    message: `${statusSentence(response.status, modelId)}${
      excerpt ? ` Gateway said: ${excerpt}` : ''
    }`,
  });
}

/** One sentence per status class, naming the model and what to check. */
function statusSentence(status: number, modelId: string): string {
  if (status === 401) {
    return `HTTP 401 for model ${modelId}: the gateway did not accept the key. Check the key and apiKeyHeader.`;
  }
  if (status === 403) {
    return (
      `HTTP 403 for model ${modelId}: the key was read but is not allowed this model. ` +
      `Gateways often scope a key to some models — give this model id its own key ` +
      `(apiKey: { '${modelId}': … } or a function of the model id).`
    );
  }
  if (status === 404) {
    return `HTTP 404 for model ${modelId}: the gateway has no such model id, or baseUrl is wrong.`;
  }
  if (status === 429) {
    return `HTTP 429 for model ${modelId}: rate limited. Wrap the provider in withRetry to wait and retry.`;
  }
  if (status >= 500) {
    return `HTTP ${status} for model ${modelId}: the gateway or the model failed. Transient — withRetry retries it.`;
  }
  return `HTTP ${status} for model ${modelId}.`;
}

/**
 * The wait this gateway stated. The `Retry-After` header wins — it is the
 * protocol's own answer; the body's "Try again in N seconds" (the wording a
 * rate-limiting API gateway puts in its 429 body, often with no header at all)
 * is the fallback. The prose is read HERE, by the adapter that knows its
 * gateway's wording — `withRetry` only ever reads the declared `retryAfterMs`.
 */
function statedWaitMs(headers: Headers, bodyText: string): number | undefined {
  const fromHeader = retryAfterMsFromHeaders(headers);
  if (fromHeader !== undefined) return fromHeader;
  const fromBody = /try again in (\d+(?:\.\d+)?) seconds?/i.exec(bodyText);
  return fromBody ? Math.round(Number(fromBody[1]) * 1000) : undefined;
}

function readRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

function networkError(err: unknown, modelId: string): Error {
  // Already typed — the deadline's own 'timeout' refusal.
  if (err instanceof InvokeModelGatewayError) return err;
  // An abort is the caller's decision, not a failure — pass it through as-is so
  // withRetry's AbortError check still sees it.
  const e = err as { name?: string; code?: string } | null;
  if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) return err as Error;
  const tooBig = asContextWindowExceeded(err, { provider: PROVIDER_NAME });
  if (tooBig) return tooBig;
  return new InvokeModelGatewayError({
    reason: 'network',
    modelId,
    cause: err,
    message: `no answer from the gateway for model ${modelId}: ${
      err instanceof Error ? err.message : String(err)
    }`,
  });
}

// ─── Deadline ───────────────────────────────────────────────────────

/**
 * One request's deadline (`timeoutMs`), linked to the caller's signal.
 *
 * `within(p)` races ONE wait (the response, a body, a stream read) against a
 * fresh timer: a miss aborts the request — so a real fetch drops the
 * connection — and rejects with the typed 'timeout' error even when the
 * transport ignores the abort. The caller's abort wins: it rejects with the
 * caller's reason, as fetch would. With no `timeoutMs` everything is a pass
 * through and the fetch gets the caller's signal exactly as before.
 */
interface Deadline {
  /** What the fetch listens to: the caller's signal, or one linked to it and the timer. */
  readonly signal: AbortSignal | undefined;
  within<T>(pending: Promise<T>, what: string): Promise<T>;
  dispose(): void;
}

function deadlineFor(
  timeoutMs: number | undefined,
  callerSignal: AbortSignal | undefined,
  modelId: string,
): Deadline {
  if (timeoutMs === undefined) {
    return {
      signal: callerSignal,
      within: (pending) => pending,
      dispose: () => undefined,
    };
  }
  const controller = new AbortController();
  const onCallerAbort = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  return {
    signal: controller.signal,
    within<T>(pending: Promise<T>, what: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const settle = (): void => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', onAbort);
        };
        const onAbort = (): void => {
          settle();
          reject(controller.signal.reason);
        };
        const timer = setTimeout(() => {
          controller.abort(
            new InvokeModelGatewayError({
              reason: 'timeout',
              modelId,
              message:
                `no answer from model ${modelId} within ${timeoutMs} ms, waiting for ${what}. ` +
                `The request was aborted. Transient — withRetry asks again while no chunk ` +
                `has reached the caller; raise timeoutMs if the model needs longer.`,
            }),
          );
        }, timeoutMs);
        // Handlers go on `pending` FIRST, before any early return: the wait
        // was already started (fetch, body or stream read), and a promise
        // left without a handler rejects later as an unhandled rejection —
        // which kills a Node process on default settings. Once the race is
        // decided the later settle is a no-op on this promise.
        pending.then(
          (value) => {
            settle();
            resolve(value);
          },
          (err: unknown) => {
            settle();
            // A transport that honoured the abort rejects with its reason —
            // already the typed error (or the caller's abort).
            reject(controller.signal.aborted ? controller.signal.reason : err);
          },
        );
        if (controller.signal.aborted) return onAbort();
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    dispose(): void {
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

// ─── Option checks ──────────────────────────────────────────────────

function checkedTimeout(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw new InvokeModelGatewayError({
      reason: 'invalid-options',
      message: `timeoutMs must be a positive number of milliseconds, got ${JSON.stringify(raw)}.`,
    });
  }
  return raw;
}

function checkedBaseUrl(raw: string): string {
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new InvokeModelGatewayError({
      reason: 'invalid-options',
      message: `baseUrl must be an http(s) URL, got ${JSON.stringify(raw)}.`,
    });
  }
  return raw.replace(/\/+$/, '');
}

function checkedHeader(raw: string): string {
  // RFC 9110 token characters — a header name the fetch API will accept.
  if (typeof raw !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(raw)) {
    throw new InvokeModelGatewayError({
      reason: 'invalid-options',
      message: `apiKeyHeader must be a header name such as 'api-key', got ${JSON.stringify(raw)}.`,
    });
  }
  return raw;
}

function checkKeySource(source: InvokeModelGatewayKey): void {
  const ok =
    (typeof source === 'string' && source.length > 0) ||
    typeof source === 'function' ||
    (source !== null && typeof source === 'object' && Object.keys(source).length > 0);
  if (!ok) {
    throw new InvokeModelGatewayError({
      reason: 'invalid-options',
      message:
        'apiKey is required: a key, a map from model id to key, or a function of the model id.',
    });
  }
}
