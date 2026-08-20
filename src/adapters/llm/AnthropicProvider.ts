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
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
  WireRole,
} from '../types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import { asContextWindowExceeded } from './contextWindow.js';
import { applyCacheMarkers, readCacheUsage } from './anthropicCacheWire.js';

// ─── Anthropic SDK shape (duck-typed; no hard import) ──────────────

interface AnthropicClient {
  messages: {
    create(params: AnthropicCreateParams): Promise<AnthropicMessage>;
    stream(params: AnthropicCreateParams): AnthropicStream;
  };
}

interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  messages: AnthropicMessageParam[];
  system?: string;
  tools?: AnthropicTool[];
  temperature?: number;
  stop_sequences?: string[];
  // v2.14 — extended-thinking activation. When present, the model
  // emits thinking blocks alongside its visible response. Only
  // claude-sonnet-4-5 / opus-4-5 (and newer) support this; older
  // models reject with HTTP 400.
  thinking?: { type: 'enabled'; budget_tokens: number };
  // Emitted only when `parallelToolCalls: false`. Anthropic accepts
  // `disable_parallel_tool_use` on any `tool_choice` variant; `auto`
  // is the variant that leaves the CHOICE of tool (and of whether to
  // call one at all) with the model — we only cap the COUNT.
  /**
   * v7.26 — a forced choice of ONE named tool, the shape
   * `.outputSchema(s, { strategy: 'tool-forced' })` needs. Anthropic accepts
   * `{type:'tool',name}`; it is mutually exclusive with the `auto` variant
   * above (only one tool_choice can be sent), and the forced choice wins
   * because it is the guarantee the consumer selected the strategy for. */
  tool_choice?: { type: 'auto'; disable_parallel_tool_use: true } | { type: 'tool'; name: string };
}

interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  // v2.14 — extended-thinking blocks. Round-trip on assistant turns
  // when continuing a tool-using extended-thinking conversation;
  // signature MUST be byte-exact or Anthropic returns HTTP 400.
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; signature?: string };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
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

  const provider: LLMProvider = {
    name: 'anthropic',
    carriesInMessages: CARRIES_IN_MESSAGES,
    carriesForcedToolChoice: true,
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const params = buildParams(req, defaultModel, defaultMaxTokens, parallelToolCalls);
      try {
        const message = await client.messages.create(params);
        return fromAnthropicResponse(message);
      } catch (err) {
        throw wrapError(err);
      }
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const params = buildParams(req, defaultModel, defaultMaxTokens, parallelToolCalls);
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
        const response = fromAnthropicResponse(final);
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
  private readonly inner: LLMProvider;

  constructor(options: AnthropicProviderOptions = {}) {
    this.inner = anthropic(options);
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

function buildParams(
  req: LLMRequest,
  defaultModel: string,
  defaultMaxTokens: number,
  parallelToolCalls?: boolean,
): AnthropicCreateParams {
  // v2.14 — Anthropic requires `max_tokens > thinking.budget_tokens`.
  // When thinking is enabled and the resolved max_tokens would violate
  // that, bump max_tokens to `budget + 1024` (1024 visible-response
  // tokens — typical for tool-using turns where the model emits a
  // tool_use block + minimal text). Consumers who explicitly set
  // maxTokens above budget keep their choice; only the default-resolution
  // path auto-bumps. Otherwise consumers see an opaque HTTP 400 from
  // Anthropic on every call (which is the bug uncovered in Neo).
  let maxTokens = req.maxTokens ?? defaultMaxTokens;
  if (req.thinking && maxTokens <= req.thinking.budget) {
    maxTokens = req.thinking.budget + 1024;
  }
  // The map is only needed when a messages cache marker has to be placed;
  // building it always keeps the transform single-pass and costs one number
  // per message. Mirrors BrowserAnthropicProvider.
  const messageIndexMap: number[] = [];
  const params: AnthropicCreateParams = {
    model: req.model === 'anthropic' ? defaultModel : req.model,
    max_tokens: maxTokens,
    messages: toAnthropicMessages(req.messages, messageIndexMap),
  };
  if (req.systemPrompt) params.system = req.systemPrompt;
  if (req.tools && req.tools.length > 0) params.tools = req.tools.map(toAnthropicTool);
  if (req.temperature !== undefined) params.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) params.stop_sequences = [...req.stop];
  // v2.14 — extended-thinking activation. Presence of req.thinking is
  // the activation signal; budget translates to budget_tokens. Anthropic
  // requires max_tokens > budget_tokens — caller's responsibility, the
  // SDK error path surfaces violations through wrapError().
  if (req.thinking) {
    params.thinking = { type: 'enabled', budget_tokens: req.thinking.budget };
  }
  // One tool per reply, enforced by the API rather than asked for in prose.
  // Guarded on `params.tools`: Anthropic rejects `tool_choice` on a request
  // that carries no tools, and an agent's final answer call often has none.
  if (parallelToolCalls === false && params.tools !== undefined && params.tools.length > 0) {
    params.tool_choice = { type: 'auto', disable_parallel_tool_use: true };
  }
  // Forced choice of one named tool. Written LAST so it wins over the
  // parallel cap: capping how many tools a reply may use is a preference,
  // constraining WHICH tool answers is the contract the run is built on.
  // Same `params.tools` guard — Anthropic rejects any tool_choice on a
  // request carrying no tools.
  if (req.toolChoice && params.tools !== undefined && params.tools.length > 0) {
    params.tool_choice = { type: 'tool', name: req.toolChoice.name };
  }
  // Cache markers — applied AFTER param construction so the materialized
  // fields (system / tools / messages) exist to mark. Already clamped to
  // Anthropic's 4-marker limit by AnthropicCacheStrategy. Before this, the
  // server path silently dropped the markers the strategy prepared, so the
  // stable prefix was paid at full rate on every call.
  if (req.cacheMarkers && req.cacheMarkers.length > 0) {
    applyCacheMarkers(params, req.cacheMarkers, messageIndexMap);
  }
  return params;
}

/**
 * Convert messages to Anthropic message params.
 *
 * Key transforms:
 *   • `role: 'system'` → extracted by the caller (we filter it out
 *     here since systemPrompt is a separate API field).
 *   • `role: 'assistant'` with `toolCalls` → text + tool_use blocks.
 *   • `role: 'tool'` → coalesced into a `user` message with
 *     tool_result blocks (Anthropic's expected shape). Consecutive
 *     tool messages merge into one user turn.
 *
 * `indexMap` (optional) records where each request message landed in the
 * result — `-1` for one that did not survive — so a messages cache marker
 * can be translated between the two index spaces. Mirrors
 * BrowserAnthropicProvider; see anthropicCacheWire.MessageIndexMap.
 */
function toAnthropicMessages(
  messages: readonly LLMMessage[],
  indexMap?: number[],
): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      indexMap?.push(-1); // System lives outside message array.
      continue;
    }
    if (m.role === 'user') {
      indexMap?.push(result.length);
      result.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      // v2.14 — thinking blocks come FIRST per Anthropic's wire format
      // ordering rule. Anthropic validates server-side that signed
      // blocks appear before text + tool_use; out-of-order = HTTP 400.
      // Signature passes through BYTE-EXACT — no String() coercion,
      // no JSON-roundtrip, no trim. Matches the Phase 4a normalization
      // invariant (the signature on `LLMMessage.thinkingBlocks` is the
      // exact value Anthropic emitted on the prior turn).
      if (m.thinkingBlocks && m.thinkingBlocks.length > 0) {
        for (const tb of m.thinkingBlocks) {
          if (tb.type === 'redacted_thinking') {
            blocks.push({
              type: 'redacted_thinking',
              ...(tb.signature !== undefined && { signature: tb.signature }),
            });
          } else {
            blocks.push({
              type: 'thinking',
              thinking: tb.content,
              ...(tb.signature !== undefined && { signature: tb.signature }),
            });
          }
        }
      }
      if (m.content) blocks.push({ type: 'text', text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: { ...tc.args },
          });
        }
      }
      // v2.14 — when thinkingBlocks present, content MUST be the array
      // (otherwise the signed blocks aren't sent). Without thinking,
      // preserve the original `m.content || ''` fallback for empty
      // assistant turns.
      const hasThinking = m.thinkingBlocks !== undefined && m.thinkingBlocks.length > 0;
      indexMap?.push(result.length);
      result.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : hasThinking ? blocks : m.content || '',
      });
      continue;
    }
    if (m.role === 'tool') {
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
      };
      // Merge into preceding user turn when contiguous (Anthropic expects
      // multiple tool_results in one user message after a multi-tool turn).
      const last = result[result.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        // Coalesced into the user turn already open — several request
        // messages share one body index.
        indexMap?.push(result.length - 1);
        last.content.push(block);
      } else {
        indexMap?.push(result.length);
        result.push({ role: 'user', content: [block] });
      }
      continue;
    }
  }
  return result;
}

function toAnthropicTool(schema: LLMToolSchema): AnthropicTool {
  return {
    name: schema.name,
    description: schema.description,
    input_schema: { ...schema.inputSchema },
  };
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
    return Object.assign(new Error(`[anthropic] ${err.message}`), {
      name: 'AnthropicProviderError',
      cause: err,
      // Preserve `status` if the SDK attached one — withRetry uses it.
      status: (err as { status?: number }).status,
    });
  }
  return new Error(`[anthropic] ${String(err)}`);
}
