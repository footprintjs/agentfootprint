/**
 * BedrockProvider — wraps AWS Bedrock's Converse API as an `LLMProvider`.
 *
 * Pattern: Adapter (GoF) + Ports-and-Adapters (Cockburn 2005).
 * Role:    Outer ring — translates `LLMRequest`/`LLMResponse` to/from
 *          AWS Bedrock's model-agnostic Converse / ConverseStream APIs.
 *          Works with ANY Bedrock-hosted model (Claude, Llama, Mistral,
 *          Titan, Mixtral, ...) without format-specific code.
 * Emits:   N/A.
 *
 * Requires: `npm install @aws-sdk/client-bedrock-runtime`
 *
 * The Converse API is model-agnostic — one adapter covers every
 * Bedrock-hosted model (Claude, Llama, Mistral, Titan, Mixtral, ...).
 *
 * Tool calling works on BOTH paths: `complete()` reads `toolUse` blocks
 * off the Converse response, and `stream()` accumulates ConverseStream
 * `contentBlockStart` / `contentBlockDelta` / `contentBlockStop` events
 * (keyed by `contentBlockIndex`, so parallel tool calls that interleave
 * are parsed correctly) and delivers them on the terminal chunk's
 * `response.toolCalls`. A parity test pins the two paths together.
 *
 * ─── Limitations ────────────────────────────────────────────────────
 *
 * • Multi-modal NOT supported  (text content only).
 * • Guardrail integration NOT exposed yet — pass via the SDK client
 *   directly if needed.
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
import { lazyRequire } from '../../lib/lazyRequire.js';

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
  | {
      toolResult: {
        toolUseId: string;
        content: Array<{ text: string }>;
        status?: 'success' | 'error';
      };
    };

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

/**
 * ConverseStream event shapes we consume.
 *
 * Note the asymmetry with the non-streaming API: `toolUse.input` is a
 * fully-formed OBJECT on a Converse response, but a JSON **string
 * fragment** on a ConverseStream delta. Fragments arrive across many
 * events and must be joined before parsing, and blocks are addressed by
 * `contentBlockIndex` because parallel tool calls interleave.
 */
export interface BedrockStreamEvent {
  contentBlockStart?: {
    contentBlockIndex?: number;
    start?: { toolUse?: { toolUseId?: string; name?: string } };
  };
  contentBlockDelta?: {
    contentBlockIndex?: number;
    delta?: { text?: string; toolUse?: { input?: string } };
  };
  contentBlockStop?: { contentBlockIndex?: number };
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

export function bedrock(options: BedrockProviderOptions = {}): LLMProvider {
  const { client, Commands } = resolveClient(options);
  const defaultModel = options.defaultModel ?? 'anthropic.claude-sonnet-4-5-20250929-v1:0';
  const defaultMaxTokens = options.defaultMaxTokens ?? 4096;

  const provider: LLMProvider = {
    name: 'bedrock',
    carriesInMessages: CARRIES_IN_MESSAGES,
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

      // Tool-use blocks under construction, keyed by `contentBlockIndex`.
      // Keying by index (not arrival order) is what makes PARALLEL tool
      // calls work: Bedrock interleaves their argument fragments.
      const toolUseByIndex = new Map<number, { id: string; name: string; fragments: string[] }>();
      const completedToolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> =
        [];

      try {
        for await (const event of stream) {
          // ── Block start: id + name arrive here; arguments follow as
          //    JSON string fragments on deltas at the same index. ──
          const startIndex = event.contentBlockStart?.contentBlockIndex;
          const startToolUse = event.contentBlockStart?.start?.toolUse;
          if (startToolUse && typeof startIndex === 'number') {
            toolUseByIndex.set(startIndex, {
              id: startToolUse.toolUseId ?? '',
              name: startToolUse.name ?? '',
              fragments: [],
            });
          }

          if (event.contentBlockDelta?.delta?.text) {
            const text = event.contentBlockDelta.delta.text;
            textParts.push(text);
            yield { tokenIndex, content: text, done: false };
            tokenIndex++;
          }

          // ── Argument fragment. `LLMChunk` has no tool-delta field, so
          //    these are NOT yielded as chunks (same as both Browser
          //    providers) — they surface on the terminal `response`. ──
          const inputFragment = event.contentBlockDelta?.delta?.toolUse?.input;
          if (typeof inputFragment === 'string') {
            const deltaIndex = event.contentBlockDelta?.contentBlockIndex;
            const open =
              typeof deltaIndex === 'number' ? toolUseByIndex.get(deltaIndex) : undefined;
            // Bedrock sends `input: ''` fragments for no-arg tools; push
            // them anyway — the join below collapses them to ''.
            if (open) open.fragments.push(inputFragment);
          }

          // ── Block complete: join the fragments and parse. ──
          const stopIndex = event.contentBlockStop?.contentBlockIndex;
          if (typeof stopIndex === 'number') {
            const tu = toolUseByIndex.get(stopIndex);
            if (tu) {
              toolUseByIndex.delete(stopIndex);
              completedToolCalls.push({
                id: tu.id,
                name: tu.name,
                args: parseToolArgs(tu.fragments.join(''), tu.name, tu.id, stopIndex),
              });
            }
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

        // A block still open here never received its `contentBlockStop` —
        // truncated wire data. Emitting a half-parsed call would run a
        // tool with incomplete arguments, so we drop it and let the
        // honesty invariant below catch the resulting contradiction.
        const finalResponse: LLMResponse = ensureHonestToolUse({
          content: textParts.join(''),
          toolCalls: completedToolCalls,
          usage,
          stopReason,
        });
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
  readonly carriesInMessages = CARRIES_IN_MESSAGES;
  private readonly inner: LLMProvider;

  constructor(options: BedrockProviderOptions = {}) {
    this.inner = bedrock(options);
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
    mod = lazyRequire('@aws-sdk/client-bedrock-runtime');
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
  return ensureHonestToolUse({
    content: textParts.join(''),
    toolCalls,
    usage: {
      input: response.usage?.inputTokens ?? 0,
      output: response.usage?.outputTokens ?? 0,
    },
    stopReason: normalizeStopReason(response.stopReason ?? 'end_turn'),
    providerRef: response.ResponseMetadata?.RequestId,
  });
}

/**
 * Honesty invariant: a response claiming `tool_use` with zero parsed tool
 * calls is self-contradictory — the model asked for tools and the adapter
 * lost them. Never return it quietly; throw so a configured `reliability`
 * rule (retry / fallback / fail-fast) can act instead of the agent
 * silently answering without running its tools.
 *
 * Post-7.6.1 this cannot happen on today's wire shapes — it is a tripwire
 * for future ConverseStream shape drift. Applied on BOTH the streaming and
 * non-streaming exits so the two paths can never drift apart again.
 */
function ensureHonestToolUse(response: LLMResponse): LLMResponse {
  if (response.stopReason === 'tool_use' && response.toolCalls.length === 0) {
    throw Object.assign(
      new Error(
        "[bedrock] stopReason 'tool_use' with zero parsed tool calls — " +
          'tool-use blocks were lost (stream-shape drift?). ' +
          'Refusing to return a self-contradictory response.',
      ),
      { name: 'BedrockProviderError', code: 'BEDROCK_STREAM_TOOLUSE_LOST' },
    );
  }
  return response;
}

/**
 * Parse the joined JSON fragments of one streamed tool-use block.
 *
 * Empty (no-arg tools stream zero fragments, or a single `''`) → `{}`.
 * Malformed → a TYPED throw, never a silent `{}`: swallowing the failure
 * would execute a side-effecting tool with its arguments dropped, which is
 * the worst failure mode available. A thrown provider error reaches the
 * `reliability` / `withRetry` machinery, and a retry usually streams clean
 * JSON.
 *
 * The raw fragment bytes are deliberately NOT put in the message — tool
 * arguments can carry user data and provider error messages land in audit
 * logs unredacted. `rawLength` is reported instead.
 */
function parseToolArgs(
  joined: string,
  toolName: string,
  toolUseId: string,
  contentBlockIndex: number,
): Record<string, unknown> {
  if (joined.trim().length === 0) return {};
  try {
    return JSON.parse(joined) as Record<string, unknown>;
  } catch (parseErr) {
    throw Object.assign(
      new Error(
        `[bedrock] malformed tool-use JSON for tool '${toolName}' (toolUseId ${toolUseId}): ` +
          `${(parseErr as Error).message}. Refusing to run the tool with dropped arguments.`,
      ),
      {
        name: 'BedrockProviderError',
        code: 'BEDROCK_MALFORMED_TOOL_ARGS',
        toolName,
        toolUseId,
        contentBlockIndex,
        rawLength: joined.length,
        cause: parseErr,
      },
    );
  }
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
  // Already ours (the typed tool-use conditions above) — re-wrapping would
  // drop `code` / `toolName` / `toolUseId` and double-prefix the message.
  if (err instanceof Error && err.name === 'BedrockProviderError') return err;
  if (err instanceof Error) {
    return Object.assign(new Error(`[bedrock] ${err.message}`), {
      name: 'BedrockProviderError',
      cause: err,
      status:
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ??
        (err as { status?: number }).status,
    });
  }
  return new Error(`[bedrock] ${String(err)}`);
}
