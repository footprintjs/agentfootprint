/**
 * BrowserOpenAIProvider — fetch-based OpenAI adapter for browsers.
 *
 * Pattern: Adapter (GoF). Zero peer dependencies — uses global `fetch`.
 * Role:    Outer ring. Same `LLMProvider` contract as `OpenAIProvider`
 *          but skips the `openai` SDK. For prototypes / playgrounds.
 *          Production apps should proxy through a backend.
 * Emits:   N/A.
 *
 * Also works with OpenAI-compatible endpoints (Ollama, Together, vLLM)
 * via `apiUrl`.
 *
 * ─── Limitations ────────────────────────────────────────────────────
 *
 * • Multi-modal NOT supported.
 * • CORS depends on the endpoint — OpenAI requires the user-supplied
 *   key in the Authorization header, which they'll do explicitly.
 */

import type {
  LLMChunk,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
} from '../types.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// ─── Types (OpenAI Chat Completions shapes) ────────────────────────

interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  /** Legacy token cap — deprecated; rejected by o-series. Kept for compatible endpoints. */
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
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
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
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface OpenAIStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
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
  usage?: { prompt_tokens: number; completion_tokens: number };
}

// ─── Adapter ────────────────────────────────────────────────────────

export interface BrowserOpenAIProviderOptions {
  /** API key. REQUIRED. */
  readonly apiKey: string;
  /** Default model when `LLMRequest.model` is `'openai'`. */
  readonly defaultModel?: string;
  /** Default max tokens. */
  readonly defaultMaxTokens?: number;
  /** Override the API URL (Ollama, Together, vLLM, OpenAI proxies). */
  readonly apiUrl?: string;
  /** Optional `Organization` header. */
  readonly organization?: string;
  /** Auth header scheme. `'bearer'` (default) → `Authorization: Bearer <key>`;
   *  `'api-key'` → the `api-key` header (Azure OpenAI). */
  readonly authScheme?: 'bearer' | 'api-key';
  /** Treat the target as a **reasoning model** (o-series): omit `temperature` and send
   *  the `developer` role. Standard o-series ids are auto-detected; set for arbitrary
   *  Azure deployment names. */
  readonly reasoning?: boolean;
  /** @internal Custom fetch implementation for tests. */
  readonly _fetch?: typeof fetch;
}

export function browserOpenai(options: BrowserOpenAIProviderOptions): LLMProvider {
  if (!options.apiKey) {
    throw new Error(
      'BrowserOpenAIProvider requires `apiKey`. Browser providers do not read environment variables.',
    );
  }
  const apiUrl = options.apiUrl ?? OPENAI_API_URL;
  const defaultModel = options.defaultModel ?? 'gpt-4o-mini';
  const defaultMaxTokens = options.defaultMaxTokens;
  const fetchImpl = options._fetch ?? fetch;
  // OpenAI (default URL) and Azure (`api-key` auth) get the modern params; a custom
  // bearer endpoint (Ollama/vLLM/…) keeps legacy `max_tokens` and no `stream_options`.
  const legacyEndpoint = apiUrl !== OPENAI_API_URL && options.authScheme !== 'api-key';
  const reasoningOpt = options.reasoning ?? false;
  const cfg = { defaultModel, defaultMaxTokens, legacyEndpoint, reasoning: reasoningOpt };

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.authScheme === 'api-key') {
    headers['api-key'] = options.apiKey; // Azure OpenAI
  } else {
    headers['authorization'] = `Bearer ${options.apiKey}`;
  }
  if (options.organization) headers['openai-organization'] = options.organization;

  const provider: LLMProvider = {
    name: 'browser-openai',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const body: OpenAIRequestBody = buildBody(req, { ...cfg, stream: false });
      let response: Response;
      try {
        response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          ...(req.signal && { signal: req.signal }),
        });
      } catch (err) {
        throw wrapError(err);
      }
      if (!response.ok) throw await wrapStatus(response);
      const json = (await response.json()) as OpenAIChatCompletion;
      return fromOpenAIResponse(json);
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const body: OpenAIRequestBody = buildBody(req, { ...cfg, stream: true });
      let response: Response;
      try {
        response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          ...(req.signal && { signal: req.signal }),
        });
      } catch (err) {
        throw wrapError(err);
      }
      if (!response.ok) throw await wrapStatus(response);
      if (!response.body) throw new Error('[browser-openai] response has no body');

      const textParts: string[] = [];
      const toolCallsByIndex = new Map<number, { id: string; name: string; argsJson: string }>();
      let lastFinishReason = 'stop';
      let lastUsage: { prompt_tokens: number; completion_tokens: number } | undefined;
      let lastId = '';
      let tokenIndex = 0;

      for await (const data of parseSSE(response.body)) {
        if (data === '[DONE]') break;
        const chunk = data as OpenAIStreamChunk;
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
      const finalResponse: LLMResponse = {
        content: textParts.join(''),
        toolCalls,
        usage: {
          input: lastUsage?.prompt_tokens ?? 0,
          output: lastUsage?.completion_tokens ?? 0,
        },
        stopReason: normalizeStopReason(lastFinishReason),
        providerRef: lastId,
      };
      yield { tokenIndex, content: '', done: true, response: finalResponse };
    },
  };

  return provider;
}

export class BrowserOpenAIProvider implements LLMProvider {
  readonly name = 'browser-openai';
  private readonly inner: LLMProvider;

  constructor(options: BrowserOpenAIProviderOptions) {
    this.inner = browserOpenai(options);
  }

  complete(req: LLMRequest): Promise<LLMResponse> {
    return this.inner.complete(req);
  }

  stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    if (!this.inner.stream) throw new Error('stream() unavailable');
    return this.inner.stream(req);
  }
}

// ─── Browser Azure OpenAI ───────────────────────────────────────────

export interface BrowserAzureOpenAIProviderOptions {
  /** Resource endpoint, e.g. `https://my-co.openai.azure.com` (or a same-origin
   *  proxy path like `/azure` to sidestep CORS in dev). REQUIRED. */
  readonly endpoint: string;
  /** API key (Azure `api-key`). REQUIRED. */
  readonly apiKey: string;
  /** Azure API version, e.g. `2024-12-01-preview`. REQUIRED. */
  readonly apiVersion: string;
  /** The DEPLOYMENT name (Azure's "model"), e.g. `gpt-4o-128k`. REQUIRED. */
  readonly deployment: string;
  /** Default max tokens. */
  readonly defaultMaxTokens?: number;
  /** Set when the Azure deployment is a **reasoning model** (o1/o3/o4-mini) — omits
   *  `temperature` and sends the `developer` role. */
  readonly reasoning?: boolean;
  /** @internal Custom fetch implementation for tests. */
  readonly _fetch?: typeof fetch;
}

const AZURE_BROWSER_SHORTHANDS = new Set([
  'azure',
  'browser-azure-openai',
  'azure-openai',
  'openai',
]);

/**
 * Fetch-based **Azure OpenAI** provider for the browser/edge — no SDK, no Node.
 *
 * The browser can't use the Node `azureOpenai()` (it needs the `openai` SDK), so
 * use this in a browser "bring your own (company) key" flow. Builds the
 * deployment-scoped Azure URL + `api-key` header + `api-version`, and reuses all
 * of `browserOpenai()`'s body/streaming/tool logic. The request `model` is the
 * deployment; `'azure'` resolves to the configured `deployment`.
 *
 * **CORS:** an `*.openai.azure.com` resource may not allow direct browser calls;
 * if blocked, point `endpoint` at a same-origin proxy (e.g. a Vite `/azure`
 * proxy) or a backend. Same trade-off as `browserOpenai`.
 *
 * @example
 *   import { browserAzureOpenai } from 'agentfootprint';
 *   const provider = browserAzureOpenai({
 *     endpoint: 'https://my-co.openai.azure.com',
 *     apiKey: userKey, apiVersion: '2024-12-01-preview', deployment: 'gpt-4o-128k',
 *   });
 *   // Agent.create({ provider, model: 'azure' })
 */
export function browserAzureOpenai(options: BrowserAzureOpenAIProviderOptions): LLMProvider {
  if (!options.apiKey) throw new Error('browserAzureOpenai requires `apiKey`.');
  if (!options.endpoint) {
    throw new Error(
      'browserAzureOpenai requires `endpoint` (https://<resource>.openai.azure.com).',
    );
  }
  if (!options.apiVersion) {
    throw new Error('browserAzureOpenai requires `apiVersion` (e.g. 2024-12-01-preview).');
  }
  if (!options.deployment) {
    throw new Error('browserAzureOpenai requires `deployment` (the Azure deployment name).');
  }
  const base = options.endpoint.replace(/\/+$/, '');
  const apiUrl =
    `${base}/openai/deployments/${encodeURIComponent(options.deployment)}` +
    `/chat/completions?api-version=${encodeURIComponent(options.apiVersion)}`;

  const inner = browserOpenai({
    apiKey: options.apiKey,
    apiUrl,
    authScheme: 'api-key',
    defaultModel: options.deployment,
    ...(options.reasoning !== undefined && { reasoning: options.reasoning }),
    ...(options.defaultMaxTokens !== undefined && { defaultMaxTokens: options.defaultMaxTokens }),
    ...(options._fetch && { _fetch: options._fetch }),
  });
  const withDeployment = (req: LLMRequest): LLMRequest =>
    AZURE_BROWSER_SHORTHANDS.has(req.model) ? { ...req, model: options.deployment } : req;

  return {
    name: 'browser-azure-openai',
    complete: (req) => inner.complete(withDeployment(req)),
    ...(inner.stream && {
      stream: (req: LLMRequest) => inner.stream!(withDeployment(req)),
    }),
  };
}

export class BrowserAzureOpenAIProvider implements LLMProvider {
  readonly name = 'browser-azure-openai';
  private readonly inner: LLMProvider;

  constructor(options: BrowserAzureOpenAIProviderOptions) {
    this.inner = browserAzureOpenai(options);
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

/** o-series reasoning ids (o1, o3, o4-mini, …). `gpt-4o` starts with `g` — not matched. */
function isReasoningModel(model: string): boolean {
  return /^o\d/i.test(model);
}

interface BuildConfig {
  readonly defaultModel: string;
  readonly defaultMaxTokens: number | undefined;
  readonly stream: boolean;
  readonly legacyEndpoint: boolean;
  readonly reasoning: boolean;
}

function buildBody(req: LLMRequest, cfg: BuildConfig): OpenAIRequestBody {
  const model =
    req.model === 'openai' || req.model === 'browser-openai' ? cfg.defaultModel : req.model;
  const reasoning = cfg.reasoning || isReasoningModel(model);
  const body: OpenAIRequestBody = {
    model,
    messages: toOpenAIMessages(req.messages, req.systemPrompt, reasoning),
  };
  if (cfg.stream) {
    body.stream = true;
    // Without this OpenAI/Azure send no usage while streaming → 0-token accounting.
    if (!cfg.legacyEndpoint) body.stream_options = { include_usage: true };
  }
  if (req.tools && req.tools.length > 0) body.tools = req.tools.map(toOpenAITool);
  const max = req.maxTokens ?? cfg.defaultMaxTokens;
  if (max !== undefined) {
    // `max_tokens` is deprecated and rejected by o-series; `max_completion_tokens` is
    // current. Keep `max_tokens` only for custom compatible endpoints.
    if (cfg.legacyEndpoint) body.max_tokens = max;
    else body.max_completion_tokens = max;
  }
  // Reasoning models reject an explicit temperature.
  if (req.temperature !== undefined && !reasoning) body.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) body.stop = [...req.stop];
  return body;
}

function toOpenAIMessages(
  messages: readonly LLMMessage[],
  systemPrompt: string | undefined,
  reasoning: boolean,
): OpenAIMessage[] {
  const systemRole: 'system' | 'developer' = reasoning ? 'developer' : 'system';
  const result: OpenAIMessage[] = [];
  if (systemPrompt) result.push({ role: systemRole, content: systemPrompt });
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
      const msg: OpenAIMessage = { role: 'assistant', content: m.content || null };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
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
  if (!choice) throw new Error('[browser-openai] response missing choices[0]');
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

/** Parse OpenAI's SSE stream — `data: ...\n\n` lines, `[DONE]` terminator. */
async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            yield '[DONE]';
            return;
          }
          if (data) {
            try {
              yield JSON.parse(data);
            } catch {
              /* skip malformed */
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function wrapStatus(response: Response): Promise<Error> {
  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    /* ignore */
  }
  return Object.assign(
    new Error(
      `[browser-openai] ${response.status} ${response.statusText} — ${bodyText.slice(0, 200)}`,
    ),
    { name: 'BrowserOpenAIProviderError', status: response.status },
  );
}

function wrapError(err: unknown): Error {
  if (err instanceof Error) {
    return Object.assign(new Error(`[browser-openai] ${err.message}`), {
      name: 'BrowserOpenAIProviderError',
      cause: err,
    });
  }
  return new Error(`[browser-openai] ${String(err)}`);
}
