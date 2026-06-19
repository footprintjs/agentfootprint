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
import { lazyRequire } from '../../lib/lazyRequire.js';

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
  /** Legacy token cap — DEPRECATED by OpenAI and REJECTED by o-series reasoning
   *  models. Kept only for custom OpenAI-compatible endpoints (Ollama/vLLM/…). */
  max_tokens?: number;
  /** Current token cap — accepted by all OpenAI/Azure chat models incl. o-series. */
  max_completion_tokens?: number;
  temperature?: number;
  stop?: string[];
  stream?: boolean;
  /** Ask OpenAI/Azure to emit a final usage chunk while streaming. */
  stream_options?: { include_usage: boolean };
}

interface OpenAIMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
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
  /**
   * Treat the target as a **reasoning model** (o-series: o1 / o3 / o4-mini, or an
   * Azure reasoning deployment). Reasoning models reject `max_tokens` and an explicit
   * `temperature`, and use the `developer` role in place of `system`. Standard o-series
   * model ids are auto-detected; set this explicitly for Azure deployments whose name
   * does not reveal the underlying model.
   */
  readonly reasoning?: boolean;
  /** @internal Pre-built client for testing. Skips SDK import. */
  readonly _client?: OpenAIClient;
}

/**
 * Build an `LLMProvider` backed by OpenAI's Chat Completions API.
 *
 * @example
 *   import { Agent } from 'agentfootprint';
 *   import { openai } from 'agentfootprint/llm-providers';
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
  // A custom baseURL means an OpenAI-COMPATIBLE endpoint (Ollama/vLLM/Together/Groq),
  // which may only accept the legacy `max_tokens` and may not support `stream_options`.
  // Real OpenAI (no baseURL) and Azure (via injected _client, also no baseURL) get the
  // modern params. Reasoning detection is per-request (model id) OR the explicit flag.
  const legacyEndpoint = !!options.baseURL;
  const reasoning = options.reasoning ?? false;
  const cfg = { defaultModel, defaultMaxTokens, legacyEndpoint, reasoning };

  const provider: LLMProvider = {
    name: 'openai',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const params = buildParams(req, { ...cfg, stream: false });
      try {
        const response = (await client.chat.completions.create(params)) as OpenAIChatCompletion;
        return fromOpenAIResponse(response);
      } catch (err) {
        throw wrapError(err);
      }
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const params = buildParams(req, { ...cfg, stream: true });
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

// ─── Azure OpenAI ───────────────────────────────────────────────────

export interface AzureOpenAIProviderOptions {
  /** Resource endpoint, e.g. `https://my-co.openai.azure.com`. Env fallbacks:
   *  `AZURE_OPENAI_ENDPOINT`, then `OPENAI_BASE_URL`. */
  readonly endpoint?: string;
  /** API key. Env fallbacks: `AZURE_OPENAI_API_KEY`, then `OPENAI_API_KEY`. */
  readonly apiKey?: string;
  /** Azure API version, e.g. `2024-12-01-preview`. Env fallback:
   *  `AZURE_OPENAI_API_VERSION`. Required. */
  readonly apiVersion?: string;
  /** The DEPLOYMENT name (Azure's "model"), e.g. `gpt-4o-128k`. Env fallbacks:
   *  `AZURE_OPENAI_DEPLOYMENT`, then `MODEL_NAME`. Required. */
  readonly deployment?: string;
  /** Default max tokens when the request doesn't set it. Optional. */
  readonly defaultMaxTokens?: number;
  /**
   * Set when the Azure DEPLOYMENT is a **reasoning model** (o1/o3/o4-mini). Azure
   * deployment names are arbitrary, so this cannot be auto-detected — declare it to
   * omit `temperature` and send the `developer` role. (`max_completion_tokens` is used
   * for all Azure deployments regardless.)
   */
  readonly reasoning?: boolean;
  /** @internal Pre-built client for testing. Skips SDK import. */
  readonly _client?: OpenAIClient;
}

/** Shorthand model ids that resolve to the configured deployment. */
const AZURE_MODEL_SHORTHANDS = new Set(['azure', 'azure-openai', 'openai']);

/**
 * Build an `LLMProvider` for **Azure OpenAI**.
 *
 * Azure is NOT a drop-in OpenAI-compatible URL — it uses a deployment-scoped
 * path, `api-key` header auth, and an `api-version` query param. This wraps the
 * `openai` SDK's `AzureOpenAI` client (which handles all that) and reuses the
 * exact same completion/streaming/tool-call logic as `openai()`.
 *
 * The request's `model` is the Azure **deployment** name. Pass a deployment id
 * to target it; the shorthands `'azure'` / `'azure-openai'` resolve to the
 * configured default `deployment`.
 *
 * @example
 *   import { azureOpenai } from 'agentfootprint/llm-providers';
 *
 *   const agent = Agent.create({
 *     provider: azureOpenai({
 *       endpoint: process.env.OPENAI_BASE_URL,            // *.openai.azure.com
 *       apiKey: process.env.AZURE_OPENAI_API_KEY,
 *       apiVersion: process.env.AZURE_OPENAI_API_VERSION, // 2024-12-01-preview
 *       deployment: process.env.MODEL_NAME,               // gpt-4o-128k
 *     }),
 *     model: 'azure',
 *   }).build();
 */
export function azureOpenai(options: AzureOpenAIProviderOptions = {}): LLMProvider {
  const client = resolveAzureClient(options);
  const deployment =
    options.deployment ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? process.env.MODEL_NAME;
  if (!deployment) {
    throw new Error(
      'azureOpenai: a `deployment` is required (or set AZURE_OPENAI_DEPLOYMENT / MODEL_NAME).',
    );
  }
  // Reuse ALL of openai()'s logic via the injected client; defaultModel is the
  // deployment so shorthand model ids resolve to it.
  const inner = openai({
    _client: client,
    defaultModel: deployment,
    ...(options.reasoning !== undefined && { reasoning: options.reasoning }),
    ...(options.defaultMaxTokens !== undefined && { defaultMaxTokens: options.defaultMaxTokens }),
  });
  // Azure's "model" IS the deployment — rewrite shorthand ids to it; a concrete
  // deployment id passes through (so you can target multiple deployments).
  const withDeployment = (req: LLMRequest): LLMRequest =>
    AZURE_MODEL_SHORTHANDS.has(req.model) ? { ...req, model: deployment } : req;

  return {
    name: 'azure-openai',
    complete: (req) => inner.complete(withDeployment(req)),
    ...(inner.stream && {
      stream: (req: LLMRequest) => inner.stream!(withDeployment(req)),
    }),
  };
}

function resolveAzureClient(options: AzureOpenAIProviderOptions): OpenAIClient {
  if (options._client) return options._client;
  let AzureOpenAI: new (opts: {
    endpoint: string;
    apiKey?: string;
    apiVersion: string;
    deployment?: string;
  }) => OpenAIClient;
  try {
    const mod = lazyRequire<{ AzureOpenAI?: unknown; default?: { AzureOpenAI?: unknown } }>(
      'openai',
    );
    AzureOpenAI = (mod.AzureOpenAI ?? mod.default?.AzureOpenAI) as new (opts: {
      endpoint: string;
      apiKey?: string;
      apiVersion: string;
      deployment?: string;
    }) => OpenAIClient;
  } catch {
    throw new Error(
      'azureOpenai requires the `openai` package.\n' +
        '  Install:  npm install openai\n' +
        '  Or pass `_client` for test injection.',
    );
  }
  if (!AzureOpenAI) {
    throw new Error('azureOpenai needs `openai` >= 4.x (no `AzureOpenAI` export found).');
  }
  const endpoint =
    options.endpoint ?? process.env.AZURE_OPENAI_ENDPOINT ?? process.env.OPENAI_BASE_URL;
  const apiKey = options.apiKey ?? process.env.AZURE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  const apiVersion = options.apiVersion ?? process.env.AZURE_OPENAI_API_VERSION;
  const deployment =
    options.deployment ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? process.env.MODEL_NAME;
  if (!endpoint) {
    throw new Error(
      'azureOpenai: `endpoint` is required (or set AZURE_OPENAI_ENDPOINT / OPENAI_BASE_URL), ' +
        'e.g. https://my-co.openai.azure.com',
    );
  }
  if (!apiVersion) {
    throw new Error(
      'azureOpenai: `apiVersion` is required (or set AZURE_OPENAI_API_VERSION), e.g. 2024-12-01-preview.',
    );
  }
  return new AzureOpenAI({
    endpoint,
    ...(apiKey && { apiKey }),
    apiVersion,
    ...(deployment && { deployment }),
  });
}

/**
 * Convenience factory for Ollama (OpenAI-compatible endpoint).
 *
 * @example
 *   import { ollama } from 'agentfootprint/llm-providers';
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
    const mod = lazyRequire<{ default?: unknown; OpenAI?: unknown } | unknown>('openai') as {
      default?: unknown;
      OpenAI?: unknown;
    };
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

/** o-series reasoning ids (o1, o1-mini, o3, o3-mini, o4-mini, o5, …). `gpt-4o`
 *  starts with `g`, so it is correctly NOT matched. */
function isReasoningModel(model: string): boolean {
  return /^o\d/i.test(model);
}

interface BuildConfig {
  readonly defaultModel: string;
  readonly defaultMaxTokens: number | undefined;
  readonly stream: boolean;
  /** Custom OpenAI-compatible endpoint → keep legacy `max_tokens`, no `stream_options`. */
  readonly legacyEndpoint: boolean;
  /** Consumer-declared reasoning model (combined with model-id auto-detection). */
  readonly reasoning: boolean;
}

function buildParams(req: LLMRequest, cfg: BuildConfig): OpenAICreateParams {
  const model = req.model === 'openai' || req.model === 'ollama' ? cfg.defaultModel : req.model;
  const reasoning = cfg.reasoning || isReasoningModel(model);
  const params: OpenAICreateParams = {
    model,
    messages: toOpenAIMessages(req.messages, req.systemPrompt, reasoning),
  };
  if (cfg.stream) {
    params.stream = true;
    // OpenAI/Azure only emit usage while streaming when asked; without this the
    // synthesized response reports 0 tokens. Compatible endpoints may not support it.
    if (!cfg.legacyEndpoint) params.stream_options = { include_usage: true };
  }
  if (req.tools && req.tools.length > 0) params.tools = req.tools.map(toOpenAITool);
  const maxTokens = req.maxTokens ?? cfg.defaultMaxTokens;
  if (maxTokens !== undefined) {
    // `max_tokens` is deprecated and REJECTED by o-series; `max_completion_tokens` is
    // the current param (accepted by all OpenAI/Azure chat models). Custom compatible
    // endpoints may only accept `max_tokens`, so keep it there.
    if (cfg.legacyEndpoint) params.max_tokens = maxTokens;
    else params.max_completion_tokens = maxTokens;
  }
  // Reasoning models reject an explicit `temperature` (only the default is allowed).
  if (req.temperature !== undefined && !reasoning) params.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) params.stop = [...req.stop];
  return params;
}

/**
 * messages → OpenAI messages.
 *
 * Roles map 1:1: system/user/assistant/tool. For reasoning models the system role
 * becomes `developer` (its replacement). Assistant turns with `toolCalls` get those
 * serialized into `message.tool_calls` (args JSON-stringified per OpenAI's contract).
 * Tool messages map to `role: 'tool'` with `tool_call_id`.
 */
function toOpenAIMessages(
  messages: readonly LLMMessage[],
  systemPrompt: string | undefined,
  reasoning: boolean,
): OpenAIMessage[] {
  const systemRole: 'system' | 'developer' = reasoning ? 'developer' : 'system';
  const result: OpenAIMessage[] = [];
  // OpenAI accepts the system/developer role IN the messages array (unlike Anthropic's
  // separate `system` field). Prepend systemPrompt as the first such message; subsequent
  // in-message system entries pass through.
  if (systemPrompt) {
    result.push({ role: systemRole, content: systemPrompt });
  }
  for (const m of messages) {
    if (m.role === 'system') {
      result.push({ role: systemRole, content: m.content });
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
