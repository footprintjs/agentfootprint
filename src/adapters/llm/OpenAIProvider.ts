/**
 * OpenAIProvider — wraps the `openai` SDK as an `LLMProvider`.
 *
 * Pattern: Adapter (GoF) + Ports-and-Adapters (Cockburn 2005).
 * Role:    Outer ring — translates `LLMRequest`/`LLMResponse` to/from
 *          OpenAI's Chat Completions API. Knows nothing about agents,
 *          recorders, or compositions.
 * Emits:   N/A.
 *
 * ─── Limitations ────────────────────────────────────────────────────
 *
 * • Multi-modal NOT supported  (`LLMMessage.content` is
 *   `string`). May extend in a future release.
 * • `responseFormat` (JSON-mode) NOT exposed  — pass schema
 *   instructions via `systemPrompt` for now.
 *
 * The `baseURL` option enables OpenAI-compatible APIs (Ollama, Together,
 * Groq, vLLM, LM Studio) without a separate adapter — see the `ollama()`
 * convenience factory below.
 */

import type {
  LLMChunk,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
} from '../types.js';

// ─── OpenAI SDK shape (duck-typed) ─────────────────────────────────

interface OpenAIClient {
  chat: {
    completions: {
      create(
        params: OpenAICreateParams,
      ): Promise<OpenAIChatCompletion> | AsyncIterable<OpenAIStreamChunk>;
    };
  };
}

interface OpenAICreateParams {
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
  function: {
    name: string;
    arguments: string; // JSON-stringified args
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
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
    finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
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
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ─── Adapter ────────────────────────────────────────────────────────

export interface OpenAIProviderOptions {
  /** API key. Defaults to `OPENAI_API_KEY` env var. */
  readonly apiKey?: string;
  /** Base URL — set for OpenAI-compatible APIs (Ollama, Together, vLLM). */
  readonly baseURL?: string;
  /**
   * Default model used when `LLMRequest.model` is `'openai'` (the
   * shorthand). Full model ids pass through unchanged.
   */
  readonly defaultModel?: string;
  /** Default max tokens when the request doesn't set it. Optional. */
  readonly defaultMaxTokens?: number;
  /** @internal Pre-built client for testing. Skips SDK import. */
  readonly _client?: OpenAIClient;
}

/**
 * Build an `LLMProvider` backed by OpenAI's Chat Completions API.
 *
 * @example
 *   import { Agent } from 'agentfootprint';
 *   import { openai } from 'agentfootprint/providers';
 *
 *   const agent = Agent.create({
 *     provider: openai({ defaultModel: 'gpt-4o' }),
 *     model: 'openai',
 *   })
 *     .tool(searchTool)
 *     .build();
 */
export function openai(options: OpenAIProviderOptions = {}): LLMProvider {
  const client = resolveClient(options);
  const defaultModel = options.defaultModel ?? 'gpt-4o-mini';
  const defaultMaxTokens = options.defaultMaxTokens;

  const provider: LLMProvider = {
    name: 'openai',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const params = buildParams(req, defaultModel, defaultMaxTokens, false);
      try {
        const response = (await client.chat.completions.create(params)) as OpenAIChatCompletion;
        return fromOpenAIResponse(response);
      } catch (err) {
        throw wrapError(err);
      }
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const params = buildParams(req, defaultModel, defaultMaxTokens, true);
      let stream: AsyncIterable<OpenAIStreamChunk>;
      try {
        stream = client.chat.completions.create(params) as AsyncIterable<OpenAIStreamChunk>;
      } catch (err) {
        throw wrapError(err);
      }

      // Accumulate the streamed pieces so we can synthesize the
      // authoritative LLMResponse on the terminal chunk. OpenAI streams
      // tool_calls in chunks too — assemble id/name/args by index.
      const textParts: string[] = [];
      const toolCallsByIndex = new Map<number, { id: string; name: string; argsJson: string }>();
      let lastFinishReason: string | null = null;
      let lastUsage: { prompt_tokens: number; completion_tokens: number } | undefined;
      let lastId = '';
      let tokenIndex = 0;

      try {
        for await (const chunk of stream) {
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
        const response: LLMResponse = {
          content: textParts.join(''),
          toolCalls,
          usage: {
            input: lastUsage?.prompt_tokens ?? 0,
            output: lastUsage?.completion_tokens ?? 0,
          },
          stopReason: normalizeStopReason(lastFinishReason ?? 'stop'),
          providerRef: lastId,
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
 * Class form for consumers who prefer `new OpenAIProvider(...)`.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly inner: LLMProvider;

  constructor(options: OpenAIProviderOptions = {}) {
    this.inner = openai(options);
  }

  complete(req: LLMRequest): Promise<LLMResponse> {
    return this.inner.complete(req);
  }

  stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    if (!this.inner.stream) throw new Error('stream() unavailable');
    return this.inner.stream(req);
  }
}

/**
 * Convenience factory for Ollama (OpenAI-compatible endpoint).
 *
 * @example
 *   import { ollama } from 'agentfootprint/providers';
 *
 *   const provider = ollama({ defaultModel: 'llama3.2' });
 *   // Talks to http://localhost:11434/v1 by default.
 */
export function ollama(
  options: OpenAIProviderOptions & { readonly host?: string } = {},
): LLMProvider {
  const host = options.host ?? 'http://localhost:11434';
  const inner = openai({
    ...options,
    baseURL: options.baseURL ?? `${host}/v1`,
    apiKey: options.apiKey ?? 'ollama', // Ollama ignores the key; SDK requires non-empty.
    defaultModel: options.defaultModel ?? 'llama3.2',
  });
  return { ...inner, name: 'ollama' };
}

// ─── Internals ──────────────────────────────────────────────────────

function resolveClient(options: OpenAIProviderOptions): OpenAIClient {
  if (options._client) return options._client;
  let OpenAI: new (opts: { apiKey?: string; baseURL?: string }) => OpenAIClient;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const mod = require('openai');
    OpenAI = (mod.default ?? mod.OpenAI ?? mod) as new (opts: {
      apiKey?: string;
      baseURL?: string;
    }) => OpenAIClient;
  } catch {
    throw new Error(
      'OpenAIProvider requires the `openai` package.\n' +
        '  Install:  npm install openai\n' +
        '  Or pass `_client` for test injection.',
    );
  }
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  return new OpenAI({ apiKey, ...(options.baseURL && { baseURL: options.baseURL }) });
}

function buildParams(
  req: LLMRequest,
  defaultModel: string,
  defaultMaxTokens: number | undefined,
  stream: boolean,
): OpenAICreateParams {
  const params: OpenAICreateParams = {
    model: req.model === 'openai' || req.model === 'ollama' ? defaultModel : req.model,
    messages: toOpenAIMessages(req.messages, req.systemPrompt),
  };
  if (stream) params.stream = true;
  if (req.tools && req.tools.length > 0) params.tools = req.tools.map(toOpenAITool);
  const maxTokens = req.maxTokens ?? defaultMaxTokens;
  if (maxTokens !== undefined) params.max_tokens = maxTokens;
  if (req.temperature !== undefined) params.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) params.stop = [...req.stop];
  return params;
}

/**
 * messages → OpenAI messages.
 *
 * Roles map 1:1: system/user/assistant/tool. Assistant turns with
 * `toolCalls` get those serialized into `message.tool_calls` (args
 * JSON-stringified per OpenAI's contract). Tool messages map to
 * `role: 'tool'` with `tool_call_id`.
 */
function toOpenAIMessages(
  messages: readonly LLMMessage[],
  systemPrompt: string | undefined,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];
  // OpenAI accepts system role IN the messages array (unlike Anthropic's
  // separate `system` field). Prepend systemPrompt as the first system
  // message; subsequent in-message system entries pass through.
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }
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
      const msg: OpenAIMessage = {
        role: 'assistant',
        content: m.content || null,
      };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
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
  if (!choice) {
    throw new Error('[openai] response missing choices[0]');
  }
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
    // Malformed JSON in tool args is rare but observed; surface empty
    // args rather than crash. Consumers see the issue via the
    // (still-arriving) tool-call event.
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

function wrapError(err: unknown): Error {
  if (err instanceof Error) {
    return Object.assign(new Error(`[openai] ${err.message}`), {
      name: 'OpenAIProviderError',
      cause: err,
      status: (err as { status?: number }).status,
    });
  }
  return new Error(`[openai] ${String(err)}`);
}
