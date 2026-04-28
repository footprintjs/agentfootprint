/**
 * BrowserOpenAIProvider — fetch-based OpenAI adapter for browsers.
 *
 * Pattern: Adapter (GoF). Zero peer dependencies — uses global `fetch`.
 * Role:    Outer ring. Same `LLMProvider` contract as `OpenAIProvider`
 *          but skips the `openai` SDK. For prototypes / playgrounds.
 *          Production apps should proxy through a backend.
 * Emits:   N/A.
 *
 * Also works with OpenAI-compatible endpoints (Ollama, Together, vLLM)
 * via `apiUrl`.
 *
 * ─── 7-panel review ─────────────────────────────────────────────────
 *
 *   Same posture as `BrowserAnthropicProvider`: native fetch, SSE
 *   parser, stateless, error-wrapped, message-conversion mirrors the
 *   Node `OpenAIProvider`. See that adapter's review for full rubric.
 *
 * ─── Limitations ────────────────────────────────────────────────────
 *
 * • Multi-modal NOT in v2.0.
 * • CORS depends on the endpoint — OpenAI requires the user-supplied
 *   key in the Authorization header, which they'll do explicitly.
 *
 * ─── 7-pattern test coverage ────────────────────────────────────────
 *
 *   See `test/adapters/unit/BrowserOpenAIProvider.test.ts`.
 */

import type {
  LLMChunk,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
} from '../types.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// ─── Types (OpenAI Chat Completions shapes) ────────────────────────

interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  max_tokens?: number;
  temperature?: number;
  stop?: string[];
  stream?: boolean;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface OpenAIChatCompletion {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface OpenAIStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

// ─── Adapter ────────────────────────────────────────────────────────

export interface BrowserOpenAIProviderOptions {
  /** API key. REQUIRED. */
  readonly apiKey: string;
  /** Default model when `LLMRequest.model` is `'openai'`. */
  readonly defaultModel?: string;
  /** Default max tokens. */
  readonly defaultMaxTokens?: number;
  /** Override the API URL (Ollama, Together, vLLM, OpenAI proxies). */
  readonly apiUrl?: string;
  /** Optional `Organization` header. */
  readonly organization?: string;
  /** @internal Custom fetch implementation for tests. */
  readonly _fetch?: typeof fetch;
}

export function browserOpenai(options: BrowserOpenAIProviderOptions): LLMProvider {
  if (!options.apiKey) {
    throw new Error(
      'BrowserOpenAIProvider requires `apiKey`. Browser providers do not read environment variables.',
    );
  }
  const apiUrl = options.apiUrl ?? OPENAI_API_URL;
  const defaultModel = options.defaultModel ?? 'gpt-4o-mini';
  const defaultMaxTokens = options.defaultMaxTokens;
  const fetchImpl = options._fetch ?? fetch;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${options.apiKey}`,
  };
  if (options.organization) headers['openai-organization'] = options.organization;

  const provider: LLMProvider = {
    name: 'browser-openai',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const body: OpenAIRequestBody = buildBody(req, defaultModel, defaultMaxTokens, false);
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
      const json = (await response.json()) as OpenAIChatCompletion;
      return fromOpenAIResponse(json);
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const body: OpenAIRequestBody = buildBody(req, defaultModel, defaultMaxTokens, true);
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
      if (!response.body) throw new Error('[browser-openai] response has no body');

      const textParts: string[] = [];
      const toolCallsByIndex = new Map<number, { id: string; name: string; argsJson: string }>();
      let lastFinishReason = 'stop';
      let lastUsage: { prompt_tokens: number; completion_tokens: number } | undefined;
      let lastId = '';
      let tokenIndex = 0;

      for await (const data of parseSSE(response.body)) {
        if (data === '[DONE]') break;
        const chunk = data as OpenAIStreamChunk;
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (chunk.id) lastId = chunk.id;
        if (chunk.usage) lastUsage = chunk.usage;
        if (choice.finish_reason) lastFinishReason = choice.finish_reason;
        const delta = choice.delta;
        if (delta.content) {
          textParts.push(delta.content);
          yield { tokenIndex, content: delta.content, done: false };
          tokenIndex++;
        }
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index;
            const existing = toolCallsByIndex.get(idx) ?? { id: '', name: '', argsJson: '' };
            if (tcDelta.id) existing.id = tcDelta.id;
            if (tcDelta.function?.name) existing.name = tcDelta.function.name;
            if (tcDelta.function?.arguments) existing.argsJson += tcDelta.function.arguments;
            toolCallsByIndex.set(idx, existing);
          }
        }
      }

      const toolCalls = Array.from(toolCallsByIndex.values()).map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: parseArgs(tc.argsJson),
      }));
      const finalResponse: LLMResponse = {
        content: textParts.join(''),
        toolCalls,
        usage: {
          input: lastUsage?.prompt_tokens ?? 0,
          output: lastUsage?.completion_tokens ?? 0,
        },
        stopReason: normalizeStopReason(lastFinishReason),
        providerRef: lastId,
      };
      yield { tokenIndex, content: '', done: true, response: finalResponse };
    },
  };

  return provider;
}

export class BrowserOpenAIProvider implements LLMProvider {
  readonly name = 'browser-openai';
  private readonly inner: LLMProvider;

  constructor(options: BrowserOpenAIProviderOptions) {
    this.inner = browserOpenai(options);
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
  defaultMaxTokens: number | undefined,
  stream: boolean,
): OpenAIRequestBody {
  const body: OpenAIRequestBody = {
    model: req.model === 'openai' || req.model === 'browser-openai' ? defaultModel : req.model,
    messages: toOpenAIMessages(req.messages, req.systemPrompt),
  };
  if (stream) body.stream = true;
  if (req.tools && req.tools.length > 0) body.tools = req.tools.map(toOpenAITool);
  const max = req.maxTokens ?? defaultMaxTokens;
  if (max !== undefined) body.max_tokens = max;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) body.stop = [...req.stop];
  return body;
}

function toOpenAIMessages(
  messages: readonly LLMMessage[],
  systemPrompt: string | undefined,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];
  if (systemPrompt) result.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    if (m.role === 'system') {
      result.push({ role: 'system', content: m.content });
      continue;
    }
    if (m.role === 'user') {
      result.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const msg: OpenAIMessage = { role: 'assistant', content: m.content || null };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      result.push(msg);
      continue;
    }
    if (m.role === 'tool') {
      result.push({
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId ?? '',
      });
      continue;
    }
  }
  return result;
}

function toOpenAITool(schema: LLMToolSchema): OpenAITool {
  return {
    type: 'function',
    function: {
      name: schema.name,
      description: schema.description,
      parameters: { ...schema.inputSchema },
    },
  };
}

function fromOpenAIResponse(response: OpenAIChatCompletion): LLMResponse {
  const choice = response.choices[0];
  if (!choice) throw new Error('[browser-openai] response missing choices[0]');
  const message = choice.message;
  const toolCalls = (message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    args: parseArgs(tc.function.arguments),
  }));
  return {
    content: message.content ?? '',
    toolCalls,
    usage: {
      input: response.usage?.prompt_tokens ?? 0,
      output: response.usage?.completion_tokens ?? 0,
    },
    stopReason: normalizeStopReason(choice.finish_reason),
    providerRef: response.id,
  };
}

function parseArgs(json: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeStopReason(raw: string): string {
  switch (raw) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'content_filter';
    default:
      return raw;
  }
}

/** Parse OpenAI's SSE stream — `data: ...\n\n` lines, `[DONE]` terminator. */
async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
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
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            yield '[DONE]';
            return;
          }
          if (data) {
            try { yield JSON.parse(data); } catch { /* skip malformed */ }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function wrapStatus(response: Response): Promise<Error> {
  let bodyText = '';
  try { bodyText = await response.text(); } catch { /* ignore */ }
  return Object.assign(
    new Error(`[browser-openai] ${response.status} ${response.statusText} — ${bodyText.slice(0, 200)}`),
    { name: 'BrowserOpenAIProviderError', status: response.status },
  );
}

function wrapError(err: unknown): Error {
  if (err instanceof Error) {
    return Object.assign(new Error(`[browser-openai] ${err.message}`), {
      name: 'BrowserOpenAIProviderError',
      cause: err,
    });
  }
  return new Error(`[browser-openai] ${String(err)}`);
}
