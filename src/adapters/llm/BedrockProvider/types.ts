/** Duck-typed SDK shapes and public construction options; no SDK import. */
import type { BedrockCachePoint, BedrockCacheUsage } from '../bedrockCacheWire.js';
import type { BedrockGuardrailOptions, guardrailWire } from './guardrailConfig.js';

export interface BedrockClient {
  send(command: unknown, options?: BedrockSendOptions): Promise<unknown>;
}

/** AWS SDK v3's per-call HTTP options — the one this adapter sends is the
 *  abort signal, so an aborted run cancels the request itself (`lib/abort.ts`). */
export interface BedrockSendOptions {
  abortSignal?: AbortSignal;
}

export interface BedrockConverseCommand {
  modelId: string;
  messages: BedrockMessage[];
  guardrailConfig?: ReturnType<typeof guardrailWire>;
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

export interface BedrockMessage {
  role: 'user' | 'assistant';
  content: BedrockContentBlock[];
}

export type BedrockContentBlock =
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

export interface BedrockTool {
  toolSpec: {
    name: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
}

export interface BedrockConverseResponse {
  trace?: unknown;
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
  metadata?: { usage?: BedrockCacheUsage; trace?: unknown };
  /** Documented service-exception union members; payloads stay in the private error cause. */
  modelStreamErrorException?: unknown;
  internalServerException?: unknown;
  serviceUnavailableException?: unknown;
  throttlingException?: unknown;
  validationException?: unknown;
  // Many other event shapes exist; we ignore the ones not needed here.
}

export interface BedrockStreamResponse {
  stream?: AsyncIterable<BedrockStreamEvent>;
}

export interface BedrockProviderOptions {
  /** Exact application inference profile ID or ARN to its verified foundation
   * model or system inference profile identity, for Converse prompt caching.
   * Use the model or system profile AWS lists behind each application profile.
   * The submitted route stays the model ID. No lookup or chain is performed.
   */
  readonly inferenceProfileModels?: Readonly<Record<string, string>>;
  /** Explicit guardrail declaration for both Converse operations. Raw trace is never exposed. */
  readonly guardrail?: BedrockGuardrailOptions;
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
   * use resolves the optional AWS SDK through `client.ts · resolveClient`.
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
