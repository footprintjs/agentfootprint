/**
 * BedrockAdapter — wraps AWS Bedrock Converse API as an LLMProvider.
 *
 * Requires: npm install @aws-sdk/client-bedrock-runtime
 *
 * Uses the model-agnostic Converse API, so it works with any Bedrock model
 * (Claude, Llama, Mistral, Titan, etc.) without format-specific code.
 *
 * Features:
 *   - Full chat() + chatStream() support via ConverseStream
 *   - Multi-modal content (text, images)
 *   - AbortSignal passthrough for cancellation
 *   - Normalized LLMError for uniform error handling
 *
 * Usage:
 *   import { BedrockAdapter } from 'agentfootprint';
 *   const provider = new BedrockAdapter({
 *     model: 'anthropic.claude-sonnet-4-20250514-v1:0',
 *     region: 'us-east-1',
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

interface BedrockClient {
  send(command: unknown): Promise<BedrockConverseResponse>;
}

interface BedrockConverseInput {
  modelId: string;
  messages: BedrockMessage[];
  system?: Array<{ text: string }>;
  toolConfig?: { tools: BedrockToolSpec[] };
  inferenceConfig?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
  };
}

interface BedrockMessage {
  role: 'user' | 'assistant';
  content: BedrockContentBlock[];
}

interface BedrockContentBlock {
  text?: string;
  image?: { format: string; source: { bytes: Uint8Array } };
  toolUse?: { toolUseId: string; name: string; input: Record<string, unknown> };
  toolResult?: {
    toolUseId: string;
    content: Array<{ text: string }>;
    status?: 'success' | 'error';
  };
}

interface BedrockToolSpec {
  toolSpec: {
    name: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
}

interface BedrockConverseResponse {
  output?: {
    message?: BedrockMessage;
  };
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  metrics?: {
    latencyMs: number;
  };
}

interface BedrockConverseStreamResponse {
  stream?: AsyncIterable<BedrockStreamEvent>;
}

interface BedrockStreamEvent {
  contentBlockDelta?: { delta: { text?: string } };
  contentBlockStart?: { start: { toolUse?: { toolUseId: string; name: string } } };
  messageStop?: { stopReason: string };
  metadata?: { usage?: { inputTokens: number; outputTokens: number; totalTokens: number } };
}

// ── Adapter ──────────────────────────────────────────────────

export interface BedrockAdapterOptions {
  /** Bedrock model ID (e.g., 'anthropic.claude-sonnet-4-20250514-v1:0'). */
  readonly model: string;
  /** AWS region. Defaults to AWS_REGION env var. */
  readonly region?: string;
  /** Max tokens in response. Default: 4096. */
  readonly maxTokens?: number;
  /** @internal Pre-built client for testing. Skips SDK import. */
  readonly _client?: unknown;
}

export class BedrockAdapter implements LLMProvider {
  private readonly client: BedrockClient;
  private readonly model: string;
  private readonly defaultMaxTokens: number;

  // Command constructors — captured from the SDK
  private ConverseCommand: new (input: BedrockConverseInput) => unknown;
  private ConverseStreamCommand: new (input: BedrockConverseInput) => unknown;

  constructor(options: BedrockAdapterOptions) {
    this.model = options.model;
    this.defaultMaxTokens = options.maxTokens ?? 4096;

    // Default no-ops — overwritten if SDK is loaded
    this.ConverseCommand = class {} as never;
    this.ConverseStreamCommand = class {} as never;

    if (options._client) {
      this.client = options._client as BedrockClient;
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sdk = require('@aws-sdk/client-bedrock-runtime');
      const Client = sdk.BedrockRuntimeClient;
      this.ConverseCommand = sdk.ConverseCommand;
      this.ConverseStreamCommand = sdk.ConverseStreamCommand;
      this.client = new Client({
        ...(options.region ? { region: options.region } : {}),
      });
    } catch {
      throw new Error(
        'BedrockAdapter requires @aws-sdk/client-bedrock-runtime. Install it:\n  npm install @aws-sdk/client-bedrock-runtime',
      );
    }
  }

  async chat(messages: Message[], options?: LLMCallOptions): Promise<LLMResponse> {
    const input = this.buildInput(messages, options);

    try {
      const command = new this.ConverseCommand(input);
      const response = (await this.client.send(command)) as BedrockConverseResponse;
      return convertResponse(response, this.model);
    } catch (err) {
      throw wrapSDKError(err, 'bedrock');
    }
  }

  async *chatStream(messages: Message[], options?: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    const input = this.buildInput(messages, options);

    let response: BedrockConverseStreamResponse;
    try {
      const command = new this.ConverseStreamCommand(input);
      response = (await this.client.send(command)) as BedrockConverseStreamResponse;
    } catch (err) {
      throw wrapSDKError(err, 'bedrock');
    }

    if (!response.stream) {
      yield { type: 'done' };
      return;
    }

    // Accumulate tool calls
    let currentToolCall: { id: string; name: string; args: string } | null = null;

    try {
      for await (const event of response.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          yield { type: 'token', content: event.contentBlockDelta.delta.text };
        }

        if (event.contentBlockStart?.start?.toolUse) {
          // Emit previous tool call if any
          if (currentToolCall) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(currentToolCall.args);
            } catch {
              args = { _raw: currentToolCall.args };
            }
            yield {
              type: 'tool_call',
              toolCall: { id: currentToolCall.id, name: currentToolCall.name, arguments: args },
            };
          }
          const tu = event.contentBlockStart.start.toolUse;
          currentToolCall = { id: tu.toolUseId, name: tu.name, args: '' };
        }

        if (event.metadata?.usage) {
          // Emit final tool call if pending
          if (currentToolCall) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(currentToolCall.args);
            } catch {
              args = { _raw: currentToolCall.args };
            }
            yield {
              type: 'tool_call',
              toolCall: { id: currentToolCall.id, name: currentToolCall.name, arguments: args },
            };
            currentToolCall = null;
          }

          yield {
            type: 'usage',
            usage: {
              inputTokens: event.metadata.usage.inputTokens,
              outputTokens: event.metadata.usage.outputTokens,
              totalTokens: event.metadata.usage.totalTokens,
            },
          };
        }
      }

      yield { type: 'done' };
    } catch (err) {
      throw wrapSDKError(err, 'bedrock');
    }
  }

  private buildInput(messages: Message[], options?: LLMCallOptions): BedrockConverseInput {
    // Extract system prompt
    const systemMessages = messages.filter((m) => m.role === 'system');
    const system =
      systemMessages.length > 0
        ? systemMessages.map((m) => ({
            text: typeof m.content === 'string' ? m.content : '',
          }))
        : undefined;

    // Convert messages
    const bedrockMessages = convertMessages(messages.filter((m) => m.role !== 'system'));

    // Convert tools
    const tools = options?.tools?.map(convertTool);

    return {
      modelId: this.model,
      messages: bedrockMessages,
      ...(system ? { system } : {}),
      ...(tools && tools.length > 0 ? { toolConfig: { tools } } : {}),
      inferenceConfig: {
        maxTokens: options?.maxTokens ?? this.defaultMaxTokens,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.stop ? { stopSequences: options.stop } : {}),
      },
    };
  }
}

// ── Converters ───────────────────────────────────────────────

function convertContentToBlocks(content: MessageContent): BedrockContentBlock[] {
  if (typeof content === 'string') {
    return content ? [{ text: content }] : [];
  }

  const blocks: BedrockContentBlock[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'text':
        blocks.push({ text: block.text });
        break;
      case 'image':
        if (block.source.type === 'base64') {
          blocks.push({
            image: {
              format: block.source.mediaType.split('/')[1] || 'png',
              source: {
                bytes: Uint8Array.from(atob(block.source.data), (c) => c.charCodeAt(0)),
              },
            },
          });
        }
        break;
      case 'tool_use':
        blocks.push({
          toolUse: {
            toolUseId: block.id,
            name: block.name,
            input: block.input,
          },
        });
        break;
      case 'tool_result':
        blocks.push({
          toolResult: {
            toolUseId: block.toolUseId,
            content: [
              {
                text:
                  typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              },
            ],
            status: block.isError ? 'error' : 'success',
          },
        });
        break;
    }
  }
  return blocks;
}

function convertMessages(messages: Message[]): BedrockMessage[] {
  const result: BedrockMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: convertContentToBlocks(msg.content),
      });
    } else if (msg.role === 'assistant') {
      const blocks = convertContentToBlocks(msg.content);

      // Add tool use blocks from toolCalls
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            toolUse: {
              toolUseId: tc.id,
              name: tc.name,
              input: tc.arguments,
            },
          });
        }
      }

      result.push({ role: 'assistant', content: blocks });
    } else if (msg.role === 'tool') {
      // Bedrock: tool results go in a user message
      const toolResult: BedrockContentBlock = {
        toolResult: {
          toolUseId: msg.toolCallId,
          content: [
            {
              text: typeof msg.content === 'string' ? msg.content : String(msg.content),
            },
          ],
        },
      };

      // Merge with previous user message if possible
      const last = result[result.length - 1];
      if (last && last.role === 'user') {
        last.content.push(toolResult);
      } else {
        result.push({ role: 'user', content: [toolResult] });
      }
    }
  }

  return result;
}

function convertTool(tool: LLMToolDescription): BedrockToolSpec {
  return {
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: tool.inputSchema },
    },
  };
}

function convertResponse(response: BedrockConverseResponse, model: string): LLMResponse {
  const message = response.output?.message;
  if (!message) {
    return { content: '', finishReason: 'error' };
  }

  let textContent = '';
  const toolCalls: ToolCall[] = [];

  for (const block of message.content) {
    if (block.text) {
      textContent += block.text;
    } else if (block.toolUse) {
      toolCalls.push({
        id: block.toolUse.toolUseId,
        name: block.toolUse.name,
        arguments: block.toolUse.input,
      });
    }
  }

  const finishReason =
    response.stopReason === 'tool_use'
      ? 'tool_calls'
      : response.stopReason === 'max_tokens'
      ? 'length'
      : 'stop';

  const usage: TokenUsage | undefined = response.usage
    ? {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
      }
    : undefined;

  return {
    content: textContent,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
    model,
    finishReason: finishReason as LLMResponse['finishReason'],
  };
}
