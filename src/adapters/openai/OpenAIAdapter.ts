/**
 * OpenAIAdapter — wraps the openai SDK as an LLMProvider.
 *
 * Requires: npm install openai
 *
 * Also works with OpenAI-compatible APIs (Ollama, Together, Groq, etc.)
 * by setting the baseURL option.
 *
 * Features:
 *   - Full chat() + chatStream() support
 *   - Multi-modal content (text, images via URL)
 *   - AbortSignal passthrough for cancellation
 *   - Normalized LLMError for uniform error handling
 *
 * Usage:
 *   import { OpenAIAdapter } from 'agentfootprint';
 *   const provider = new OpenAIAdapter({ model: 'gpt-4o' });
 *
 *   // Ollama (OpenAI-compatible):
 *   const ollama = new OpenAIAdapter({
 *     model: 'llama3',
 *     baseURL: 'http://localhost:11434/v1',
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
import { wrapSDKError } from '../../types/errors';

// ── SDK Types (duck-typed to avoid hard dependency) ──────────

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
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  signal?: AbortSignal;
}

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
    arguments: string; // JSON string
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
    total_tokens: number;
  };
}

// ── Adapter ──────────────────────────────────────────────────

export interface OpenAIAdapterOptions {
  /** Model ID (e.g., 'gpt-4o', 'gpt-4o-mini'). */
  readonly model: string;
  /** API key. Defaults to OPENAI_API_KEY env var. */
  readonly apiKey?: string;
  /** Base URL for OpenAI-compatible APIs (Ollama, Together, Groq). */
  readonly baseURL?: string;
  /** Max tokens in response. */
  readonly maxTokens?: number;
  /** @internal Pre-built client for testing. Skips SDK import. */
  readonly _client?: unknown;
}

export class OpenAIAdapter implements LLMProvider {
  private readonly client: OpenAIClient;
  private readonly model: string;
  private readonly defaultMaxTokens?: number;

  constructor(options: OpenAIAdapterOptions) {
    this.model = options.model;
    this.defaultMaxTokens = options.maxTokens;

    if (options._client) {
      this.client = options._client as OpenAIClient;
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const OpenAI = require('openai').default ?? require('openai');
      this.client = new OpenAI({
        apiKey: options.apiKey,
        ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      });
    } catch {
      throw new Error(
        'OpenAIAdapter requires the openai package. Install it:\n  npm install openai',
      );
    }
  }

  async chat(messages: Message[], options?: LLMCallOptions): Promise<LLMResponse> {
    const params = this.buildParams(messages, options);

    try {
      const response = await (this.client.chat.completions.create(
        params,
      ) as Promise<OpenAIChatCompletion>);
      return convertResponse(response);
    } catch (err) {
      throw wrapSDKError(err, 'openai');
    }
  }

  async *chatStream(messages: Message[], options?: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    const params = this.buildParams(messages, options);

    let stream: AsyncIterable<OpenAIStreamChunk>;
    try {
      stream = this.client.chat.completions.create({
        ...params,
        stream: true,
      } as OpenAICreateParams) as unknown as AsyncIterable<OpenAIStreamChunk>;
    } catch (err) {
      throw wrapSDKError(err, 'openai');
    }

    // Accumulate tool calls across chunks
    const toolCallAccumulator: Map<number, { id: string; name: string; args: string }> = new Map();

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        // Text token
        if (choice.delta.content) {
          yield { type: 'token', content: choice.delta.content };
        }

        // Tool call chunks
        if (choice.delta.tool_calls) {
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

        // Usage (final chunk)
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
        if (choice.finish_reason === 'tool_calls') {
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

      yield { type: 'done' };
    } catch (err) {
      throw wrapSDKError(err, 'openai');
    }
  }

  private buildParams(messages: Message[], options?: LLMCallOptions): OpenAICreateParams {
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
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.responseFormat
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: options.responseFormat.name ?? 'response',
                schema: options.responseFormat.schema,
                strict: true,
              },
            },
          }
        : {}),
    };
  }
}

// ── Converters ───────────────────────────────────────────────

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
          // OpenAI accepts data URLs for base64 images
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${block.source.mediaType};base64,${block.source.data}` },
          });
        }
        break;
      // tool_use and tool_result blocks are handled by toolCalls/tool messages
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
