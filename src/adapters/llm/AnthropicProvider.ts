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
  LLMChunk,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
} from '../types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';

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
  usage: { input_tokens: number; output_tokens: number };
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
  /** @internal Pre-built client for testing. Skips SDK import. */
  readonly _client?: AnthropicClient;
}

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

  const provider: LLMProvider = {
    name: 'anthropic',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const params = buildParams(req, defaultModel, defaultMaxTokens);
      try {
        const message = await client.messages.create(params);
        return fromAnthropicResponse(message);
      } catch (err) {
        throw wrapError(err);
      }
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const params = buildParams(req, defaultModel, defaultMaxTokens);
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
  private readonly inner: LLMProvider;

  constructor(options: AnthropicProviderOptions = {}) {
    this.inner = anthropic(options);
  }

  complete(req: LLMRequest): Promise<LLMResponse> {
    return this.inner.complete(req);
  }

  stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    if (!this.inner.stream) {
      throw new Error('stream() unavailable on inner provider');
    }
    return this.inner.stream(req);
  }
}

// ─── Internals ──────────────────────────────────────────────────────

function resolveClient(options: AnthropicProviderOptions): AnthropicClient {
  if (options._client) return options._client;
  let Anthropic: new (opts: { apiKey?: string }) => AnthropicClient;
  try {
    const mod = lazyRequire<{ default?: unknown } | unknown>('@anthropic-ai/sdk') as {
      default?: unknown;
    };
    Anthropic = (mod.default ?? mod) as new (opts: { apiKey?: string }) => AnthropicClient;
  } catch {
    throw new Error(
      'AnthropicProvider requires @anthropic-ai/sdk.\n' +
        '  Install:  npm install @anthropic-ai/sdk\n' +
        '  Or pass `_client` for test injection.',
    );
  }
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  return new Anthropic({ apiKey });
}

function buildParams(
  req: LLMRequest,
  defaultModel: string,
  defaultMaxTokens: number,
): AnthropicCreateParams {
  const params: AnthropicCreateParams = {
    model: req.model === 'anthropic' ? defaultModel : req.model,
    max_tokens: req.maxTokens ?? defaultMaxTokens,
    messages: toAnthropicMessages(req.messages),
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
 */
function toAnthropicMessages(messages: readonly LLMMessage[]): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // System lives outside message array.
    if (m.role === 'user') {
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
        last.content.push(block);
      } else {
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
