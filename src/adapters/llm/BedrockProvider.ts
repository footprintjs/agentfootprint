/**
 * BedrockProvider — wraps AWS Bedrock's Converse API as an v2 `LLMProvider`.
 *
 * Pattern: Adapter (GoF) + Ports-and-Adapters (Cockburn 2005).
 * Role:    Outer ring — translates v2 `LLMRequest`/`LLMResponse` to/from
 *          AWS Bedrock's model-agnostic Converse / ConverseStream APIs.
 *          Works with ANY Bedrock-hosted model (Claude, Llama, Mistral,
 *          Titan, Mixtral, ...) without format-specific code.
 * Emits:   N/A.
 *
 * Requires: `npm install @aws-sdk/client-bedrock-runtime`
 *
 * ─── 7-panel design review (2026-04-28) ─────────────────────────────
 *
 *   LLM-AI system design   ✓ Converse API is model-agnostic — one
 *                            adapter covers every Bedrock-hosted
 *                            model. tool_use / tool_result blocks
 *                            map cleanly to v2 toolCalls.
 *   Performance            ✓ Single SDK send() per `complete()`;
 *                            ConverseStream for `stream()` yields
 *                            deltas natively.
 *   Scalability            ✓ Stateless adapter. AWS SDK handles
 *                            credential refresh + region routing.
 *   Research alignment     ✓ Mirrors v1 BedrockAdapter (origin/main
 *                            `c6e11d0`). Maps same field renames
 *                            (toolUseId, inputSchema.json, etc.).
 *   Flexibility            ✓ `region` + `client` injectable. Model
 *                            id passes through for fine-grained
 *                            routing (cross-region inference profiles
 *                            work as-is).
 *   Abstraction-modular    ✓ Separate converters mirror the
 *                            Anthropic/OpenAI adapters. Easy to keep
 *                            in lockstep when LLMMessage evolves.
 *   Software engineering   ✓ Duck-typed SDK shape. Errors wrapped
 *                            with provider tag. Tests cover the
 *                            7-pattern matrix.
 *
 * ─── Limitations ────────────────────────────────────────────────────
 *
 * • Multi-modal NOT supported in v2.0 (text content only).
 * • Guardrail integration NOT exposed yet — pass via the SDK client
 *   directly if needed.
 *
 * ─── 7-pattern test coverage ────────────────────────────────────────
 *
 *   See `test/adapters/unit/BedrockProvider.test.ts`.
 */

import type {
  LLMChunk,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
} from '../types.js';

// ─── Bedrock Converse SDK shape (duck-typed) ───────────────────────

interface BedrockClient {
  send(command: unknown): Promise<unknown>;
}

interface BedrockConverseCommand {
  modelId: string;
  messages: BedrockMessage[];
  system?: Array<{ text: string }>;
  toolConfig?: { tools: BedrockTool[] };
  inferenceConfig?: {
    maxTokens?: number;
    temperature?: number;
    stopSequences?: string[];
  };
}

interface BedrockMessage {
  role: 'user' | 'assistant';
  content: BedrockContentBlock[];
}

type BedrockContentBlock =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
  | { toolResult: { toolUseId: string; content: Array<{ text: string }>; status?: 'success' | 'error' } };

interface BedrockTool {
  toolSpec: {
    name: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
}

interface BedrockConverseResponse {
  output?: {
    message?: {
      role: 'assistant';
      content: BedrockContentBlock[];
    };
  };
  stopReason?:
    | 'end_turn'
    | 'tool_use'
    | 'max_tokens'
    | 'stop_sequence'
    | 'guardrail_intervened'
    | 'content_filtered'
    | string;
  usage?: { inputTokens: number; outputTokens: number };
  ResponseMetadata?: { RequestId?: string };
}

interface BedrockStreamEvent {
  contentBlockDelta?: { delta?: { text?: string } };
  messageStop?: { stopReason?: string };
  metadata?: { usage?: { inputTokens: number; outputTokens: number } };
  // Many other event shapes exist; we ignore the ones not needed here.
}

interface BedrockStreamResponse {
  stream?: AsyncIterable<BedrockStreamEvent>;
}

// ─── Adapter ────────────────────────────────────────────────────────

export interface BedrockProviderOptions {
  /** AWS region (e.g., 'us-east-1'). Defaults to AWS SDK auto-detect. */
  readonly region?: string;
  /**
   * Default model id (e.g., `anthropic.claude-sonnet-4-5-20250929-v1:0`).
   * Used when `LLMRequest.model` is the shorthand `'bedrock'`.
   */
  readonly defaultModel?: string;
  /** Default max tokens when not in the request. Default 4096. */
  readonly defaultMaxTokens?: number;
  /** @internal Pre-built client for testing. */
  readonly _client?: BedrockClient;
  /**
   * @internal Test override for the SDK's command constructors. Real
   * use goes through the dynamic `require('@aws-sdk/client-bedrock-runtime')`.
   */
  readonly _commands?: {
    readonly Converse: new (input: BedrockConverseCommand) => unknown;
    readonly ConverseStream: new (input: BedrockConverseCommand) => unknown;
  };
}

export function bedrock(options: BedrockProviderOptions = {}): LLMProvider {
  const { client, Commands } = resolveClient(options);
  const defaultModel = options.defaultModel ?? 'anthropic.claude-sonnet-4-5-20250929-v1:0';
  const defaultMaxTokens = options.defaultMaxTokens ?? 4096;

  const provider: LLMProvider = {
    name: 'bedrock',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const input = buildInput(req, defaultModel, defaultMaxTokens);
      try {
        const cmd = new Commands.Converse(input);
        const response = (await client.send(cmd)) as BedrockConverseResponse;
        return fromBedrockResponse(response);
      } catch (err) {
        throw wrapError(err);
      }
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const input = buildInput(req, defaultModel, defaultMaxTokens);
      let response: BedrockStreamResponse;
      try {
        const cmd = new Commands.ConverseStream(input);
        response = (await client.send(cmd)) as BedrockStreamResponse;
      } catch (err) {
        throw wrapError(err);
      }
      const stream = response.stream;
      if (!stream) {
        // Some Bedrock models / regions don't support streaming —
        // fall back to a synthesized terminal chunk via complete().
        const final = await provider.complete(req);
        yield { tokenIndex: 0, content: '', done: true, response: final };
        return;
      }

      const textParts: string[] = [];
      let stopReason = 'stop';
      let usage = { input: 0, output: 0 };
      let tokenIndex = 0;
      try {
        for await (const event of stream) {
          if (event.contentBlockDelta?.delta?.text) {
            const text = event.contentBlockDelta.delta.text;
            textParts.push(text);
            yield { tokenIndex, content: text, done: false };
            tokenIndex++;
          }
          if (event.messageStop?.stopReason) {
            stopReason = normalizeStopReason(event.messageStop.stopReason);
          }
          if (event.metadata?.usage) {
            usage = {
              input: event.metadata.usage.inputTokens,
              output: event.metadata.usage.outputTokens,
            };
          }
        }
        const finalResponse: LLMResponse = {
          content: textParts.join(''),
          // Tool-call streaming is NOT yielded as deltas in this v2.0
          // build — the consumer falls back to `complete()` to recover
          // the authoritative tool_use payload. Most Bedrock streams
          // currently emit tool_use only at messageEnd anyway.
          toolCalls: [],
          usage,
          stopReason,
        };
        yield { tokenIndex, content: '', done: true, response: finalResponse };
      } catch (err) {
        throw wrapError(err);
      }
    },
  };

  return provider;
}

export class BedrockProvider implements LLMProvider {
  readonly name = 'bedrock';
  private readonly inner: LLMProvider;

  constructor(options: BedrockProviderOptions = {}) {
    this.inner = bedrock(options);
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

function resolveClient(options: BedrockProviderOptions): {
  client: BedrockClient;
  Commands: {
    Converse: new (input: BedrockConverseCommand) => unknown;
    ConverseStream: new (input: BedrockConverseCommand) => unknown;
  };
} {
  if (options._client && options._commands) {
    return { client: options._client, Commands: options._commands };
  }
  let mod: {
    BedrockRuntimeClient: new (opts: { region?: string }) => BedrockClient;
    ConverseCommand: new (input: BedrockConverseCommand) => unknown;
    ConverseStreamCommand: new (input: BedrockConverseCommand) => unknown;
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    mod = require('@aws-sdk/client-bedrock-runtime');
  } catch {
    throw new Error(
      'BedrockProvider requires `@aws-sdk/client-bedrock-runtime`.\n' +
        '  Install:  npm install @aws-sdk/client-bedrock-runtime\n' +
        '  Or pass `_client` + `_commands` for test injection.',
    );
  }
  return {
    client: new mod.BedrockRuntimeClient({ region: options.region }),
    Commands: { Converse: mod.ConverseCommand, ConverseStream: mod.ConverseStreamCommand },
  };
}

function buildInput(
  req: LLMRequest,
  defaultModel: string,
  defaultMaxTokens: number,
): BedrockConverseCommand {
  const input: BedrockConverseCommand = {
    modelId: req.model === 'bedrock' ? defaultModel : req.model,
    messages: toBedrockMessages(req.messages),
  };
  if (req.systemPrompt) input.system = [{ text: req.systemPrompt }];
  if (req.tools && req.tools.length > 0) {
    input.toolConfig = { tools: req.tools.map(toBedrockTool) };
  }
  const inference: BedrockConverseCommand['inferenceConfig'] = {
    maxTokens: req.maxTokens ?? defaultMaxTokens,
  };
  if (req.temperature !== undefined) inference.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) inference.stopSequences = [...req.stop];
  input.inferenceConfig = inference;
  return input;
}

function toBedrockMessages(messages: readonly LLMMessage[]): BedrockMessage[] {
  const result: BedrockMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // system goes in `system` field
    if (m.role === 'user') {
      result.push({ role: 'user', content: [{ text: m.content }] });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: BedrockContentBlock[] = [];
      if (m.content) blocks.push({ text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          blocks.push({
            toolUse: { toolUseId: tc.id, name: tc.name, input: { ...tc.args } },
          });
        }
      }
      result.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : [{ text: '' }],
      });
      continue;
    }
    if (m.role === 'tool') {
      const block: BedrockContentBlock = {
        toolResult: {
          toolUseId: m.toolCallId ?? '',
          content: [{ text: m.content }],
        },
      };
      const last = result[result.length - 1];
      if (last && last.role === 'user') {
        last.content.push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
      continue;
    }
  }
  return result;
}

function toBedrockTool(schema: LLMToolSchema): BedrockTool {
  return {
    toolSpec: {
      name: schema.name,
      description: schema.description,
      inputSchema: { json: { ...schema.inputSchema } },
    },
  };
}

function fromBedrockResponse(response: BedrockConverseResponse): LLMResponse {
  const message = response.output?.message;
  const textParts: string[] = [];
  const toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
  if (message) {
    for (const block of message.content) {
      if ('text' in block && block.text) textParts.push(block.text);
      else if ('toolUse' in block && block.toolUse) {
        toolCalls.push({
          id: block.toolUse.toolUseId,
          name: block.toolUse.name,
          args: block.toolUse.input,
        });
      }
    }
  }
  return {
    content: textParts.join(''),
    toolCalls,
    usage: {
      input: response.usage?.inputTokens ?? 0,
      output: response.usage?.outputTokens ?? 0,
    },
    stopReason: normalizeStopReason(response.stopReason ?? 'end_turn'),
    providerRef: response.ResponseMetadata?.RequestId,
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
    case 'stop_sequence':
      return 'stop_sequence';
    case 'guardrail_intervened':
    case 'content_filtered':
      return 'content_filter';
    default:
      return raw;
  }
}

function wrapError(err: unknown): Error {
  if (err instanceof Error) {
    return Object.assign(new Error(`[bedrock] ${err.message}`), {
      name: 'BedrockProviderError',
      cause: err,
      status: (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        ?? (err as { status?: number }).status,
    });
  }
  return new Error(`[bedrock] ${String(err)}`);
}
