/**
 * BrowserAnthropicAdapter — fetch-based Anthropic adapter for browser environments.
 *
 * Zero peer dependencies — uses the global fetch() API.
 * Works in any modern browser. Requires the user's own API key.
 *
 * Note: Anthropic requires the `anthropic-dangerous-direct-browser-access` header
 * to allow direct browser-to-API calls. This is intentional — the user explicitly
 * provides their own key for prototyping/playground use.
 *
 * Usage:
 *   import { BrowserAnthropicAdapter } from 'agentfootprint';
 *   const provider = new BrowserAnthropicAdapter({
 *     apiKey: 'sk-ant-...',
 *     model: 'claude-sonnet-4-20250514',
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

// ── Anthropic API Types ──────────────────────────────────────

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

interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
  source?: { type: string; media_type: string; data: string };
}

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

// ── Adapter ──────────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

export interface BrowserAnthropicAdapterOptions {
  /** API key (required for browser use). */
  readonly apiKey: string;
  /** Model ID (e.g., 'claude-sonnet-4-20250514'). */
  readonly model: string;
  /** Max tokens in response. Default: 4096. */
  readonly maxTokens?: number;
  /** Override API URL (e.g., for proxy). */
  readonly baseURL?: string;
}

export class BrowserAnthropicAdapter implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly baseURL: string;

  constructor(options: BrowserAnthropicAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.defaultMaxTokens = options.maxTokens ?? 4096;
    this.baseURL = options.baseURL ?? ANTHROPIC_API_URL;
  }

  async chat(messages: Message[], options?: LLMCallOptions): Promise<LLMResponse> {
    const body = this.buildBody(messages, options);

    const response = await this.fetchAPI(body, options?.signal);
    const data = (await response.json()) as AnthropicMessage;
    return convertResponse(data);
  }

  async *chatStream(messages: Message[], options?: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    const body = this.buildBody(messages, options);
    body.stream = true;

    const response = await this.fetchAPI(body, options?.signal);
    const reader = response.body?.getReader();
    if (!reader) throw new LLMError({ message: 'No response body for streaming', code: 'unknown', provider: 'anthropic-browser' });

    const decoder = new TextDecoder();
    let buffer = '';
    let finalUsage: TokenUsage | undefined;
    let finalContent = '';
    const toolInputBuffers: Map<number, { id: string; name: string; json: string }> = new Map();
    let blockIndex = 0;

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

          let event: {
            type: string;
            index?: number;
            content_block?: AnthropicContentBlock;
            delta?: { type: string; text?: string; partial_json?: string };
            message?: AnthropicMessage;
            usage?: { output_tokens: number };
          };
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          if (event.type === 'content_block_start' && event.content_block) {
            if (event.content_block.type === 'tool_use') {
              toolInputBuffers.set(event.index ?? blockIndex, {
                id: event.content_block.id!,
                name: event.content_block.name!,
                json: '',
              });
              yield {
                type: 'tool_call',
                toolCall: {
                  id: event.content_block.id!,
                  name: event.content_block.name!,
                  arguments: {},
                },
              };
            }
            blockIndex = (event.index ?? blockIndex) + 1;
          } else if (event.type === 'content_block_delta' && event.delta) {
            if (event.delta.type === 'text_delta' && event.delta.text) {
              finalContent += event.delta.text;
              yield { type: 'token', content: event.delta.text };
            } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
              const buf = toolInputBuffers.get(event.index ?? 0);
              if (buf) buf.json += event.delta.partial_json;
            }
          } else if (event.type === 'message_delta' && event.usage) {
            // Will get full usage from message_stop
          } else if (event.type === 'message_stop' && event.message) {
            const resp = convertResponse(event.message);
            finalUsage = resp.usage;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (finalUsage) {
      yield { type: 'usage', usage: finalUsage };
    }

    yield { type: 'done', content: finalContent };
  }

  private buildBody(messages: Message[], options?: LLMCallOptions): AnthropicRequestBody {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const systemPrompt =
      systemMessages.length > 0
        ? systemMessages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
        : undefined;

    const anthropicMessages = convertMessages(messages.filter((m) => m.role !== 'system'));
    const tools = options?.tools?.map(convertTool);

    return {
      model: this.model,
      max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
      messages: anthropicMessages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.stop ? { stop_sequences: options.stop } : {}),
    };
  }

  private async fetchAPI(body: AnthropicRequestBody, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'AbortError') {
        throw new LLMError({ message: 'Request aborted', code: 'aborted', provider: 'anthropic-browser', cause: error });
      }
      throw new LLMError({ message: error.message, code: 'network', provider: 'anthropic-browser', cause: error });
    }

    if (!response.ok) {
      let errorMessage = `Anthropic API error: ${response.status}`;
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
        provider: 'anthropic-browser',
        statusCode: response.status,
      });
    }

    return response;
  }
}

// ── Converters (same logic as Node adapter) ──────────────────

function convertContent(content: MessageContent): string | AnthropicContentBlock[] {
  if (typeof content === 'string') return content;

  return content.map((block): AnthropicContentBlock => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'image':
        if (block.source.type === 'base64') {
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: block.source.mediaType,
              data: block.source.data,
            },
          };
        }
        return {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: '' },
        };
      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.toolUseId,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          is_error: block.isError,
        };
    }
  });
}

function convertMessages(messages: Message[]): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: convertContent(msg.content) });
    } else if (msg.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];

      if (typeof msg.content === 'string') {
        if (msg.content) blocks.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        const converted = convertContent(msg.content);
        if (Array.isArray(converted)) blocks.push(...converted);
      }

      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
      }

      const text = typeof msg.content === 'string' ? msg.content : '';
      result.push({ role: 'assistant', content: blocks.length > 0 ? blocks : text });
    } else if (msg.role === 'tool') {
      const toolResultContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const toolResult: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId,
        content: toolResultContent,
      };

      const last = result[result.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as AnthropicContentBlock[]).push(toolResult);
      } else {
        result.push({ role: 'user', content: [toolResult] });
      }
    }
  }

  return result;
}

function convertTool(tool: LLMToolDescription): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function convertResponse(response: AnthropicMessage): LLMResponse {
  let textContent = '';
  const toolCalls: ToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'text' && block.text) {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id!,
        name: block.name!,
        arguments: (block.input as Record<string, unknown>) ?? {},
      });
    }
  }

  const finishReason =
    response.stop_reason === 'tool_use'
      ? 'tool_calls'
      : response.stop_reason === 'max_tokens'
      ? 'length'
      : 'stop';

  const usage: TokenUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
  };

  return {
    content: textContent,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
    model: response.model,
    finishReason: finishReason as LLMResponse['finishReason'],
  };
}
