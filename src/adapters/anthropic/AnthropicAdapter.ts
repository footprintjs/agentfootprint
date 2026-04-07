/**
 * AnthropicAdapter — wraps @anthropic-ai/sdk as an LLMProvider.
 *
 * Requires: npm install @anthropic-ai/sdk
 *
 * Features:
 *   - Full chat() + chatStream() support
 *   - Multi-modal content (text, images, tool_use, tool_result)
 *   - AbortSignal passthrough for cancellation
 *   - Normalized LLMError for uniform error handling
 *
 * Usage:
 *   import { AnthropicAdapter } from 'agentfootprint';
 *   const provider = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514' });
 *   const agent = Agent.create({ provider }).build();
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
  top_p?: number;
  stop_sequences?: string[];
  signal?: AbortSignal;
}

interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  thinking?: string;
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

interface AnthropicStream {
  on(event: 'text', handler: (text: string) => void): AnthropicStream;
  on(event: 'contentBlock', handler: (block: AnthropicContentBlock) => void): AnthropicStream;
  on(event: 'message', handler: (message: AnthropicMessage) => void): AnthropicStream;
  on(event: string, handler: (...args: unknown[]) => void): AnthropicStream;
  finalMessage(): Promise<AnthropicMessage>;
  [Symbol.asyncIterator](): AsyncIterator<AnthropicStreamEvent>;
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: { type: string; text?: string; thinking?: string; partial_json?: string };
  message?: AnthropicMessage;
  usage?: { output_tokens: number };
}

// ── Adapter ──────────────────────────────────────────────────

export interface AnthropicAdapterOptions {
  /** Model ID (e.g., 'claude-sonnet-4-20250514'). */
  readonly model: string;
  /** API key. Defaults to ANTHROPIC_API_KEY env var. */
  readonly apiKey?: string;
  /** Max tokens in response. Default: 4096. */
  readonly maxTokens?: number;
  /** @internal Pre-built client for testing. Skips SDK import. */
  readonly _client?: unknown;
}

export class AnthropicAdapter implements LLMProvider {
  private readonly client: AnthropicClient;
  private readonly model: string;
  private readonly defaultMaxTokens: number;

  constructor(options: AnthropicAdapterOptions) {
    this.model = options.model;
    this.defaultMaxTokens = options.maxTokens ?? 4096;

    if (options._client) {
      this.client = options._client as AnthropicClient;
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Anthropic = require('@anthropic-ai/sdk').default ?? require('@anthropic-ai/sdk');
      this.client = new Anthropic({
        apiKey: options.apiKey,
      });
    } catch {
      throw new Error(
        'AnthropicAdapter requires @anthropic-ai/sdk. Install it:\n  npm install @anthropic-ai/sdk',
      );
    }
  }

  async chat(messages: Message[], options?: LLMCallOptions): Promise<LLMResponse> {
    const params = this.buildParams(messages, options);

    try {
      const response = await this.client.messages.create(params);
      return convertResponse(response);
    } catch (err) {
      throw wrapSDKError(err, 'anthropic');
    }
  }

  async *chatStream(messages: Message[], options?: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    const params = this.buildParams(messages, options);

    let stream: AnthropicStream;
    try {
      stream = this.client.messages.stream(params);
    } catch (err) {
      throw wrapSDKError(err, 'anthropic');
    }

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta) {
          if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
            yield { type: 'thinking', content: event.delta.thinking };
          } else if (event.delta.type === 'text_delta' && event.delta.text) {
            yield { type: 'token', content: event.delta.text };
          } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
            // Tool input streaming — accumulate but don't yield as token
          }
        } else if (event.type === 'content_block_start' && event.content_block) {
          if (event.content_block.type === 'tool_use') {
            yield {
              type: 'tool_call',
              toolCall: {
                id: event.content_block.id!,
                name: event.content_block.name!,
                arguments: {},
              },
            };
          }
        } else if (event.type === 'message_delta' && event.usage) {
          // Final usage — will be in the finalMessage
        }
      }

      // Get final message for complete response
      const finalMessage = await stream.finalMessage();
      const finalResponse = convertResponse(finalMessage);

      yield {
        type: 'usage',
        usage: finalResponse.usage,
      };

      yield { type: 'done', content: finalResponse.content };
    } catch (err) {
      throw wrapSDKError(err, 'anthropic');
    }
  }

  private buildParams(messages: Message[], options?: LLMCallOptions): AnthropicCreateParams {
    // Extract system prompt from messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    let systemPrompt =
      systemMessages.length > 0
        ? systemMessages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
        : undefined;

    // Structured output: inject JSON Schema for providers without native response_format
    const schemaInstruction = options?.responseFormat?.type === 'json_schema'
      ? `You MUST respond with valid JSON matching this schema:\n<json_schema>\n${JSON.stringify(options.responseFormat.schema, null, 2)}\n</json_schema>\nRespond ONLY with the JSON object, no other text.`
      : undefined;

    const injection = options?.responseFormat?.injection ?? 'system';

    if (schemaInstruction && injection === 'system') {
      systemPrompt = (systemPrompt ?? '') + '\n\n' + schemaInstruction;
    }

    // Convert messages (Anthropic only supports user/assistant roles)
    let anthropicMessages = convertMessages(messages.filter((m) => m.role !== 'system'));

    // User-message injection: append schema as last user message (recency window)
    if (schemaInstruction && injection === 'user') {
      anthropicMessages = [
        ...anthropicMessages,
        { role: 'user' as const, content: schemaInstruction },
      ];
    }

    // Convert tools
    const tools = options?.tools?.map(convertTool);

    return {
      model: this.model,
      max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
      messages: anthropicMessages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.stop ? { stop_sequences: options.stop } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    };
  }
}

// ── Converters ───────────────────────────────────────────────

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
        // URL images — Anthropic doesn't support URL source natively,
        // but some proxy endpoints do. Pass through.
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: '', // Placeholder — user should use base64
          },
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
          content:
            typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          is_error: block.isError,
        };
    }
  });
}

function convertMessages(messages: Message[]): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: convertContent(msg.content),
      });
    } else if (msg.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];

      // Handle content — string or ContentBlock[]
      if (typeof msg.content === 'string') {
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content });
        }
      } else if (Array.isArray(msg.content)) {
        const converted = convertContent(msg.content);
        if (Array.isArray(converted)) {
          blocks.push(...converted);
        }
      }

      // Add tool use blocks from toolCalls
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
      }

      const text = typeof msg.content === 'string' ? msg.content : '';
      result.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : text,
      });
    } else if (msg.role === 'tool') {
      // Anthropic: tool results are content blocks inside a user message
      const toolResultContent =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

      const toolResult: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId,
        content: toolResultContent,
      };

      // Merge with previous user message if it's a tool_result, or create new
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
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'thinking' && block.thinking) {
      thinkingParts.push(block.thinking);
    } else if (block.type === 'text' && block.text) {
      textParts.push(block.text);
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
    content: textParts.join(''),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
    model: response.model,
    finishReason: finishReason as LLMResponse['finishReason'],
    thinking: thinkingParts.length > 0 ? thinkingParts.join('') : undefined,
  };
}
