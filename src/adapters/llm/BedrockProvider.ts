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
 * • Thinking is NOT implemented: Converse reasoning blocks and their signed
 *   replay are not carried by this adapter. A request to think is refused
 *   before sending, never silently dropped.
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
} from '../../provider-contract/types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import { abortErrorOf, throwIfAborted } from '../../lib/abort.js';
import { checkedWaitMs } from '../../lib/waitDeadline.js';
import { bedrockDeadline, sendBedrock, timedBedrockEvents } from './bedrockStreamDeadline.js';
import { foldBedrockEvents } from './bedrockStreamAssembler.js';
import { ensureHonestToolUse, normalizeStopReason } from './bedrockOutput.js';
import { asContextWindowExceeded } from '../../provider-contract/contextWindow.js';
import { retryAfterMsFromError } from './retryAfter.js';
import { anthropicTakesForcedToolChoice } from './anthropicModels.js';
import {
  forcedToolChoiceFor,
  UnsupportedToolChoiceError,
} from '../../provider-contract/forcedToolChoice.js';
import { UnsupportedThinkingError } from '../../thinking/errors.js';
import {
  applyCacheMarkers,
  bedrockPromptCaching,
  readCacheUsage,
  type BedrockCachePoint,
  type BedrockCacheUsage,
  type BedrockMessagePosition,
} from './bedrockCacheWire.js';

// ─── Bedrock Converse SDK shape (duck-typed) ───────────────────────

interface BedrockClient {
  send(command: unknown, options?: BedrockSendOptions): Promise<unknown>;
}

/** AWS SDK v3's per-call HTTP options — the one this adapter sends is the
 *  abort signal, so an aborted run cancels the request itself (`lib/abort.ts`). */
interface BedrockSendOptions {
  abortSignal?: AbortSignal;
}

/** `client.send(cmd)`, with the request's signal when it has one. */
function sendUnder(
  client: BedrockClient,
  cmd: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  return signal ? client.send(cmd, { abortSignal: signal }) : client.send(cmd);
}

interface BedrockConverseCommand {
  modelId: string;
  messages: BedrockMessage[];
  system?: Array<{ text: string } | BedrockCachePoint>;
  toolConfig?: {
    tools: Array<BedrockTool | BedrockCachePoint>;
    /** v7.26 — Converse's forced choice of one named tool. `{ tool: { name } }`
     *  is the arm that names it; the API also has `auto` / `any`, which this
     *  library has no use for and therefore does not model. */
    toolChoice?: { tool: { name: string } };
  };
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
  | BedrockCachePoint
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
  usage?: BedrockCacheUsage;
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
  metadata?: { usage?: BedrockCacheUsage };
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
  /**
   * Opt-in cap for complete() and each stream idle/close/fallback wait.
   * Omitted: no cap. Consumer backpressure is excluded. A miss aborts the SDK
   * request and raises ProviderTimeoutError. Retry is advised only before any
   * output was observed, including tool arguments. Remote usage remains unknown.
   * Positive finite milliseconds, at most 2^31-1.
   */
  readonly timeoutMs?: number;
  /** Stream opening and first-event cap. Defaults to timeoutMs; tune above the
   * slowest expected prompt-prefill latency. Each wait has its own allowance. */
  readonly firstEventTimeoutMs?: number;
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
  /**
   * @internal Test injection (9.4.0) — the AWS SDK MODULE, keyed by the
   * constructor names the package really exports.
   *
   * `_commands` above is keyed `Converse` / `ConverseStream`, which is
   * convenient and hides the one fact worth pinning: which exported command
   * this adapter reaches for. Two adapters in this package have shipped
   * dispatching operations that do not exist, so the shared pin
   * (test/adapters/aws/) drives every AWS adapter through an `_sdk` double and
   * asserts the names. Takes precedence over `_commands` when both are given.
   */
  readonly _sdk?: BedrockConverseSdkModule;
}

/**
 * The slice of `@aws-sdk/client-bedrock-runtime` this provider touches, named
 * as the package names it. (The embedder door declares its own slice for
 * `InvokeModel` — same package, different operation.)
 */
export interface BedrockConverseSdkModule {
  readonly BedrockRuntimeClient?: new (config: { region?: string }) => BedrockClient;
  readonly ConverseCommand?: new (input: BedrockConverseCommand) => unknown;
  readonly ConverseStreamCommand?: new (input: BedrockConverseCommand) => unknown;
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
  const timeoutMs = checkedWaitMs(options.timeoutMs);
  const firstEventTimeoutMs =
    checkedWaitMs(options.firstEventTimeoutMs, 'firstEventTimeoutMs') ?? timeoutMs;
  const { client, Commands } = resolveClient(options);
  const defaultModel = options.defaultModel ?? 'anthropic.claude-sonnet-4-5-20250929-v1:0';
  const defaultMaxTokens = options.defaultMaxTokens ?? 4096;
  const modelOf = (model: string): string => (model === 'bedrock' ? defaultModel : model);

  const provider: LLMProvider = {
    name: 'bedrock',
    promptCaching: (model) => bedrockPromptCaching(modelOf(model)),
    carriesInMessages: CARRIES_IN_MESSAGES,
    // The existing boolean describes the wire. The optional model predicate
    // narrows it where the shared Claude table knows a model rejects it.
    carriesForcedToolChoice: true,
    supportsForcedToolChoice: (model) => anthropicTakesForcedToolChoice(modelOf(model)),
    thinkingMode: () => 'none',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      throwIfAborted(req.signal);
      const deadline = bedrockDeadline(timeoutMs, timeoutMs, req.signal, () => false);
      try {
        const input = buildInput(req, modelOf(req.model), defaultMaxTokens);
        const response = await sendBedrock<BedrockConverseResponse>(
          () => sendUnder(client, new Commands.Converse(input), deadline.signal),
          deadline,
          wrapError,
        );
        return fromBedrockResponse(response);
      } finally {
        deadline.dispose();
      }
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      throwIfAborted(req.signal);
      let afterOutput = false;
      const deadline = bedrockDeadline(
        timeoutMs,
        firstEventTimeoutMs,
        req.signal,
        () => afterOutput,
      );
      try {
        const input = buildInput(req, modelOf(req.model), defaultMaxTokens);
        const response = await sendBedrock<BedrockStreamResponse>(
          () => sendUnder(client, new Commands.ConverseStream(input), deadline.signal),
          deadline,
          wrapError,
        );
        if (!response.stream) {
          const final = fromBedrockResponse(
            await sendBedrock<BedrockConverseResponse>(
              () => sendUnder(client, new Commands.Converse(input), deadline.signal),
              deadline,
              wrapError,
              'fallback',
            ),
          );
          yield { tokenIndex: 0, content: '', done: true, response: final };
          return;
        }
        yield* foldBedrockEvents(
          timedBedrockEvents(response.stream, deadline, wrapError, () => {
            afterOutput = true;
          }),
        );
      } finally {
        deadline.dispose();
      }
    },
  };

  return provider;
}

export class BedrockProvider implements LLMProvider {
  readonly name = 'bedrock';
  readonly carriesInMessages = CARRIES_IN_MESSAGES;
  readonly carriesForcedToolChoice = true;
  readonly thinkingMode: (model: string) => 'none' = () => 'none';
  readonly supportsForcedToolChoice: (model: string) => boolean;
  readonly promptCaching: LLMProvider['promptCaching'];
  private readonly inner: LLMProvider;

  constructor(options: BedrockProviderOptions = {}) {
    this.inner = bedrock(options);
    this.promptCaching = this.inner.promptCaching;
    this.supportsForcedToolChoice = (model) => forcedToolChoiceFor(this.inner, model);
  }

  // `hooks` is FORWARDED, not dropped — see LLMCallHooks in provider-contract/types.ts.
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
  let mod: BedrockConverseSdkModule;
  if (options._sdk) {
    mod = options._sdk;
  } else if (options._client && options._commands) {
    return { client: options._client, Commands: options._commands };
  } else {
    try {
      mod = lazyRequire<BedrockConverseSdkModule>('@aws-sdk/client-bedrock-runtime');
    } catch {
      throw new Error(
        'BedrockProvider requires `@aws-sdk/client-bedrock-runtime`.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-runtime\n' +
          '  Or pass `_client` + `_commands` for test injection.',
      );
    }
  }
  // Named one at a time so a missing one is reported BY NAME. `Converse` and
  // `ConverseStream` are the two operations this provider has; an SDK missing
  // either is a different problem to an SDK that is not installed.
  for (const name of ['ConverseCommand', 'ConverseStreamCommand'] as const) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `BedrockProvider: \`@aws-sdk/client-bedrock-runtime\` is missing ${name}. ` +
          'Upgrade the SDK, or pass `_client` + `_commands` with your own mapping.',
      );
    }
  }
  const client =
    options._client ??
    (() => {
      if (typeof mod.BedrockRuntimeClient !== 'function') {
        throw new Error(
          'BedrockProvider: `@aws-sdk/client-bedrock-runtime` is installed but ' +
            '`BedrockRuntimeClient` was not found. Update the SDK.',
        );
      }
      return new mod.BedrockRuntimeClient({ region: options.region });
    })();
  return {
    client,
    // Both checked by name directly above.
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    Commands: { Converse: mod.ConverseCommand!, ConverseStream: mod.ConverseStreamCommand! },
    /* eslint-enable @typescript-eslint/no-non-null-assertion */
  };
}

function buildInput(
  req: LLMRequest,
  model: string,
  defaultMaxTokens: number,
): BedrockConverseCommand {
  // Converse accepts provider-specific thinking parameters, but enabling one
  // without carrying its signed reasoning through response/tool-result replay
  // would still break the conversation. Refuse this adapter's unsupported
  // intent before constructing a command on either transport path.
  if (req.thinking) {
    throw new UnsupportedThinkingError({
      provider: 'bedrock',
      model,
      reason: 'no-thinking',
      detail:
        'this Converse adapter does not implement thinking response and signed replay, so ' +
        '.thinking() cannot be honoured. Drop .thinking(), or use invokeModelGateway for ' +
        'a supported Claude Messages route through your gateway.',
    });
  }
  if (
    req.toolChoice !== undefined &&
    (req.tools?.length ?? 0) > 0 &&
    !anthropicTakesForcedToolChoice(model)
  ) {
    throw new UnsupportedToolChoiceError({ provider: 'bedrock', model });
  }
  const positions: (BedrockMessagePosition | undefined)[] = [];
  const input: BedrockConverseCommand = {
    modelId: model,
    messages: toBedrockMessages(req.messages, positions),
  };
  if (req.systemPrompt) input.system = [{ text: req.systemPrompt }];
  if (req.tools && req.tools.length > 0) {
    input.toolConfig = {
      tools: req.tools.map(toBedrockTool),
      // v7.26 — forced choice of one named tool. Nested inside the same guard
      // because `toolChoice` lives ON `toolConfig`: there is no place to put
      // it on a request that carries no tools.
      ...(req.toolChoice && { toolChoice: { tool: { name: req.toolChoice.name } } }),
    };
  }
  const inference: BedrockConverseCommand['inferenceConfig'] = {
    maxTokens: req.maxTokens ?? defaultMaxTokens,
  };
  if (req.temperature !== undefined) inference.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) inference.stopSequences = [...req.stop];
  input.inferenceConfig = inference;
  if (req.cacheMarkers !== undefined) applyCacheMarkers(input, req.cacheMarkers, model, positions);
  return input;
}

function toBedrockMessages(
  messages: readonly LLMMessage[],
  positions: (BedrockMessagePosition | undefined)[],
): BedrockMessage[] {
  const result: BedrockMessage[] = [];
  for (const [messageIndex, m] of messages.entries()) {
    if (m.role === 'system') continue; // system goes in `system` field
    if (m.role === 'user') {
      result.push({ role: 'user', content: [{ text: m.content }] });
      positions[messageIndex] = { message: result.length - 1, content: 0 };
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
      // An assistant turn with no text and no tool calls carries nothing, and
      // Converse refuses a blank text block — drop it, the same rule the
      // Anthropic wire keeps (`anthropicMessagesWire.ts` · `toAnthropicMessages`).
      if (blocks.length === 0) continue;
      result.push({ role: 'assistant', content: blocks });
      positions[messageIndex] = { message: result.length - 1, content: blocks.length - 1 };
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
      positions[messageIndex] = {
        message: result.length - 1,
        content: result[result.length - 1].content.length - 1,
      };
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
      ...readCacheUsage(response.usage),
    },
    stopReason: normalizeStopReason(response.stopReason ?? 'end_turn'),
    providerRef: response.ResponseMetadata?.RequestId,
  });
}

function wrapError(err: unknown, signal?: AbortSignal): Error {
  // A cancelled call fails AS the cancellation, whatever the SDK threw for it
  // — never as a provider error that a retry would re-send (lib/abort.ts).
  if (signal?.aborted) return abortErrorOf(signal);
  // Already ours (the typed tool-use conditions above) — re-wrapping would
  // drop `code` / `toolName` / `toolUseId` and double-prefix the message.
  if (err instanceof Error && err.name === 'BedrockProviderError') return err;
  // A `ValidationException` reading "Input is too long for requested model"
  // is the same failure OpenAI spells `context_length_exceeded`; it leaves
  // here typed, with the fixes, rather than as a generic validation error.
  const tooBig = asContextWindowExceeded(err, { provider: 'bedrock' });
  if (tooBig) return tooBig;
  if (err instanceof Error) {
    // A Retry-After on the raw response (`$response.headers`), declared for
    // withRetry — absent when none, so the error shape is unchanged.
    const retryAfterMs = retryAfterMsFromError(err);
    return Object.assign(new Error(`[bedrock] ${err.message}`), {
      name: 'BedrockProviderError',
      cause: err,
      status:
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ??
        (err as { status?: number }).status,
      ...(retryAfterMs !== undefined && { retryAfterMs }),
    });
  }
  return new Error(`[bedrock] ${String(err)}`);
}
