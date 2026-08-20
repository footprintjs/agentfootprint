/**
 * BrowserAnthropicProvider — fetch-based Anthropic adapter for browsers.
 *
 * Pattern: Adapter (GoF). Zero peer dependencies — uses global `fetch`.
 * Role:    Outer ring. Same `LLMProvider` contract as `AnthropicProvider`,
 *          but skips `@anthropic-ai/sdk` (which doesn't bundle cleanly
 *          for browser). Aimed at playgrounds / prototypes where the
 *          user supplies their own key.
 * Emits:   N/A.
 *
 * Anthropic requires the `anthropic-dangerous-direct-browser-access: true`
 * header for direct browser-to-API calls. This is intentional — production
 * apps should proxy through a backend.
 *
 * ─── Limitations ────────────────────────────────────────────────────
 *
 * • Multi-modal NOT supported.
 * • Browser CORS — works because Anthropic explicitly allows the
 *   dangerous-direct header. Future API changes could require a proxy.
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
import { asContextWindowExceeded } from './contextWindow.js';
import { applyCacheMarkers, readCacheUsage } from './anthropicCacheWire.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

// ─── Types (Anthropic API shapes) ──────────────────────────────────

interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  messages: AnthropicMessageParam[];
  system?: string;
  tools?: AnthropicTool[];
  temperature?: number;
  stop_sequences?: string[];
  stream?: boolean;
  // v2.14 — extended-thinking activation. Presence of `thinking`
  // tells Anthropic to emit reasoning blocks. Mirror of the Node
  // AnthropicProvider's same field.
  thinking?: { type: 'enabled'; budget_tokens: number };
  // Emitted only when `parallelToolCalls: false`. Mirror of the Node
  // AnthropicProvider's same field.
  /** v7.26 — forced choice of one named tool. Mirror of the Node provider. */
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
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    // Cache traffic — present only when the request carried cache_control.
    // Absent means "no caching asked for", never zero. See anthropicCacheWire.
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

// ─── Adapter ────────────────────────────────────────────────────────

export interface BrowserAnthropicProviderOptions {
  /** API key. REQUIRED — browser providers don't read env vars. */
  readonly apiKey: string;
  /** Default model when `LLMRequest.model` is `'anthropic'`. */
  readonly defaultModel?: string;
  /** Default max tokens. Default 4096. */
  readonly defaultMaxTokens?: number;
  /** Override the API URL (proxies, edge deployments, mocks). */
  readonly apiUrl?: string;
  /**
   * May the model ask for several tools at once in a single reply?
   * Mirror of `AnthropicProviderOptions.parallelToolCalls` — see there
   * for the full rationale.
   *
   * Anthropic's default is `true` (batching allowed). `false` caps the
   * model at one tool per reply, which keeps every tool result on its
   * own agent iteration so per-iteration analysis can attribute and
   * ablate each source separately. `true`/omitted sends nothing.
   *
   * @default undefined (Anthropic's default — batching allowed)
   */
  readonly parallelToolCalls?: boolean;
  /** @internal Custom fetch implementation for tests / workers. */
  readonly _fetch?: typeof fetch;
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

export function browserAnthropic(options: BrowserAnthropicProviderOptions): LLMProvider {
  const apiKey = options.apiKey;
  if (!apiKey) {
    throw new Error(
      'BrowserAnthropicProvider requires `apiKey`. Browser providers do not read environment variables.',
    );
  }
  const apiUrl = options.apiUrl ?? ANTHROPIC_API_URL;
  const defaultModel = options.defaultModel ?? 'claude-sonnet-4-5-20250929';
  const defaultMaxTokens = options.defaultMaxTokens ?? 4096;
  const parallelToolCalls = options.parallelToolCalls;
  const fetchImpl = options._fetch ?? fetch;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  const provider: LLMProvider = {
    name: 'browser-anthropic',
    carriesInMessages: CARRIES_IN_MESSAGES,
    carriesForcedToolChoice: true,
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const body: AnthropicRequestBody = {
        ...buildBody(req, defaultModel, defaultMaxTokens, parallelToolCalls),
      };
      let response: Response;
      try {
        response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          ...(req.signal && { signal: req.signal }),
        });
      } catch (err) {
        throw wrapError(err);
      }
      if (!response.ok) throw await wrapStatus(response);
      const json = (await response.json()) as AnthropicMessage;
      return fromAnthropicResponse(json);
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const body: AnthropicRequestBody = {
        ...buildBody(req, defaultModel, defaultMaxTokens, parallelToolCalls),
        stream: true,
      };
      let response: Response;
      try {
        response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          ...(req.signal && { signal: req.signal }),
        });
      } catch (err) {
        throw wrapError(err);
      }
      if (!response.ok) throw await wrapStatus(response);
      if (!response.body) throw new Error('[browser-anthropic] response has no body');

      let tokenIndex = 0;
      const accumulatedText: string[] = [];
      // Tool-use blocks arrive in two waves: `content_block_start` carries
      // {id, name, input: {}} (input is ALWAYS empty there), then a series
      // of `content_block_delta` events with `delta.type === 'input_json_delta'`
      // ship the JSON args as string fragments. We accumulate the fragments
      // per content-block index, then JSON.parse on `content_block_stop`.
      // Indexing by `event.data.index` (NOT array push order) because text
      // and tool_use blocks can interleave.
      const toolUseByIndex = new Map<number, { id: string; name: string; partialJson: string[] }>();
      const completedToolUses: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];
      // v2.14 — thinking blocks arrive across multiple stream events:
      //   - content_block_start with {type: 'thinking'} or {type:'redacted_thinking', signature}
      //   - content_block_delta with delta.type === 'thinking_delta' (text fragment)
      //   - content_block_delta with delta.type === 'signature_delta' (signature fragment)
      //   - content_block_stop closes the block
      // We accumulate per-index (text + signature) and reassemble the full
      // content array at terminal time so the framework's handler can
      // normalize. The accumulator preserves block ORDER (thinking-first per
      // Anthropic's wire-format invariant).
      const thinkingByIndex = new Map<
        number,
        { type: 'thinking' | 'redacted_thinking'; thinking: string[]; signature: string[] }
      >();
      const completedThinking: Array<
        | { type: 'thinking'; thinking: string; signature?: string }
        | { type: 'redacted_thinking'; signature?: string }
      > = [];
      // Anthropic's stream ships usage in two places:
      //   1. `message_start.message.usage.input_tokens` — input count, sent first.
      //   2. `message_delta.usage.output_tokens` — running output count.
      // The terminal `message_stop` carries no usage; we close on whatever
      // the latest `message_delta` had. There is no final JSON message.
      let messageId: string | undefined;
      let stopReason: string | undefined;
      let inputTokens = 0;
      let outputTokens = 0;
      // Cache traffic rides message_start's usage. Stays undefined when the
      // API reported nothing — see anthropicCacheWire.readCacheUsage.
      let cacheUsage: { cacheRead?: number; cacheWrite?: number } = {};

      for await (const event of parseSSE(response.body)) {
        if (event.event === 'message_start') {
          const msg = (event.data as { message?: AnthropicMessage }).message;
          if (msg) {
            messageId = msg.id;
            inputTokens = msg.usage?.input_tokens ?? 0;
            outputTokens = msg.usage?.output_tokens ?? 0;
            cacheUsage = readCacheUsage(msg.usage);
          }
        } else if (event.event === 'message_delta') {
          // Carries `delta.stop_reason` + cumulative `usage.output_tokens`.
          const data = event.data as {
            delta?: { stop_reason?: string };
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
          if (data.usage?.output_tokens !== undefined) outputTokens = data.usage.output_tokens;
          if (data.usage?.input_tokens !== undefined) inputTokens = data.usage.input_tokens;
        } else if (event.event === 'content_block_start') {
          const data = event.data as {
            index?: number;
            content_block?: AnthropicContentBlock;
          };
          const block = data.content_block;
          if (block?.type === 'tool_use' && typeof data.index === 'number') {
            toolUseByIndex.set(data.index, {
              id: block.id,
              name: block.name,
              partialJson: [],
            });
          } else if (
            (block?.type === 'thinking' || block?.type === 'redacted_thinking') &&
            typeof data.index === 'number'
          ) {
            // v2.14 — start tracking a thinking block. Text + signature
            // arrive via subsequent content_block_delta events; if start
            // ALSO carries a signature (rare but possible for redacted),
            // we seed the buffer from there.
            thinkingByIndex.set(data.index, {
              type: block.type,
              thinking: [],
              signature: block.signature !== undefined ? [block.signature] : [],
            });
          }
        } else if (event.event === 'content_block_delta') {
          const data = event.data as {
            index?: number;
            delta?: {
              type?: string;
              text?: string;
              partial_json?: string;
              thinking?: string;
              signature?: string;
            };
          };
          const delta = data.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            accumulatedText.push(delta.text);
            yield { tokenIndex, content: delta.text, done: false };
            tokenIndex++;
          } else if (
            delta?.type === 'input_json_delta' &&
            typeof data.index === 'number' &&
            typeof delta.partial_json === 'string'
          ) {
            const tu = toolUseByIndex.get(data.index);
            if (tu) tu.partialJson.push(delta.partial_json);
          } else if (
            delta?.type === 'thinking_delta' &&
            typeof data.index === 'number' &&
            typeof delta.thinking === 'string'
          ) {
            // v2.14 — accumulate thinking text fragment
            const t = thinkingByIndex.get(data.index);
            if (t) t.thinking.push(delta.thinking);
          } else if (
            delta?.type === 'signature_delta' &&
            typeof data.index === 'number' &&
            typeof delta.signature === 'string'
          ) {
            // v2.14 — accumulate signature fragment (Anthropic ships
            // the signature as ONE delta but we accumulate just in case
            // they ever chunk it; concat preserves byte-exact regardless)
            const t = thinkingByIndex.get(data.index);
            if (t) t.signature.push(delta.signature);
          }
        } else if (event.event === 'content_block_stop') {
          const data = event.data as { index?: number };
          if (typeof data.index === 'number') {
            const tu = toolUseByIndex.get(data.index);
            if (tu) {
              const joined = tu.partialJson.join('');
              // Empty partial_json is valid — means no args (e.g. list_skills()).
              // JSON.parse('') throws; default to `{}` on empty OR malformed
              // payloads (which we should never see, but defending against an
              // upstream malformed chunk is cheaper than a broken loop).
              let parsed: Record<string, unknown> = {};
              if (joined.length > 0) {
                try {
                  parsed = JSON.parse(joined) as Record<string, unknown>;
                } catch {
                  parsed = {};
                }
              }
              completedToolUses.push({ id: tu.id, name: tu.name, input: parsed });
              toolUseByIndex.delete(data.index);
            }
            // v2.14 — finalize a thinking block at content_block_stop.
            const t = thinkingByIndex.get(data.index);
            if (t) {
              const thinkingText = t.thinking.join('');
              const signature = t.signature.join('');
              if (t.type === 'redacted_thinking') {
                completedThinking.push({
                  type: 'redacted_thinking',
                  ...(signature.length > 0 && { signature }),
                });
              } else {
                completedThinking.push({
                  type: 'thinking',
                  thinking: thinkingText,
                  ...(signature.length > 0 && { signature }),
                });
              }
              thinkingByIndex.delete(data.index);
            }
          }
        }
      }

      const response2: LLMResponse = {
        content: accumulatedText.join(''),
        toolCalls: completedToolUses.map((t) => ({ id: t.id, name: t.name, args: t.input })),
        usage: { input: inputTokens, output: outputTokens, ...cacheUsage },
        stopReason: normalizeStopReason(stopReason ?? 'stop'),
        ...(messageId && { providerRef: messageId }),
        // v2.14 — pass thinking blocks through as `rawThinking` so the
        // framework's NormalizeThinking subflow can normalize them into
        // ThinkingBlock[] via AnthropicThinkingHandler. Same shape as the
        // non-streaming path's fromAnthropicResponse.
        ...(completedThinking.length > 0 && { rawThinking: completedThinking }),
      };
      yield { tokenIndex, content: '', done: true, response: response2 };
    },
  };
  return provider;
}

export class BrowserAnthropicProvider implements LLMProvider {
  readonly name = 'browser-anthropic';
  readonly carriesInMessages = CARRIES_IN_MESSAGES;
  readonly carriesForcedToolChoice = true;
  private readonly inner: LLMProvider;

  constructor(options: BrowserAnthropicProviderOptions) {
    this.inner = browserAnthropic(options);
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

// ─── Internals ──────────────────────────────────────────────────────

function buildBody(
  req: LLMRequest,
  defaultModel: string,
  defaultMaxTokens: number,
  parallelToolCalls?: boolean,
): AnthropicRequestBody {
  // v2.14 — auto-bump max_tokens when thinking would violate Anthropic's
  // `max_tokens > thinking.budget_tokens` invariant. See the matching
  // logic in AnthropicProvider.buildParams; identical heuristic.
  let maxTokens = req.maxTokens ?? defaultMaxTokens;
  if (req.thinking && maxTokens <= req.thinking.budget) {
    maxTokens = req.thinking.budget + 1024;
  }
  // The map is only needed when a messages marker has to be placed; building
  // it always keeps the transform single-pass and costs one number per message.
  const messageIndexMap: number[] = [];
  const body: AnthropicRequestBody = {
    model:
      req.model === 'anthropic' || req.model === 'browser-anthropic' ? defaultModel : req.model,
    max_tokens: maxTokens,
    messages: toAnthropicMessages(req.messages, messageIndexMap),
  };
  if (req.systemPrompt) body.system = req.systemPrompt;
  if (req.tools && req.tools.length > 0) body.tools = req.tools.map(toAnthropicTool);
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) body.stop_sequences = [...req.stop];
  // v2.14 — extended-thinking activation, mirrors Node AnthropicProvider.
  if (req.thinking) {
    body.thinking = { type: 'enabled', budget_tokens: req.thinking.budget };
  }
  // One tool per reply — same guard as the Node provider: Anthropic rejects
  // `tool_choice` on a request that carries no tools.
  if (parallelToolCalls === false && body.tools !== undefined && body.tools.length > 0) {
    body.tool_choice = { type: 'auto', disable_parallel_tool_use: true };
  }
  // Forced choice wins over the parallel cap — see the Node provider.
  if (req.toolChoice && body.tools !== undefined && body.tools.length > 0) {
    body.tool_choice = { type: 'tool', name: req.toolChoice.name };
  }
  // v2.6+ cache markers — applied AFTER body construction so we have
  // the materialized fields (system / tools / messages) to mark.
  // Markers are clamped to Anthropic's 4-marker limit by
  // AnthropicCacheStrategy before we get here, so the loop below
  // doesn't need to enforce.
  if (req.cacheMarkers && req.cacheMarkers.length > 0) {
    applyCacheMarkers(body, req.cacheMarkers, messageIndexMap);
  }
  return body;
}

// applyCacheMarkers + MessageIndexMap moved to anthropicCacheWire.ts (shared
// with the Node AnthropicProvider, which used to drop markers on the floor).

function toAnthropicMessages(
  messages: readonly LLMMessage[],
  indexMap?: number[],
): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      indexMap?.push(-1);
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
      // ordering rule. Out-of-order = HTTP 400. Signature passes through
      // BYTE-EXACT — no String() coercion, no JSON-roundtrip, no trim.
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
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: { ...tc.args } });
        }
      }
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
      const last = result[result.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        // Coalesced into the user turn already open — several request messages
        // share one body index.
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
  // v2.14 — detect thinking presence so we can pass the full content
  // array through as `rawThinking` for the framework's thinking subflow
  // (handler filters thinking + redacted_thinking blocks; ignores rest).
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
    },
    stopReason: normalizeStopReason(message.stop_reason),
    providerRef: message.id,
    // Pass the FULL content array — handler filters by type. Undefined
    // when no thinking present so the subflow's early-return kicks in.
    ...(hasThinking && { rawThinking: message.content }),
  };
}

function normalizeStopReason(raw: string): string {
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

/** Parse Anthropic's SSE event stream from a fetch ReadableStream. */
async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      // Events are separated by \n\n.
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        // Belt-and-suspenders: a malformed SSE chunk should not throw out of
        // the async generator and tear down the whole stream. v1 wrapped
        // this; an upstream proxy or a partial flush could in principle
        // produce a non-JSON `data:` line.
        let data: unknown = {};
        if (dataLines.length > 0) {
          try {
            data = JSON.parse(dataLines.join('\n'));
          } catch {
            data = {};
          }
        }
        yield { event, data };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function wrapStatus(response: Response): Promise<Error> {
  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    /* ignore */
  }
  // Same as the browser OpenAI adapter: an HTTP refusal never reaches
  // `wrapError`, and the body is where "prompt is too long" is written.
  const tooBig = asContextWindowExceeded(new Error(bodyText), {
    provider: 'browser-anthropic',
    bodyText,
    status: response.status,
  });
  if (tooBig) return tooBig;
  return Object.assign(
    new Error(
      `[browser-anthropic] ${response.status} ${response.statusText} — ${bodyText.slice(0, 200)}`,
    ),
    {
      name: 'BrowserAnthropicProviderError',
      status: response.status,
    },
  );
}

function wrapError(err: unknown): Error {
  const tooBig = asContextWindowExceeded(err, { provider: 'browser-anthropic' });
  if (tooBig) return tooBig;
  if (err instanceof Error) {
    return Object.assign(new Error(`[browser-anthropic] ${err.message}`), {
      name: 'BrowserAnthropicProviderError',
      cause: err,
    });
  }
  return new Error(`[browser-anthropic] ${String(err)}`);
}
