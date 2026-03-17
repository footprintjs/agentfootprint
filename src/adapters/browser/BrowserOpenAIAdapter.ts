/**
 * BrowserOpenAIAdapter — fetch-based OpenAI adapter for browser environments.
 *
 * Zero peer dependencies — uses the global fetch() API.
 * Works in any modern browser. Requires the user's own API key.
 *
 * Also works with OpenAI-compatible APIs (Groq, Together, etc.)
 * by setting the baseURL option.
 *
 * Usage:
 *   import { BrowserOpenAIAdapter } from 'agentfootprint';
 *   const provider = new BrowserOpenAIAdapter({
 *     apiKey: 'sk-...',
 *     model: 'gpt-4o',
 *   });
 *
 *   // Groq (OpenAI-compatible):
 *   const groq = new BrowserOpenAIAdapter({
 *     apiKey: 'gsk_...',
 *     model: 'llama-3.3-70b-versatile',
 *     baseURL: 'https://api.groq.com/openai/v1/chat/completions',
 *   });
 */

import type {
  LLMProvider,
  LLMResponse,
  LLMCallOptions,
  LLMStreamChunk,
  Message,
  ToolCall,
  TokenUsage,
  LLMToolDescription,
  MessageContent,
} from '../../types';
import { LLMError, classifyStatusCode } from '../../types/errors';

// ── OpenAI API Types ─────────────────────────────────────────

type OpenAIMessageContent = string | null | OpenAIContentPart[];

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: OpenAIMessageContent;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
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
    total_tokens: number;
  };
}

interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  max_tokens?: number;
  temperature?: number;
  stop?: string[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
}

// ── Adapter ──────────────────────────────────────────────────

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export interface BrowserOpenAIAdapterOptions {
  /** API key (required for browser use). */
  readonly apiKey: string;
  /** Model ID (e.g., 'gpt-4o', 'gpt-4o-mini'). */
  readonly model: string;
  /** Max tokens in response. */
  readonly maxTokens?: number;
  /** Full URL for OpenAI-compatible APIs. Default: OpenAI. */
  readonly baseURL?: string;
}

export class BrowserOpenAIAdapter implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultMaxTokens?: number;
  private readonly baseURL: string;

  constructor(options: BrowserOpenAIAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.defaultMaxTokens = options.maxTokens;
    this.baseURL = options.baseURL ?? OPENAI_API_URL;
  }

  async chat(messages: Message[], options?: LLMCallOptions): Promise<LLMResponse> {
    const body = this.buildBody(messages, options);

    const response = await this.fetchAPI(body, options?.signal);
    const data = (await response.json()) as OpenAIChatCompletion;
    return convertResponse(data);
  }

  async *chatStream(messages: Message[], options?: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    const body = this.buildBody(messages, options);
    body.stream = true;
    body.stream_options = { include_usage: true };

    const response = await this.fetchAPI(body, options?.signal);
    const reader = response.body?.getReader();
    if (!reader) throw new LLMError({ message: 'No response body for streaming', code: 'unknown', provider: 'openai-browser' });

    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallAccumulator: Map<number, { id: string; name: string; args: string }> = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          let chunk: {
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
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          };
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          const choice = chunk.choices?.[0];

          // Text token
          if (choice?.delta?.content) {
            yield { type: 'token', content: choice.delta.content };
          }

          // Tool call chunks
          if (choice?.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              if (!toolCallAccumulator.has(tc.index)) {
                toolCallAccumulator.set(tc.index, { id: tc.id ?? '', name: '', args: '' });
              }
              const acc = toolCallAccumulator.get(tc.index)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
            }
          }

          // Usage (final chunk with stream_options)
          if (chunk.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: chunk.usage.prompt_tokens,
                outputTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
              },
            };
          }

          // Emit accumulated tool calls on finish
          if (choice?.finish_reason === 'tool_calls') {
            for (const [, tc] of toolCallAccumulator) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc.args);
              } catch {
                args = { _raw: tc.args };
              }
              yield {
                type: 'tool_call',
                toolCall: { id: tc.id, name: tc.name, arguments: args },
              };
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }

  private buildBody(messages: Message[], options?: LLMCallOptions): OpenAIRequestBody {
    const openaiMessages = convertMessages(messages);
    const tools = options?.tools?.map(convertTool);

    return {
      model: this.model,
      messages: openaiMessages,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(options?.maxTokens ?? this.defaultMaxTokens
        ? { max_tokens: options?.maxTokens ?? this.defaultMaxTokens }
        : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.stop ? { stop: options.stop } : {}),
    };
  }

  private async fetchAPI(body: OpenAIRequestBody, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'AbortError') {
        throw new LLMError({ message: 'Request aborted', code: 'aborted', provider: 'openai-browser', cause: error });
      }
      throw new LLMError({ message: error.message, code: 'network', provider: 'openai-browser', cause: error });
    }

    if (!response.ok) {
      let errorMessage = `OpenAI API error: ${response.status}`;
      try {
        const errorBody = await response.json() as { error?: { message?: string } };
        if (errorBody.error?.message) {
          errorMessage = errorBody.error.message;
        }
      } catch {
        // ignore parse error
      }
      throw new LLMError({
        message: errorMessage,
        code: classifyStatusCode(response.status),
        provider: 'openai-browser',
        statusCode: response.status,
      });
    }

    return response;
  }
}

// ── Converters (same logic as Node adapter) ──────────────────

function convertContent(content: MessageContent): OpenAIMessageContent {
  if (typeof content === 'string') return content;

  const parts: OpenAIContentPart[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: block.text });
        break;
      case 'image':
        if (block.source.type === 'url') {
          parts.push({ type: 'image_url', image_url: { url: block.source.url } });
        } else if (block.source.type === 'base64') {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${block.source.mediaType};base64,${block.source.data}` },
          });
        }
        break;
    }
  }

  return parts.length > 0 ? parts : null;
}

function convertMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map((msg): OpenAIMessage => {
    switch (msg.role) {
      case 'system':
        return {
          role: 'system',
          content: typeof msg.content === 'string' ? msg.content : String(msg.content),
        };

      case 'user':
        return {
          role: 'user',
          content: convertContent(msg.content),
        };

      case 'assistant': {
        const toolCalls: OpenAIToolCall[] | undefined = msg.toolCalls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));

        return {
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content : null,
          ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        };
      }

      case 'tool':
        return {
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : String(msg.content),
          tool_call_id: msg.toolCallId,
        };
    }
  });
}

function convertTool(tool: LLMToolDescription): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function convertResponse(response: OpenAIChatCompletion): LLMResponse {
  const choice = response.choices[0];
  if (!choice) {
    return { content: '', finishReason: 'error' };
  }

  const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      args = { _raw: tc.function.arguments };
    }

    return {
      id: tc.id,
      name: tc.function.name,
      arguments: args,
    };
  });

  const finishReason =
    choice.finish_reason === 'tool_calls'
      ? 'tool_calls'
      : choice.finish_reason === 'length'
      ? 'length'
      : choice.finish_reason === 'content_filter'
      ? 'error'
      : 'stop';

  const usage: TokenUsage | undefined = response.usage
    ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      }
    : undefined;

  return {
    content: choice.message.content ?? '',
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    usage,
    model: response.model,
    finishReason: finishReason as LLMResponse['finishReason'],
  };
}
