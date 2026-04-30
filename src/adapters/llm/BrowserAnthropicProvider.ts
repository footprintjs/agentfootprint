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
  LLMChunk,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
} from '../types.js';

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
}

interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

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
  usage: { input_tokens: number; output_tokens: number };
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
  /** @internal Custom fetch implementation for tests / workers. */
  readonly _fetch?: typeof fetch;
}

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
  const fetchImpl = options._fetch ?? fetch;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  const provider: LLMProvider = {
    name: 'browser-anthropic',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const body: AnthropicRequestBody = {
        ...buildBody(req, defaultModel, defaultMaxTokens),
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
        ...buildBody(req, defaultModel, defaultMaxTokens),
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
      // Anthropic's stream ships usage in two places:
      //   1. `message_start.message.usage.input_tokens` — input count, sent first.
      //   2. `message_delta.usage.output_tokens` — running output count.
      // The terminal `message_stop` carries no usage; we close on whatever
      // the latest `message_delta` had. There is no final JSON message.
      let messageId: string | undefined;
      let stopReason: string | undefined;
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const event of parseSSE(response.body)) {
        if (event.event === 'message_start') {
          const msg = (event.data as { message?: AnthropicMessage }).message;
          if (msg) {
            messageId = msg.id;
            inputTokens = msg.usage?.input_tokens ?? 0;
            outputTokens = msg.usage?.output_tokens ?? 0;
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
          }
        } else if (event.event === 'content_block_delta') {
          const data = event.data as {
            index?: number;
            delta?: { type?: string; text?: string; partial_json?: string };
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
          }
        }
      }

      const response2: LLMResponse = {
        content: accumulatedText.join(''),
        toolCalls: completedToolUses.map((t) => ({ id: t.id, name: t.name, args: t.input })),
        usage: { input: inputTokens, output: outputTokens },
        stopReason: normalizeStopReason(stopReason ?? 'stop'),
        ...(messageId && { providerRef: messageId }),
      };
      yield { tokenIndex, content: '', done: true, response: response2 };
    },
  };
  return provider;
}

export class BrowserAnthropicProvider implements LLMProvider {
  readonly name = 'browser-anthropic';
  private readonly inner: LLMProvider;

  constructor(options: BrowserAnthropicProviderOptions) {
    this.inner = browserAnthropic(options);
  }

  complete(req: LLMRequest): Promise<LLMResponse> {
    return this.inner.complete(req);
  }

  stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    if (!this.inner.stream) throw new Error('stream() unavailable');
    return this.inner.stream(req);
  }
}

// ─── Internals ──────────────────────────────────────────────────────

function buildBody(
  req: LLMRequest,
  defaultModel: string,
  defaultMaxTokens: number,
): AnthropicRequestBody {
  const body: AnthropicRequestBody = {
    model:
      req.model === 'anthropic' || req.model === 'browser-anthropic' ? defaultModel : req.model,
    max_tokens: req.maxTokens ?? defaultMaxTokens,
    messages: toAnthropicMessages(req.messages),
  };
  if (req.systemPrompt) body.system = req.systemPrompt;
  if (req.tools && req.tools.length > 0) body.tools = req.tools.map(toAnthropicTool);
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) body.stop_sequences = [...req.stop];
  return body;
}

function toAnthropicMessages(messages: readonly LLMMessage[]): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      result.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: { ...tc.args } });
        }
      }
      result.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : m.content || '',
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
  for (const block of message.content) {
    if (block.type === 'text') textParts.push(block.text);
    else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, args: block.input });
    }
  }
  return {
    content: textParts.join(''),
    toolCalls,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
    },
    stopReason: normalizeStopReason(message.stop_reason),
    providerRef: message.id,
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
  if (err instanceof Error) {
    return Object.assign(new Error(`[browser-anthropic] ${err.message}`), {
      name: 'BrowserAnthropicProviderError',
      cause: err,
    });
  }
  return new Error(`[browser-anthropic] ${String(err)}`);
}
