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
import { asContextWindowExceeded } from './contextWindow.js';
import { azureBaseUrl } from './azureUrl.js';
import { AZURE_AI_SCOPE, AZURE_COGNITIVE_SERVICES_SCOPE } from '../identity/azure.js';
import type { AccessTokenLike, TokenCredentialLike } from '../identity/azure.js';

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
  /** v7.26 — forced choice of one named tool, OpenAI's dialect of
   *  `LLMRequest.toolChoice`. */
  tool_choice?: { type: 'function'; function: { name: string } };
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
  /**
   * API key. Defaults to the `OPENAI_API_KEY` env var.
   *
   * **A FUNCTION here is re-read before every request (9.29.0).** That is what
   * makes this adapter usable in front of an endpoint whose credential is a
   * short-lived OAuth token rather than a key — Vertex AI's OpenAI-compatible
   * endpoint being the case that forced it. An independent field trial ran a
   * real call through that endpoint with a current token, then repeated it
   * with an expired one and got HTTP 401 with nowhere to put a fresh token:
   * *"`OpenAIProviderOptions` accepts a fixed `apiKey` and exposes no
   * credential callback"* (FINDINGS "Part 2B"). A process living longer than
   * an hour had to rebuild the provider, and usually found out it hadn't at
   * 3am.
   *
   * The boundary, stated so nobody has to guess:
   *   • called ONCE PER REQUEST, before the request is built;
   *   • the SDK client is rebuilt only when the returned string CHANGED, so a
   *     cached token costs one function call;
   *   • a stream keeps the key it started with — nothing can re-authenticate
   *     a socket that is already open;
   *   • what expiry means is the callback's business. This adapter does not
   *     inspect, decode or schedule anything; it asks every time and uses what
   *     it is given.
   *
   * ```ts
   * const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
   * const client = await auth.getClient();
   * openai({
   *   baseURL: 'https://…/openapi',
   *   apiKey: async () => (await client.getAccessToken()).token ?? '',
   * });
   * ```
   */
  readonly apiKey?: string | (() => string | Promise<string>);
  /** Base URL — set for OpenAI-compatible APIs (Ollama, Together, vLLM). */
  readonly baseURL?: string;
  /**
   * Declare the endpoint's DIALECT instead of letting `baseURL` imply it (9.74.0).
   *
   * ── What "legacy" means here ─────────────────────────────────────────────
   * An OpenAI-compatible server that predates two of OpenAI's own moves: it
   * accepts only the deprecated `max_tokens` (never `max_completion_tokens`),
   * and it may reject `stream_options` outright. Setting `baseURL` has always
   * implied that dialect, because the compatible servers the option was built
   * for (Ollama/vLLM/Together/Groq) are exactly the ones that break on the
   * modern fields — and a hard failure is worse than a conservative request.
   *
   * That implication is a DEFAULT, not a law. `legacyEndpoint: false` declares
   * "this baseURL speaks the CURRENT dialect": send `max_completion_tokens`,
   * send `stream_options.include_usage` on streams, and declare forced tool
   * choice. The worked example is Azure's v1 inference route
   * (`https://….services.ai.azure.com/api/projects/{project}/openai/v1`) — a
   * custom `baseURL` that IS current OpenAI wire; `foundry()` sets this for
   * you. `legacyEndpoint: true` with no `baseURL` is legal and means what it
   * says, though nothing today needs it.
   *
   * `streamUsage` interplay: a non-legacy endpoint already sends
   * `stream_options`, exactly as before — `streamUsage` remains the opt-in
   * for endpoints that stay legacy, and this flag does not change what either
   * value of it does.
   *
   * Unset, nothing changes anywhere: the default is exactly `!!baseURL`.
   */
  readonly legacyEndpoint?: boolean;
  /**
   * Ask a CUSTOM endpoint for token usage while streaming (9.73.0).
   *
   * ── The silence this breaks ──────────────────────────────────────────────
   * OpenAI and Azure only report usage on a stream when asked, via
   * `stream_options: { include_usage: true }`. This adapter sends that — but
   * NOT when you set `baseURL`, because some OpenAI-compatible servers reject
   * an unknown field outright, and a hard failure is worse than a missing
   * number. The cost of that caution went unnoticed: **every local-model user
   * streaming through `openai({ baseURL })` sees zero tokens**, everywhere
   * usage is read — dashboards, cost recorders, the thinking trace's per-step
   * cost. Nothing is broken and nothing says so.
   *
   * Most current local servers do support it (llama.cpp and Ollama both send a
   * final usage chunk when asked). Set this to `true` and get the numbers
   * back; leave it out and nothing changes.
   *
   * ── When it is ignored ───────────────────────────────────────────────────
   * Ignored whenever the endpoint is treated as MODERN, because there the
   * field is already sent. "Modern" is `legacyEndpoint === false`, which is
   * `!baseURL` by default — so with no `baseURL` and no `legacyEndpoint` this
   * flag still changes nothing, exactly as it did before `legacyEndpoint`
   * existed.
   *
   * But `legacyEndpoint` is now the thing that decides, not `baseURL`:
   * `openai({ legacyEndpoint: true })` with NO `baseURL` is legal and means
   * what it says, and there `stream_options` is withheld and this flag is what
   * turns it back on. So read the pair, not `baseURL` alone.
   */
  readonly streamUsage?: boolean;
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
 * Which roles this wire carries inside `messages`.
 *
 * The OpenAI chat-completions shape takes the system prompt as a message like
 * any other (as `developer` on reasoning models), so all three roles survive
 * — the one place where a `slot: 'messages'` injection with `role: 'system'`
 * genuinely reaches the model.
 */
const CARRIES_IN_MESSAGES: readonly WireRole[] = Object.freeze(['system', 'user', 'assistant']);

/**
 * Build an `LLMProvider` backed by OpenAI's Chat Completions API.
 *
 * @example
 *   import { Agent } from 'agentfootprint';
 *   import { openai } from 'agentfootprint/providers';
 *
 *   const agent = Agent.create({
 *     provider: openai({ defaultModel: 'gpt-4o' }),
 *     model: 'openai',
 *   })
 *     .tool(searchTool)
 *     .build();
 */
export function openai(options: OpenAIProviderOptions = {}): LLMProvider {
  const connect = createClientResolver(options);
  const defaultModel = options.defaultModel ?? 'gpt-4o-mini';
  const defaultMaxTokens = options.defaultMaxTokens;
  // A custom baseURL means an OpenAI-COMPATIBLE endpoint (Ollama/vLLM/Together/Groq),
  // which may only accept the legacy `max_tokens` and may not support `stream_options`.
  // Real OpenAI (no baseURL) and Azure (via injected _client, also no baseURL) get the
  // modern params. Reasoning detection is per-request (model id) OR the explicit flag.
  // Since 9.74.0 the implication is a DEFAULT the consumer can override: an explicit
  // `legacyEndpoint` wins, and `false` is how a modern-dialect baseURL (Azure's v1
  // route, which foundry() rides) gets the current params. Unset keeps `!!baseURL`.
  const legacyEndpoint = options.legacyEndpoint ?? !!options.baseURL;
  const reasoning = options.reasoning ?? false;
  const cfg = {
    defaultModel,
    defaultMaxTokens,
    legacyEndpoint,
    reasoning,
    streamUsage: options.streamUsage === true,
  };

  const provider: LLMProvider = {
    name: 'openai',
    carriesInMessages: CARRIES_IN_MESSAGES,
    // Declared for real OpenAI and Azure, and NOT behind a custom baseURL.
    // What an OpenAI-COMPATIBLE server (Ollama, vLLM, Together, …) does with
    // `tool_choice` is that server's business; promising it here on their
    // behalf would be this library guaranteeing someone else's endpoint. Same
    // signal the file already trusts to pick `max_tokens` vs
    // `max_completion_tokens`.
    carriesForcedToolChoice: !legacyEndpoint,
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const params = buildParams(req, { ...cfg, stream: false });
      // The credential is asked for HERE, per request, so a token that expired
      // since the last call is a new token and not a 401.
      const client = await connect();
      try {
        const response = (await client.chat.completions.create(params)) as OpenAIChatCompletion;
        return fromOpenAIResponse(response);
      } catch (err) {
        throw wrapError(err);
      }
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const params = buildParams(req, { ...cfg, stream: true });
      const client = await connect();
      let stream: AsyncIterable<OpenAIStreamChunk>;
      try {
        // AWAIT, then check. The SDK's `create()` returns an `APIPromise` — a
        // Promise subclass that RESOLVES to the async-iterable stream. Iterating
        // it unawaited died as `stream is not async iterable`, a TypeError that
        // named a local variable and no cause; the first real streamed turn
        // through this adapter is where one production consumer met it. Test
        // doubles hid it for a year by returning an async generator directly
        // from `create()`, which is why the guard accepts BOTH shapes: `await`
        // on a non-thenable is the identity.
        stream = await asChunkStream(client.chat.completions.create(params));
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
          // Usage FIRST, and outside the choice guard. With
          // `stream_options.include_usage` (set in buildParams) OpenAI sends the
          // token counts on a final chunk whose `choices` array is EMPTY — so a
          // `continue` on a missing choice threw away the only usage the stream
          // ever reports. Every consumer of `response.usage` went to zero:
          // `costBudget` silently stopped being enforceable, and any budget
          // counted from adapter-reported tokens (7.16 `.compaction()`) could
          // never trip. Read it before deciding whether the chunk has content.
          if (chunk.id) lastId = chunk.id;
          if (chunk.usage) lastUsage = chunk.usage;
          const choice = chunk.choices[0];
          if (!choice) continue;
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
  readonly carriesInMessages = CARRIES_IN_MESSAGES;
  /** Read off `inner` rather than fixed here: the answer depends on whether a
   *  custom `baseURL` was given, and this class is only the thing its options
   *  made it. */
  readonly carriesForcedToolChoice: boolean;
  private readonly inner: LLMProvider;

  constructor(options: OpenAIProviderOptions = {}) {
    this.inner = openai(options);
    this.carriesForcedToolChoice = this.inner.carriesForcedToolChoice ?? false;
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

// ─── Azure OpenAI ───────────────────────────────────────────────────

export interface AzureOpenAIProviderOptions {
  /**
   * Resource endpoint, e.g. `https://my-co.openai.azure.com`. Env fallbacks:
   * `AZURE_OPENAI_ENDPOINT`, then `OPENAI_BASE_URL` — the two spellings are
   * interchangeable HERE and produce the same URL, whichever one your gateway
   * config already uses. A value that already ends in `/openai` is taken as-is;
   * anything else gets `/openai` appended, which is the path Azure serves
   * deployments under.
   */
  readonly endpoint?: string;
  /** API key. Env fallbacks: `AZURE_OPENAI_API_KEY`, then `OPENAI_API_KEY`. */
  readonly apiKey?: string;
  /**
   * Keyless (Microsoft Entra ID) auth — pass any `@azure/identity` credential
   * (`DefaultAzureCredential`, `ManagedIdentityCredential`, …); the type is
   * duck-typed so this file never imports that SDK. The token is minted (or
   * served from MSAL's cache) on EVERY request by the underlying client, so a
   * long-lived agent process never holds an expired token.
   *
   * Mutually exclusive with `apiKey`: two credentials is a config bug, not
   * extra security, and is refused by name rather than silently ranked.
   */
  readonly credential?: TokenCredentialLike;
  /**
   * Token audience for `credential`. Default
   * {@link AZURE_COGNITIVE_SERVICES_SCOPE}
   * (`https://cognitiveservices.azure.com/.default`) — the audience
   * Microsoft's own keyless guidance names for the CLASSIC deployment-scoped
   * route this door builds
   * (`{endpoint}/openai/deployments/{d}/chat/completions?api-version=…`).
   * Each door defaults to the audience ITS route documents: `foundry()`'s
   * v1/project route is documented against {@link AZURE_AI_SCOPE}
   * (`https://ai.azure.com/.default`), and current resources widely accept
   * both — but an older `*.openai.azure.com` resource may only accept this
   * one, and a default that 401s on the oldest resources it exists to serve
   * would be the wrong default. The ARM control plane
   * (`https://management.azure.com/.default`) is a THIRD audience whose
   * tokens never work here. Azure Government spells this audience
   * `https://cognitiveservices.azure.us/.default`. Ignored without
   * `credential`.
   */
  readonly scope?: string;
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
 * `endpoint` is the resource ROOT (`https://my-co.openai.azure.com`), and
 * `AZURE_OPENAI_ENDPOINT` and `OPENAI_BASE_URL` are two names for it that
 * resolve to the identical final URL. Setting `OPENAI_BASE_URL` no longer
 * collides with the SDK's own reading of that variable — this factory hands the
 * SDK a `baseURL` it computed rather than an `endpoint` the SDK would have to
 * reconcile with the environment.
 *
 * @example
 *   import { azureOpenai } from 'agentfootprint/providers';
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
    // The wire is `inner`'s, so the capability is `inner`'s. Re-stating it
    // rather than inheriting by accident: this factory builds a fresh object,
    // and a dropped capability silently becomes the user/assistant floor.
    carriesInMessages: CARRIES_IN_MESSAGES,
    ...(inner.carriesForcedToolChoice !== undefined && {
      carriesForcedToolChoice: inner.carriesForcedToolChoice,
    }),
    // `hooks` is FORWARDED, not dropped — see LLMCallHooks in adapters/types.ts.
    complete: (req, hooks) => inner.complete(withDeployment(req), hooks),
    ...(inner.stream && {
      stream: (req: LLMRequest, hooks?: LLMCallHooks) => inner.stream!(withDeployment(req), hooks),
    }),
  };
}

/**
 * Build the SDK's `AzureOpenAI` client — always via `baseURL`, never `endpoint`.
 *
 * The SDK's constructor defaults `baseURL` to `process.env.OPENAI_BASE_URL`
 * and then refuses a `baseURL` and an `endpoint` together
 * ("baseURL and endpoint are mutually exclusive"). We document
 * `OPENAI_BASE_URL` as an alias for the Azure endpoint, so the path our own
 * docs advertise handed the SDK the value twice — once explicitly as
 * `endpoint`, once invisibly out of the environment — and could not boot.
 * One production consumer met that on their first server-side Azure run with
 * the same gateway and key their browser app had used for months.
 *
 * Passing `baseURL` ourselves settles it for good: the ambient read is
 * overridden rather than fought with, `endpoint` is never passed so the
 * collision cannot occur, and both spellings survive. The `/openai` suffix the
 * SDK would have appended is appended by `azureBaseUrl`, so the final URL is
 * byte-identical either way — pinned by test/adapters/integration/azure-openai-wire.test.ts.
 */
function resolveAzureClient(options: AzureOpenAIProviderOptions): OpenAIClient {
  // Two credentials is not "extra secure" — whichever one this factory
  // silently preferred would be the one the consumer did not think was in
  // use. Refused by NAME, and checked BEFORE the `_client` short-circuit so a
  // test can pin the wording without the SDK installed.
  if (options.credential && options.apiKey) {
    throw new Error(
      'azureOpenai: both `credential` and `apiKey` were given, and they are two answers to the ' +
        'same question — which identity signs the request.\n' +
        '  Fix:  pass exactly one — `credential` (keyless Entra ID) or `apiKey` (static key).',
    );
  }
  if (options._client) return options._client;
  let AzureOpenAI: new (opts: AzureClientCtorOptions) => OpenAIClient;
  try {
    const mod = lazyRequire<{ AzureOpenAI?: unknown; default?: { AzureOpenAI?: unknown } }>(
      'openai',
    );
    AzureOpenAI = (mod.AzureOpenAI ?? mod.default?.AzureOpenAI) as new (
      opts: AzureClientCtorOptions,
    ) => OpenAIClient;
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
  if (options.credential) {
    const credential = options.credential;
    const scope = options.scope ?? AZURE_COGNITIVE_SERVICES_SCOPE;
    return new AzureOpenAI({
      // NOT `endpoint` — see the note on this function.
      baseURL: azureBaseUrl(endpoint),
      // The SDK insists on exactly ONE of `apiKey` / `azureADTokenProvider` —
      // so no key is sent. `apiKey: ''` is deliberate, not decorative: the
      // SDK's constructor defaults a MISSING `apiKey` from AZURE_OPENAI_API_KEY,
      // and an ambient env key beside the token provider trips its "mutually
      // exclusive" refusal. An explicit `credential` must beat the environment
      // (the same stance this function already takes on `OPENAI_BASE_URL`),
      // and an empty string is falsy to every SDK check while blocking the
      // env read.
      apiKey: '',
      azureADTokenProvider: async () => entraBearerToken('azureOpenai', credential, scope),
      apiVersion,
      ...(deployment && { deployment }),
    });
  }
  return new AzureOpenAI({
    // NOT `endpoint` — see the note on this function. `baseURL` is passed
    // explicitly so the SDK's own `OPENAI_BASE_URL` default is overridden
    // instead of colliding with an `endpoint` we also passed.
    baseURL: azureBaseUrl(endpoint),
    ...(apiKey && { apiKey }),
    apiVersion,
    ...(deployment && { deployment }),
  });
}

/** The slice of the SDK's `AzureOpenAI` constructor this file calls. */
interface AzureClientCtorOptions {
  baseURL: string;
  apiKey?: string;
  /** Per-request Entra token source — the SDK's keyless door. The SDK calls
   *  it before every request and sends the answer as `Authorization: Bearer`. */
  azureADTokenProvider?: () => Promise<string>;
  apiVersion: string;
  deployment?: string;
}

/**
 * `TokenCredentialLike.getToken(scope)` → the bearer string an OpenAI-shaped
 * client can send — shared by the two Entra doors (`azureOpenai()` here and
 * `foundry()` in FoundryProvider.ts, which imports it; the dependency points
 * THIS way because FoundryProvider already composes over `openai()`).
 *
 * What it enforces are the credential-surface laws, not conveniences:
 *   • an ABSENT answer — `null`, the SDK's spelling of "no token available",
 *     and `undefined`, which is what a hand-rolled or caching credential
 *     hands back on a miss — is refused by NAME. Both are the same absence
 *     and get the same refusal: passed onward, `null` becomes a bare 401 that
 *     names nothing, and `undefined` becomes a raw `TypeError` thrown from
 *     inside this library, which names less than the 401 does.
 *   • an empty or blank `token` FIELD is refused by field name; the value
 *     itself is a secret when it is right, so no message ever quotes it.
 *   • a throwing credential is reported as operation + error NAME only (auth
 *     SDKs echo request detail into 401/403 text), with no `cause` — a cause
 *     travels into every serializer that walks own properties.
 * The scope IS quoted: it is a public audience URI, never a secret, and it is
 * the thing the consumer most likely got wrong.
 */
export async function entraBearerToken(
  adapter: string,
  credential: TokenCredentialLike,
  scope: string,
): Promise<string> {
  // `| undefined` is deliberate and is NOT in the duck type: `getToken` is
  // declared `Promise<AccessTokenLike | null>`, but this door is documented as
  // duck-typed on both public factories, so it is reachable from plain JS AND
  // from a strict-clean TypeScript wrapper — a token cache spelled
  // `async (s) => cache.get(String(s))!` type-checks with zero errors and
  // resolves to `undefined` on a miss. Widening the local (never the port)
  // is what lets that case be refused by name instead of dereferenced.
  let access: AccessTokenLike | null | undefined;
  try {
    access = await credential.getToken(scope);
  } catch (err) {
    const name = err instanceof Error && err.name ? err.name : typeof err;
    throw new Error(
      `${adapter}: credential.getToken failed (${name}) for scope ${scope}.\n` +
        '  Fix:  sign in (az login), or pass a `credential` whose identity can mint tokens for ' +
        'this audience — the audience is the `scope` option (classic Azure OpenAI documents ' +
        'https://cognitiveservices.azure.com/.default; the Foundry v1 route documents ' +
        'https://ai.azure.com/.default).',
    );
  }
  // `== null` on purpose: null AND undefined, one refusal. The shape is named
  // in the message (it is a wiring fact, not a secret) so the reader knows
  // whether they are looking at a chain that found no identity or at their own
  // cache handing back a miss.
  if (access == null) {
    // The two absences read the same to a `TypeError` and completely
    // differently to a person, so the SHAPE is named (a wiring fact, never a
    // secret) and each gets its own diagnosis under one shared fix.
    throw new Error(
      `${adapter}: the credential returned no access token for scope ${scope} — ` +
        (access === null
          ? '`getToken` resolved to `null`, the SDK\'s spelling of "no token available": the ' +
            'chain found no identity that can serve this audience.'
          : '`getToken` resolved to `undefined`, which no `@azure/identity` credential does — a ' +
            'hand-rolled or caching credential handed back a miss (an empty cache lookup, a ' +
            'non-null assertion over a `Map`) instead of minting or reporting no token.') +
        '\n  Fix:  sign in (az login), or pass a `credential` that holds an identity for this ' +
        'audience (DefaultAzureCredential walks env service principal → workload identity → ' +
        'managed identity → az login). A `credential` of your own must always RESOLVE to a token ' +
        'object or to `null`.',
    );
  }
  if (typeof access.token !== 'string' || access.token.trim().length === 0) {
    // Field NAME only — the value is a secret when it is right, and an empty
    // one is described, never quoted.
    throw new Error(
      `${adapter}: the credential returned an access token whose \`token\` field is empty.\n` +
        '  Fix:  check the credential wiring — a real Entra token is never an empty string.',
    );
  }
  return access.token;
}

// ─── Ollama ─────────────────────────────────────────────────────────
//
// `ollama()` used to live here as a thin wrapper over `openai({ baseURL })`.
// It moved to its own native adapter in 8.1.0 (`./OllamaProvider.ts`) so the
// free rung of the ladder stops needing the `openai` package, stops labelling
// its failures `[openai]`, and starts reporting real token counts.
//
// The OpenAI-compatible endpoint still works and is still supported — it is
// now something you ask for explicitly:
//
//   openai({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' })

// ─── Internals ──────────────────────────────────────────────────────

/**
 * The client seam — one answer per request.
 *
 * Three paths, and only the third is new (the same three the Google adapters
 * take, deliberately: two doors that solved the same problem differently would
 * be two doors to learn):
 *
 *  1. `_client` injected → the double, always (the credential callback still
 *     runs, because the double replaces the client and not the credential).
 *  2. `apiKey` a string or absent → built ONCE, at factory time, so a missing
 *     `openai` package is still refused where the consumer typed `openai(...)`.
 *  3. `apiKey` a callback → called before every request; the SDK client is
 *     rebuilt only when the answer changed. Not eager: calling a consumer's
 *     credential provider from a factory fetches a token nobody asked for yet.
 */
function createClientResolver(
  options: OpenAIProviderOptions,
): () => OpenAIClient | Promise<OpenAIClient> {
  const source = options.apiKey;
  if (options._client) {
    const injected = options._client;
    // A double stands in for the SDK client, not for the credential: a
    // callback is still called per request, so the rotation is observable in a
    // test that never opens a socket.
    if (typeof source !== 'function') return () => injected;
    return async () => {
      await requireKey(source);
      return injected;
    };
  }
  if (typeof source !== 'function') {
    const built = resolveClient(options);
    return () => built;
  }
  let lastKey: string | undefined;
  let built: OpenAIClient | undefined;
  return async () => {
    const answer = await requireKey(source);
    if (built === undefined || answer !== lastKey) {
      built = resolveClient({ ...options, apiKey: answer });
      lastKey = answer;
    }
    return built;
  };
}

/** Call the credential callback and insist on something usable. */
async function requireKey(source: () => string | Promise<string>): Promise<string> {
  const answer = await source();
  if (typeof answer === 'string' && answer.trim().length > 0) return answer;
  // The value is never quoted back: it is a credential when it is right.
  throw new Error(
    'openai: the `apiKey` callback returned ' +
      (typeof answer === 'string' ? 'an empty string' : `a ${typeof answer}`) +
      ', and a key has to be a non-empty string.\n' +
      '  The callback runs before every request, so this is a live credential failure — a ' +
      'token fetch that failed usually throws rather than returning nothing.\n' +
      '  Fix:  return the token, or throw from the callback so openai() can report why.',
  );
}

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
  // A callback has already been resolved to a string by `createClientResolver`
  // before it reaches here; the guard is what keeps a function from being
  // stringified into an `Authorization` header by a future call site.
  const apiKey =
    (typeof options.apiKey === 'string' ? options.apiKey : undefined) ?? process.env.OPENAI_API_KEY;
  return new OpenAI({ apiKey, ...(options.baseURL && { baseURL: options.baseURL }) });
}

/**
 * Whatever `create({ stream: true })` handed back → the token stream.
 *
 * Two shapes reach here and both are legitimate:
 *   • the real SDK returns an `APIPromise<Stream<…>>` — a Promise that RESOLVES
 *     to the async iterable, so it has to be awaited before it can be iterated;
 *   • an injected `_client` double (and some OpenAI-compatible wrappers) return
 *     the async iterable directly. `await` on a non-thenable is the identity,
 *     so one line covers both.
 *
 * Anything else is refused HERE, by name. The raw failure was
 * `TypeError: stream is not async iterable` — a message that quotes a local
 * variable, names no endpoint and suggests no fix.
 */
async function asChunkStream(
  created: Promise<OpenAIChatCompletion> | AsyncIterable<OpenAIStreamChunk>,
): Promise<AsyncIterable<OpenAIStreamChunk>> {
  const resolved: unknown = await created;
  if (typeof resolved === 'object' && resolved !== null && Symbol.asyncIterator in resolved) {
    return resolved as AsyncIterable<OpenAIStreamChunk>;
  }
  // A completed chat completion means the endpoint ignored `stream: true` —
  // the commonest way an OpenAI-COMPATIBLE server differs from OpenAI. Said
  // plainly, because the fix is different from "the SDK is old".
  const looksComplete = typeof resolved === 'object' && resolved !== null && 'choices' in resolved;
  throw new Error(
    'a streaming request came back as ' +
      (looksComplete
        ? 'a finished chat completion, so the endpoint ignored `stream: true`'
        : `a ${resolved === null ? 'null' : typeof resolved}, which is not a token stream`) +
      '.\n' +
      (looksComplete
        ? '  Fix:  point this provider at an endpoint that streams, or drop stream() from it ' +
          '(an Agent falls back to complete() when a provider has no stream()).'
        : '  Fix:  `chat.completions.create({ stream: true })` must resolve to an async iterable. ' +
          'A custom `_client` double has to return one (or a promise of one); the real `openai` ' +
          'package has since 4.x.'),
  );
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
  /** Consumer opted a custom endpoint back into `stream_options.include_usage`. */
  readonly streamUsage: boolean;
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
    // synthesized response reports 0 tokens. A custom endpoint is left out by
    // default because some reject the field — and opts back in with
    // `streamUsage`, which is how a local-model deployment stops reading zero.
    if (!cfg.legacyEndpoint || cfg.streamUsage) {
      params.stream_options = { include_usage: true };
    }
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
  // v7.26 — forced choice of one named tool. Guarded on tools being present
  // for the same reason the Anthropic adapter guards: a tool choice naming a
  // tool the request does not carry is a request that cannot be served.
  if (req.toolChoice && params.tools !== undefined && params.tools.length > 0) {
    params.tool_choice = { type: 'function', function: { name: req.toolChoice.name } };
  }
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
  // "Your request was too big" is a distinct failure with distinct fixes, so
  // it leaves this adapter as a typed error rather than as one more opaque
  // 400 that a retry loop will re-send forever. Nothing else is translated.
  const tooBig = asContextWindowExceeded(err, { provider: 'openai' });
  if (tooBig) return tooBig;
  if (err instanceof Error) {
    return Object.assign(new Error(`[openai] ${err.message}`), {
      name: 'OpenAIProviderError',
      cause: err,
      status: (err as { status?: number }).status,
    });
  }
  return new Error(`[openai] ${String(err)}`);
}
