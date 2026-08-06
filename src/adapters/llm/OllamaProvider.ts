/**
 * OllamaProvider — local models over Ollama's native `/api/chat`.
 *
 * Pattern: Adapter (GoF) + Ports-and-Adapters (Cockburn 2005).
 * Role:    Outer ring — translates `LLMRequest`/`LLMResponse` to/from
 *          Ollama's native chat wire. Knows nothing about agents,
 *          recorders, or compositions.
 * Emits:   N/A.
 *
 * ─── Why this exists, and why it talks the native wire ───────────────
 *
 * The adapter ladder is `mock()` → a local model → a paid API, and the
 * strongest version of "the test run and the production run are the same
 * code path" is one where the middle step costs nothing and needs no API
 * key. Through 8.0.0 the middle step needed BOTH a competitor's SDK
 * (`npm install openai`, because `ollama()` was a thin wrapper over
 * `openai({ baseURL })`) and a tolerance for failures labelled `[openai]`.
 * That is not a free rung.
 *
 * So this file owns the wire:
 *
 *   • ZERO dependencies — one `fetch` POST and NDJSON. Nothing to install
 *     beyond Ollama itself. (Same choice, same reasons, as the two
 *     `Browser*Provider` adapters.)
 *   • HONEST REFUSALS — a typed {@link OllamaUnavailableError} that names
 *     the address it tried and the command to run. Owning the fetch and
 *     the status code is what makes that possible; through an SDK you get
 *     whatever the SDK decided to throw.
 *   • REAL TOKEN COUNTS — `/api/chat` returns `prompt_eval_count` /
 *     `eval_count` on every response, streaming or not, with no opt-in
 *     flag. Through the OpenAI-compatible endpoint a streamed local call
 *     reported ZERO tokens, which silently disarmed `.compaction()` and
 *     `costBudget` (see `CompactionUnmeasurableError`, whose message names
 *     this exact case).
 *   • STRUCTURED THINKING — `message.thinking` is a first-class field on
 *     this wire; the OpenAI-compatible layer renames it to a non-standard
 *     `reasoning` key that no OpenAI adapter reads. See
 *     `OllamaThinkingHandler`.
 *
 * Want the SDK path instead? It is still there and still supported:
 * `openai({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' })`.
 *
 * ─── Ceilings (stated, not worked around) ────────────────────────────
 *
 * • TOOL CALLING IS MODEL-DEPENDENT. Ollama forwards a `tools` array to
 *   any model; a model that was not trained for tools simply answers in
 *   prose and no tool call ever arrives. This adapter does not preflight
 *   `/api/show` capabilities to refuse first — a wrong refusal is worse
 *   than a weak answer, and the metadata is less reliable than the
 *   ceiling being written down. Pick a tool-capable model.
 * • NO FORCED TOOL CHOICE. Ollama does not support `tool_choice` on
 *   either wire, so `carriesForcedToolChoice` is `false` and an agent
 *   using `.outputSchema(parser, { strategy: 'tool-forced' })` refuses at
 *   run start, naming this provider.
 * • NO MULTI-MODAL. The wire carries `images`; `LLMMessage.content` is a
 *   string. Same ceiling as every other adapter here.
 * • NO PROMPT CACHING — resolves to the NoOp cache strategy.
 * • NO `providerRef`. The native wire returns no response id, and a
 *   fabricated one would point at nothing.
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
// Type-only: erased at build, so this adds no runtime edge from adapters/
// into thinking/ (the same relationship `adapters/types.ts` already has
// with `ThinkingBlock`). ALL tag parsing lives in the handler; this file
// only notices the shape and labels it.
import type { OllamaRawThinking } from '../../thinking/OllamaThinkingHandler.js';

// ─── Wire shapes (Ollama native /api/chat) ──────────────────────────

interface OllamaWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Reasoning text, present on thinking models when `think` was requested. */
  thinking?: string;
  tool_calls?: OllamaWireToolCall[];
  /** For `role: 'tool'` — which function produced this result. */
  tool_name?: string;
  /** For `role: 'tool'` — echoes the id the model used, when it used one. */
  tool_call_id?: string;
}

interface OllamaWireToolCall {
  /** Optional on this wire — many models emit tool calls with no id at all. */
  id?: string;
  function: {
    name: string;
    /** A JSON OBJECT on this wire, not a JSON string (unlike OpenAI's). */
    arguments?: Record<string, unknown> | string;
  };
}

interface OllamaWireTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaWireMessage[];
  stream: boolean;
  tools?: OllamaWireTool[];
  think?: boolean | ThinkLevel;
  keep_alive?: string | number;
  options?: {
    num_predict?: number;
    temperature?: number;
    stop?: string[];
  };
}

interface OllamaChatResponse {
  model?: string;
  created_at?: string;
  message?: OllamaWireMessage;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** `{"error": "..."}` — the uniform native error body. */
interface OllamaErrorBody {
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

/** How hard a thinking model should think. Ollama's own vocabulary. */
export type ThinkLevel = 'low' | 'medium' | 'high' | 'max';

// ─── Errors ─────────────────────────────────────────────────────────

/**
 * The two failures a local runtime actually has, told in words that
 * contain the fix.
 *
 * Both are things the person at the keyboard can resolve in one command,
 * which is exactly why they get a type instead of a wrapped
 * `ECONNREFUSED` or a bare `404`. `reason` is the discriminator; the
 * message already reads as instructions.
 */
export class OllamaUnavailableError extends Error {
  override readonly name = 'OllamaUnavailableError';
  /** Which of the two situations this is. */
  readonly reason: 'daemon-unreachable' | 'model-not-pulled';
  /** The address that was tried — the thing to check or change. */
  readonly baseUrl: string;
  /** The model asked for. Absent when the daemon never answered at all. */
  readonly model?: string;
  /** Models this machine DOES have, when the daemon could tell us. */
  readonly availableModels?: readonly string[];

  constructor(init: {
    reason: 'daemon-unreachable' | 'model-not-pulled';
    baseUrl: string;
    model?: string;
    availableModels?: readonly string[];
    cause?: unknown;
  }) {
    super(buildUnavailableMessage(init));
    this.reason = init.reason;
    this.baseUrl = init.baseUrl;
    if (init.model !== undefined) this.model = init.model;
    if (init.availableModels !== undefined) this.availableModels = init.availableModels;
    if (init.cause !== undefined) this.cause = init.cause;
  }
}

function buildUnavailableMessage(init: {
  reason: 'daemon-unreachable' | 'model-not-pulled';
  baseUrl: string;
  model?: string;
  availableModels?: readonly string[];
}): string {
  if (init.reason === 'daemon-unreachable') {
    return (
      `ollama: nothing is answering at ${init.baseUrl}. ` +
      `Start it with \`ollama serve\` (or open the Ollama app); install it from ` +
      `https://ollama.com/download. ` +
      `Running somewhere else? Pass ollama('<model>', { baseUrl: '...' }) or set OLLAMA_HOST.`
    );
  }
  const model = init.model ?? '(unnamed)';
  const have =
    init.availableModels && init.availableModels.length > 0
      ? ` Models on this machine: ${init.availableModels.join(', ')}.`
      : '';
  return (
    `ollama: model '${model}' is not pulled on the machine at ${init.baseUrl}. ` +
    `Run: ollama pull ${model}.${have}`
  );
}

// ─── Options ────────────────────────────────────────────────────────

export interface OllamaProviderOptions {
  /**
   * Where Ollama is listening. Defaults to `OLLAMA_HOST` when set,
   * otherwise `http://localhost:11434`. A bare `host:port` gets `http://`.
   *
   * Point it at the ROOT, not at a path — this adapter talks to
   * `/api/chat` and `/api/tags` itself. A URL ending in `/v1` (the
   * OpenAI-compatible path) is accepted and trimmed, so a config written
   * for the 8.0.0 factory keeps working.
   */
  readonly baseUrl?: string;
  /** Shipped-in-8.0.0 spelling of {@link baseUrl}. Still honored. */
  readonly host?: string;
  /** Shipped-in-8.0.0 spelling of {@link baseUrl}. Still honored. */
  readonly baseURL?: string;
  /**
   * Model used when `LLMRequest.model` is the `'ollama'` shorthand.
   * Prefer the positional form: `ollama('qwen3')`.
   */
  readonly defaultModel?: string;
  /** Default token cap when the request doesn't set one. Maps to `num_predict`. */
  readonly defaultMaxTokens?: number;
  /**
   * Ask a thinking model to reason before answering. `true` turns it on;
   * `'low' | 'medium' | 'high' | 'max'` sets how hard.
   *
   * Worth setting on reasoning models (deepseek-r1, qwen3, gpt-oss, …):
   * with `think` on, Ollama lifts the reasoning OUT of the answer into
   * `message.thinking`, where `ollamaThinkingHandler` normalizes it.
   * With it off, the same model leaves `<think>…</think>` sitting in the
   * answer text.
   *
   * A per-request `LLMRequest.thinking` (what `AgentBuilder.thinking()`
   * sets) also turns it on; this option is the always-on default and the
   * only way to name a level.
   */
  readonly think?: boolean | ThinkLevel;
  /** How long Ollama keeps the model in memory after a call, e.g. `'5m'`. */
  readonly keepAlive?: string | number;
  /**
   * How long to wait for the daemon to ANSWER, in ms. Default 10000.
   *
   * This bounds the wait for response headers, NOT generation: a laptop
   * model may take minutes to finish a long answer and that is fine. What
   * it prevents is the failure this whole file exists to avoid — a run
   * that hangs because nothing is listening.
   */
  readonly timeoutMs?: number;
  /** Accepted and ignored — Ollama needs no key. Kept so 8.0.0 configs still typecheck. */
  readonly apiKey?: string;
  /** @internal Custom fetch implementation for tests. */
  readonly _fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_TIMEOUT_MS = 10_000;

/** Request `model` values that mean "whatever this provider was configured with". */
const MODEL_SHORTHANDS = new Set(['ollama']);

/**
 * Which roles this wire carries inside `messages`.
 *
 * Ollama's native chat takes the system prompt as a message like any
 * other (there is no separate top-level `system` field), so all three
 * roles survive the trip.
 */
const CARRIES_IN_MESSAGES: readonly WireRole[] = Object.freeze(['system', 'user', 'assistant']);

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Build an `LLMProvider` backed by a local Ollama runtime.
 *
 * Free, offline, no API key. The rung between `mock()` and a paid API —
 * and the agent code above it does not change between the three.
 *
 * @example
 *   import { Agent } from 'agentfootprint';
 *   import { ollama } from 'agentfootprint/providers';
 *
 *   const agent = Agent.create({
 *     provider: ollama('qwen3'),
 *     model: 'qwen3',
 *   }).build();
 *
 * @example  // reasoning model, thinking lifted out of the answer
 *   ollama('deepseek-r1', { think: 'high' });
 *
 * @example  // a runtime on another machine
 *   ollama('llama3.2', { baseUrl: 'http://192.168.1.20:11434' });
 */
export function ollama(model: string, options?: OllamaProviderOptions): LLMProvider;
/**
 * Object form, as shipped in 8.0.0. Still supported — `host` / `baseURL` /
 * `defaultModel` / `apiKey` all keep their meaning.
 */
export function ollama(options?: OllamaProviderOptions): LLMProvider;
export function ollama(
  modelOrOptions?: string | OllamaProviderOptions,
  maybeOptions?: OllamaProviderOptions,
): LLMProvider {
  const options: OllamaProviderOptions =
    typeof modelOrOptions === 'string' ? maybeOptions ?? {} : modelOrOptions ?? {};
  const positionalModel = typeof modelOrOptions === 'string' ? modelOrOptions : undefined;

  const baseUrl = resolveBaseUrl(options);
  const defaultModel = positionalModel ?? options.defaultModel ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options._fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const chatUrl = `${baseUrl}/api/chat`;

  const cfg: BuildConfig = {
    defaultModel,
    ...(options.defaultMaxTokens !== undefined && { defaultMaxTokens: options.defaultMaxTokens }),
    ...(options.think !== undefined && { think: options.think }),
    ...(options.keepAlive !== undefined && { keepAlive: options.keepAlive }),
  };

  // Tool-call ids are synthesized per provider instance — see toLLMToolCall
  // for why this wire needs that at all.
  let toolCallSeq = 0;
  const nextToolCallId = (): string => `ollama-call-${++toolCallSeq}`;

  const post = async (body: OllamaChatRequest, req: LLMRequest): Promise<Response> => {
    const response = await fetchUntilHeaders(
      fetchImpl,
      chatUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { timeoutMs, baseUrl, ...(req.signal && { signal: req.signal }) },
    );
    if (!response.ok) {
      throw await describeFailure(response, body.model, baseUrl, fetchImpl, timeoutMs);
    }
    return response;
  };

  const provider: LLMProvider = {
    name: 'ollama',
    carriesInMessages: CARRIES_IN_MESSAGES,
    // Ollama supports no forced tool choice on either of its wires. Absence
    // would mean the same thing; saying it out loud documents that this was
    // checked rather than forgotten.
    carriesForcedToolChoice: false,

    async complete(req: LLMRequest): Promise<LLMResponse> {
      const body = buildBody(req, cfg, false);
      const response = await post(body, req);
      const json = (await response.json()) as OllamaChatResponse;
      return fromOllamaResponse(json, nextToolCallId);
    },

    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const body = buildBody(req, cfg, true);
      const response = await post(body, req);
      if (!response.body) throw new Error('[ollama] response has no body');

      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: OllamaWireToolCall[] = [];
      let doneReason = 'stop';
      let promptEvalCount = 0;
      let evalCount = 0;
      let tokenIndex = 0;

      for await (const chunk of parseNdjson(response.body)) {
        const frame = chunk as OllamaChatResponse;
        // Counts ride the terminal frame, whose `message.content` is empty —
        // read them before any content guard, or the only token counts the
        // stream reports are thrown away (the failure that made streamed
        // local calls report zero and disarmed `.compaction()`).
        if (typeof frame.prompt_eval_count === 'number') promptEvalCount = frame.prompt_eval_count;
        if (typeof frame.eval_count === 'number') evalCount = frame.eval_count;
        if (frame.done_reason) doneReason = frame.done_reason;

        const message = frame.message;
        if (message) {
          if (message.tool_calls && message.tool_calls.length > 0) {
            // Ollama emits each tool call whole, not as an assembled delta.
            toolCalls.push(...message.tool_calls);
          }
          if (message.thinking) {
            thinkingParts.push(message.thinking);
            yield { tokenIndex, content: '', done: false, thinkingDelta: message.thinking };
            tokenIndex++;
          }
          if (message.content) {
            textParts.push(message.content);
            yield { tokenIndex, content: message.content, done: false };
            tokenIndex++;
          }
        }
        if (frame.done) break;
      }

      const content = textParts.join('');
      const rawThinking = describeThinking(content, thinkingParts.join(''));
      const authoritative: LLMResponse = {
        content,
        toolCalls: toolCalls.map((tc) => toLLMToolCall(tc, nextToolCallId)),
        usage: { input: promptEvalCount, output: evalCount },
        stopReason: normalizeStopReason(doneReason, toolCalls.length > 0),
        ...(rawThinking && { rawThinking }),
      };
      yield { tokenIndex, content: '', done: true, response: authoritative };
    },
  };

  return provider;
}

/**
 * Class form for consumers who prefer `new OllamaProvider(...)`.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly carriesInMessages = CARRIES_IN_MESSAGES;
  readonly carriesForcedToolChoice = false;
  private readonly inner: LLMProvider;

  constructor(model?: string | OllamaProviderOptions, options?: OllamaProviderOptions) {
    this.inner =
      typeof model === 'string' ? ollama(model, options) : ollama(model as OllamaProviderOptions);
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

/**
 * Resolve where Ollama lives, accepting every spelling that has ever been
 * valid here plus Ollama's own `OLLAMA_HOST` convention.
 *
 * A `/v1` suffix is trimmed rather than rejected: through 8.0.0 the
 * factory built `${host}/v1` for the OpenAI-compatible endpoint, and a
 * config carrying that URL means the same machine.
 */
function resolveBaseUrl(options: OllamaProviderOptions): string {
  const raw =
    options.baseUrl ??
    options.host ??
    options.baseURL ??
    (typeof process !== 'undefined' ? process.env?.OLLAMA_HOST : undefined) ??
    DEFAULT_BASE_URL;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

interface BuildConfig {
  readonly defaultModel: string;
  readonly defaultMaxTokens?: number;
  readonly think?: boolean | ThinkLevel;
  readonly keepAlive?: string | number;
}

function buildBody(req: LLMRequest, cfg: BuildConfig, stream: boolean): OllamaChatRequest {
  const model = MODEL_SHORTHANDS.has(req.model) ? cfg.defaultModel : req.model;
  const body: OllamaChatRequest = {
    model,
    messages: toOllamaMessages(req.messages, req.systemPrompt),
    stream,
  };
  if (req.tools && req.tools.length > 0) body.tools = req.tools.map(toOllamaTool);

  // Two ways to ask for thinking: the provider-wide option (which can name a
  // level) and the per-request field the agent's `.thinking({ budget })` sets.
  // The request cannot express a level, so it turns thinking on and leaves the
  // configured level in place. `budget` has no equivalent on this wire —
  // Ollama does not take a reasoning-token cap — so it is deliberately dropped
  // rather than mistranslated into `num_predict`, which caps the ANSWER.
  if (cfg.think !== undefined) body.think = cfg.think;
  else if (req.thinking !== undefined) body.think = true;

  if (cfg.keepAlive !== undefined) body.keep_alive = cfg.keepAlive;

  const maxTokens = req.maxTokens ?? cfg.defaultMaxTokens;
  const options: NonNullable<OllamaChatRequest['options']> = {};
  if (maxTokens !== undefined) options.num_predict = maxTokens;
  if (req.temperature !== undefined) options.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) options.stop = [...req.stop];
  if (Object.keys(options).length > 0) body.options = options;

  // `req.toolChoice` is intentionally NOT translated: Ollama supports no
  // forced tool choice, `carriesForcedToolChoice` says so, and the agent
  // refuses before it ever reaches here.
  return body;
}

/**
 * messages → Ollama messages.
 *
 * Roles map 1:1. The system prompt is prepended as an ordinary `system`
 * message (this wire has no separate system field). Assistant turns carry
 * their `tool_calls` back so the model can see its own requests; tool
 * results carry `tool_name`, which is how this wire correlates a result
 * with the call that asked for it.
 */
function toOllamaMessages(
  messages: readonly LLMMessage[],
  systemPrompt: string | undefined,
): OllamaWireMessage[] {
  const result: OllamaWireMessage[] = [];
  if (systemPrompt) result.push({ role: 'system', content: systemPrompt });

  for (const m of messages) {
    if (m.role === 'system' || m.role === 'user') {
      result.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const msg: OllamaWireMessage = { role: 'assistant', content: m.content };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          ...(tc.id && { id: tc.id }),
          function: { name: tc.name, arguments: { ...tc.args } },
        }));
      }
      result.push(msg);
      continue;
    }
    if (m.role === 'tool') {
      // `tool_name` is what this wire matches on. The agent always sets
      // `toolName`; a hand-built history might not, so fall back to looking
      // the id up in the assistant turn that requested it.
      const toolName = m.toolName ?? nameForToolCallId(messages, m.toolCallId);
      result.push({
        role: 'tool',
        content: m.content,
        ...(toolName && { tool_name: toolName }),
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
      });
      continue;
    }
  }
  return result;
}

function nameForToolCallId(
  messages: readonly LLMMessage[],
  toolCallId: string | undefined,
): string | undefined {
  if (!toolCallId) return undefined;
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (const tc of m.toolCalls) {
      if (tc.id === toolCallId) return tc.name;
    }
  }
  return undefined;
}

function toOllamaTool(schema: LLMToolSchema): OllamaWireTool {
  return {
    type: 'function',
    function: {
      name: schema.name,
      description: schema.description,
      parameters: { ...schema.inputSchema },
    },
  };
}

function fromOllamaResponse(
  response: OllamaChatResponse,
  nextToolCallId: () => string,
): LLMResponse {
  const message = response.message;
  const wireToolCalls = message?.tool_calls ?? [];
  const toolCalls = wireToolCalls.map((tc) => toLLMToolCall(tc, nextToolCallId));
  const content = message?.content ?? '';
  const rawThinking = describeThinking(content, message?.thinking);
  return {
    content,
    toolCalls,
    usage: {
      input: response.prompt_eval_count ?? 0,
      output: response.eval_count ?? 0,
    },
    stopReason: normalizeStopReason(response.done_reason ?? 'stop', toolCalls.length > 0),
    // No `providerRef` — this wire returns no response id, and inventing
    // one would hand consumers a reference that resolves to nothing.
    ...(rawThinking && { rawThinking }),
  };
}

/**
 * Where the model's reasoning ended up, labelled for the handler.
 *
 * `message.thinking` is the good case — Ollama lifted the reasoning out of
 * the answer because we asked it to. Failing that, a reasoning model that
 * was NOT asked leaves `<think>…</think>` sitting in the answer text; we
 * notice and say so, and we pass the answer through UNCHANGED. Editing a
 * model's answer behind its back is a meaning change and belongs to the
 * application, not to an adapter. See `OllamaThinkingHandler`.
 */
function describeThinking(
  content: string,
  thinkingField: string | undefined,
): OllamaRawThinking | undefined {
  if (thinkingField && thinkingField.length > 0) {
    return { kind: 'field', thinking: thinkingField };
  }
  if (content.includes('<think')) return { kind: 'inline', content };
  return undefined;
}

/**
 * One wire tool call → the port's shape.
 *
 * Two wire facts handled here:
 *   • `id` is optional and most models omit it, but the whole tool
 *     round-trip in this library is keyed by id. So an id is SYNTHESIZED
 *     when missing — unique per provider instance, which is all the
 *     correlation needs, and the name still rides `tool_name` on the way
 *     back regardless.
 *   • `arguments` is already a JSON OBJECT here (OpenAI sends a string),
 *     so there is nothing to parse. A string is still tolerated in case a
 *     proxy in the middle reshaped it.
 */
function toLLMToolCall(
  tc: OllamaWireToolCall,
  nextToolCallId: () => string,
): { id: string; name: string; args: Record<string, unknown> } {
  return {
    id: tc.id && tc.id.length > 0 ? tc.id : nextToolCallId(),
    name: tc.function?.name ?? '',
    args: coerceArgs(tc.function?.arguments),
  };
}

function coerceArgs(args: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args === 'string') {
    if (args.length === 0) return {};
    try {
      const parsed: unknown = JSON.parse(args);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      // Malformed args are rare but observed on small local models. Surface
      // empty rather than crash — the tool-call event still fires, so the
      // problem is visible in the trace.
      return {};
    }
  }
  return { ...args };
}

/**
 * `done_reason` → the port's stop vocabulary.
 *
 * Ollama reports `stop` even when the turn ended in tool calls, so the
 * presence of tool calls is what distinguishes `tool_use` — the same
 * correction Ollama's own OpenAI-compat layer makes.
 */
function normalizeStopReason(raw: string, hasToolCalls: boolean): string {
  if (hasToolCalls && (raw === 'stop' || raw === '')) return 'tool_use';
  switch (raw) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'max_tokens';
    default:
      return raw;
  }
}

/** Parse an NDJSON body — one JSON object per line. */
async function* parseNdjson(body: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line);
        } catch {
          /* skip malformed line */
        }
      }
    }
    // A final line with no trailing newline still counts.
    const tail = buf.trim();
    if (tail) {
      try {
        yield JSON.parse(tail);
      } catch {
        /* skip malformed tail */
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * POST, but never hang waiting for a daemon that is not there.
 *
 * The timer bounds the wait for RESPONSE HEADERS and is cleared the moment
 * they arrive, so a model that takes four minutes to write a long answer is
 * unaffected — `fetch` resolves on headers, and the body streams afterwards.
 *
 * The deadline is a RACE, not just an `AbortSignal`. Aborting is the polite
 * request — it releases the socket and is what a real `fetch` acts on — but a
 * promise that never settles is exactly the failure this guards against, and
 * "never hangs" cannot be a promise the caller's `fetch` implementation gets
 * to break on our behalf. So the timeout wins on its own.
 *
 * A caller's own `AbortSignal` is forwarded and, if IT is what fired, the
 * abort is re-thrown as an abort rather than blamed on the daemon.
 */
async function fetchUntilHeaders(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; baseUrl: string; signal?: AbortSignal },
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onCallerAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true });

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new OllamaUnavailableError({ reason: 'daemon-unreachable', baseUrl: opts.baseUrl }));
    }, opts.timeoutMs);
  });

  try {
    return await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), deadline]);
  } catch (err) {
    if (err instanceof OllamaUnavailableError) throw err; // the deadline fired
    if (opts.signal?.aborted && !timedOut) throw err; // the caller's call, not ours
    // Timed out, or connection refused / DNS failure / TLS failure — either
    // way, nothing answered at that address.
    throw new OllamaUnavailableError({
      reason: 'daemon-unreachable',
      baseUrl: opts.baseUrl,
      cause: err,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCallerAbort);
    // When the fetch wins the race, the deadline promise may still reject with
    // nobody listening. Swallow it deliberately: the answer already arrived, so
    // an unhandled-rejection warning here would be noise about a non-event.
    deadline.catch(() => undefined);
  }
}

/**
 * Turn a non-2xx into the most actionable error available.
 *
 * A 404 from `/api/chat` means the model is not on this machine. Before
 * saying so we ask `/api/tags` — a cheap local call — so the message can
 * also name what IS here, which is usually enough to spot a typo. If that
 * lookup fails too, the `ollama pull` instruction stands on its own.
 */
async function describeFailure(
  response: Response,
  model: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Error> {
  const bodyText = await safeText(response);
  if (response.status === 404) {
    const availableModels = await listPulledModels(fetchImpl, baseUrl, timeoutMs);
    return new OllamaUnavailableError({
      reason: 'model-not-pulled',
      baseUrl,
      model,
      ...(availableModels && { availableModels }),
    });
  }
  const detail = extractErrorText(bodyText);
  return Object.assign(
    new Error(
      `[ollama] ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`.trim(),
    ),
    { name: 'OllamaProviderError', status: response.status },
  );
}

async function listPulledModels(
  fetchImpl: typeof fetch,
  baseUrl: string,
  timeoutMs: number,
): Promise<readonly string[] | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) return undefined;
    const json = (await response.json()) as OllamaTagsResponse;
    const names = (json.models ?? [])
      .map((m) => m.name ?? m.model)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    return names.length > 0 ? names : undefined;
  } catch {
    // Best-effort enrichment. Its failure must never replace the error we
    // are already in the middle of reporting.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** Native errors are `{"error": "..."}`; fall back to the raw text. */
function extractErrorText(bodyText: string): string {
  if (!bodyText) return '';
  try {
    const parsed = JSON.parse(bodyText) as OllamaErrorBody;
    if (typeof parsed.error === 'string' && parsed.error.length > 0) return parsed.error;
  } catch {
    /* not JSON — fall through */
  }
  return bodyText.slice(0, 200);
}
