/**
 * FoundryLocalProvider — on-device models over Foundry Local's
 * OpenAI-compatible `/v1/chat/completions`.
 *
 * Pattern: Adapter (GoF) + Ports-and-Adapters (Cockburn 2005).
 * Role:    Outer ring — translates `LLMRequest`/`LLMResponse` to/from the
 *          wire Foundry Local serves on localhost. Knows nothing about
 *          agents, recorders, or compositions.
 * Emits:   N/A.
 *
 * ─── Why this exists ─────────────────────────────────────────────────
 *
 * The adapter ladder is `mock()` → a local model → a paid API, and
 * `ollama()` is the proof that the middle rung is worth owning: zero
 * dependencies, honest refusals, real token counts. Foundry Local is
 * Microsoft's runtime for the same rung — ONNX under the hood, models
 * pulled with `foundry model run <alias>`, no key, no account — and a
 * Windows or macOS machine that has it installed deserves the same
 * one-import experience. So this file owns that wire the way
 * `OllamaProvider.ts` owns Ollama's:
 *
 *   • ZERO dependencies — one `fetch` POST and SSE. The official
 *     `foundry-local-sdk` is NOT imported; its manager is accepted
 *     duck-typed (see {@link FoundryLocalProviderOptions.manager}) so a
 *     consumer who already uses it can hand over the discovered URL
 *     without this package gaining a dependency.
 *   • HONEST REFUSALS — a typed {@link FoundryLocalUnavailableError}
 *     that names the endpoint it tried and the command to run. The
 *     service's port is DYNAMIC per start, which makes "nothing is
 *     answering" the most likely first failure — so that message
 *     carries the discovery command, not just the start command. A
 *     failure the service reports IN BAND — an `error` frame on an
 *     already-200 stream, the out-of-memory a laptop runtime really does
 *     hit — is RAISED the same way, never handed over as a shorter
 *     answer that reads like a clean stop.
 *   • REAL TOKEN COUNTS while streaming — `stream_options:
 *     { include_usage: true }` is always sent. This is OUR wire, a
 *     documented Foundry Local surface, not an arbitrary
 *     OpenAI-compatible server — so the caution that made
 *     `openai({ baseURL })` withhold the field (and silently zero every
 *     local token count until 9.73.0) does not apply here.
 *
 * ─── Wire realities this file owns ───────────────────────────────────
 *
 * • THE PORT IS DYNAMIC. Every `foundry server start` may pick a new
 *   port; the docs' own REST example shows `http://localhost:5272` and
 *   that is the default here, but the truthful discovery is
 *   `foundry server status` (or the SDK manager's `.urls`). Note the
 *   CLI group was RENAMED from `foundry service` to `foundry server` —
 *   every message in this file uses the NEW spelling.
 * • ALIASES vs VARIANT IDS. The catalog speaks in aliases
 *   (`qwen2.5-0.5b`) that fan out to hardware variants
 *   (`qwen2.5-0.5b-instruct-generic-cpu:1`), but REST chat calls take
 *   the FULL variant id. This adapter resolves an alias through
 *   `GET /foundry/list` — first matching variant wins, because the
 *   list's order IS the service's priority order — and caches the
 *   answer per provider instance, HIT OR MISS: exactly one catalog
 *   attempt per name, so an alias the catalog never answers for cannot
 *   re-ask before every call. A fresh provider is the retry. A name that
 *   already carries a variant's execution-provider suffix
 *   (`-cpu`/`-gpu`/`-npu`, optional `:version`) is used as-is with no
 *   catalog round-trip.
 * • NO API KEY EXISTS. The docs' own samples pass placeholders. This
 *   adapter sends no `Authorization` header at all — there is nothing
 *   to put in one, and an invented value would only end up in somebody's
 *   proxy log.
 *
 * ─── Ceilings (stated, not worked around) ────────────────────────────
 *
 * • NO FORCED TOOL CHOICE. `tool_choice` support is UNDOCUMENTED on
 *   this wire, so `carriesForcedToolChoice` is `false` and an agent
 *   using `.outputSchema(parser, { strategy: 'tool-forced' })` refuses
 *   at run start, naming this provider. Claiming an undocumented field
 *   works would turn a guarantee into a suggestion.
 * • TOOL CALLING IS MODEL-DEPENDENT. `/foundry/list` reports
 *   `supportsToolCalling` per variant, but this adapter does not
 *   preflight-refuse on it — a wrong refusal is worse than a weak
 *   answer, the same stance `ollama()` takes on `/api/show`. Pick a
 *   tool-capable variant.
 * • NO MULTI-MODAL. `LLMMessage.content` is a string. Same ceiling as
 *   every other adapter here.
 * • NO PROMPT CACHING — resolves to the NoOp cache strategy.
 * • NO STRUCTURED THINKING. The wire has no thinking field; a reasoning
 *   model's `<think>` tags ride the answer text untouched.
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

// ─── Wire shapes (Foundry Local /v1 — the OpenAI dialect) ───────────

interface FoundryWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For `role: 'assistant'` — calls the model made, echoed back so it can see its own requests. */
  tool_calls?: FoundryWireToolCallOut[];
  /** For `role: 'tool'` — which call this result answers. How this dialect correlates them. */
  tool_call_id?: string;
}

interface FoundryWireToolCallOut {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** A JSON STRING on this wire (the OpenAI dialect) — unlike Ollama's object. */
    arguments: string;
  };
}

interface FoundryWireToolCallIn {
  /** Present on well-behaved responses; small local models have been seen to omit it. */
  id?: string;
  function?: {
    name?: string;
    /** A JSON string per the dialect; an OBJECT is tolerated in case a proxy reshaped it. */
    arguments?: string | Record<string, unknown>;
  };
}

interface FoundryWireTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface FoundryChatRequest {
  /** The FULL variant id — REST chat takes no bare alias. See the factory's `resolveModel`. */
  model: string;
  messages: FoundryWireMessage[];
  stream: boolean;
  /** Streaming only — ask for usage on the terminal chunk. Set in {@link buildBody}. */
  stream_options?: { include_usage: boolean };
  tools?: FoundryWireTool[];
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
}

interface FoundryChatResponse {
  id?: string;
  /**
   * A 200 body can still BE a failure on this dialect. Read in
   * {@link fromFoundryResponse}, which refuses rather than returning the
   * empty answer that `choices: undefined` would otherwise produce.
   */
  error?: string | { message?: string };
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: FoundryWireToolCallIn[];
    };
    finish_reason?: string | null;
  }>;
  usage?: FoundryWireUsage;
}

/** One SSE `data:` frame of a streamed chat. */
interface FoundryStreamChunk {
  id?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  /** Rides a FINAL chunk whose `choices` is EMPTY — see the stream loop. */
  usage?: FoundryWireUsage;
  /**
   * How this dialect reports a failure MID-GENERATION on a stream that
   * already answered 200 — the other spelling is an `event: error` frame,
   * which is why {@link parseSse} carries the event name. Either one is
   * raised by the stream loop; neither is a clean stop.
   */
  error?: string | { message?: string };
}

interface FoundryWireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/**
 * One `GET /foundry/list` catalog entry, duck-typed to the two spellings
 * in the wild: the REST surface says `name` for the full variant id, the
 * SDK's model info says `id`. Everything else the entry carries
 * (`supportsToolCalling`, sizes, licenses) is deliberately not modelled —
 * this adapter reads exactly the alias→variant fact and nothing more.
 */
interface FoundryCatalogEntry {
  name?: string;
  id?: string;
  alias?: string;
}

/** `{"error": {"message": "..."}}` per the OpenAI dialect; a bare string is tolerated. */
interface FoundryErrorBody {
  error?: string | { message?: string };
}

/**
 * One parsed SSE frame: its `data:` payload, plus the `event:` name when it
 * had one. The name is carried because `event: error` is this dialect's
 * OTHER way of saying a generation failed — dropping it would leave that
 * failure indistinguishable from an ordinary frame with no `choices`.
 */
interface SseFrame {
  readonly event?: string;
  readonly data: unknown;
}

/** Cap for any text the wire supplies before it becomes one of our messages. */
const ERROR_TEXT_CAP = 200;

// ─── Errors ─────────────────────────────────────────────────────────

/**
 * The two failures an on-device runtime actually has, told in words that
 * contain the fix.
 *
 * Both are things the person at the keyboard can resolve in one command,
 * which is exactly why they get a type instead of a wrapped
 * `ECONNREFUSED` or a bare `404`. `reason` is the discriminator; the
 * message already reads as instructions — and because Foundry Local's
 * port changes per start, the unreachable message teaches the discovery
 * command (`foundry server status`) alongside the start command.
 */
export class FoundryLocalUnavailableError extends Error {
  override readonly name = 'FoundryLocalUnavailableError';
  /** Which of the two situations this is. */
  readonly reason: 'service-unreachable' | 'model-not-available';
  /** The endpoint that was tried — the thing to check or change. */
  readonly endpoint: string;
  /** The model asked for. Absent when the service never answered at all. */
  readonly model?: string;
  /** Models this machine DOES have cached, when the service could tell us. */
  readonly availableModels?: readonly string[];

  constructor(init: {
    reason: 'service-unreachable' | 'model-not-available';
    endpoint: string;
    model?: string;
    availableModels?: readonly string[];
    /**
     * The 404 body did not speak this dialect, so "the model is missing" is
     * a guess and the endpoint deserves naming too. Shapes the MESSAGE only;
     * `reason` stays the discriminator consumers branch on.
     */
    routeUnconfirmed?: boolean;
    cause?: unknown;
  }) {
    super(buildUnavailableMessage(init));
    this.reason = init.reason;
    this.endpoint = init.endpoint;
    if (init.model !== undefined) this.model = init.model;
    if (init.availableModels !== undefined) this.availableModels = init.availableModels;
    if (init.cause !== undefined) this.cause = init.cause;
  }
}

function buildUnavailableMessage(init: {
  reason: 'service-unreachable' | 'model-not-available';
  endpoint: string;
  model?: string;
  availableModels?: readonly string[];
  routeUnconfirmed?: boolean;
}): string {
  if (init.reason === 'service-unreachable') {
    return (
      `foundryLocal: nothing is answering at ${init.endpoint}. ` +
      'Start it with `foundry server start` (Foundry Local, install: ' +
      'https://learn.microsoft.com/azure/foundry-local). ' +
      'The port is dynamic — `foundry server status` prints the live URL; ' +
      'pin one with `foundry server start --port <p>`. ' +
      "Running elsewhere? Pass foundryLocal('<model>', { endpoint }) or set FOUNDRY_LOCAL_ENDPOINT."
    );
  }
  const model = init.model ?? '(unnamed)';
  const have =
    init.availableModels && init.availableModels.length > 0
      ? ` Models on this machine: ${init.availableModels.join(', ')}.`
      : '';
  // A 404 that did not speak the dialect is as likely a wrong route as a
  // missing model. Say both rather than one confidently.
  const route = init.routeUnconfirmed
    ? ` That 404 named no model error, so ${init.endpoint} may not be Foundry Local's chat route at all — \`foundry server status\` prints the live URL.`
    : '';
  return (
    `foundryLocal: model '${model}' is not available on the service at ${init.endpoint}. ` +
    `Run: foundry model run ${model} — it downloads the model if needed (aliases work too).${have}${route}`
  );
}

// ─── Options ────────────────────────────────────────────────────────

export interface FoundryLocalProviderOptions {
  /**
   * Where the Foundry Local service is listening — the ROOT url; this
   * adapter appends `/v1/chat/completions`, `/foundry/list` and
   * `/openai/models` itself. A URL ending in `/v1` is accepted and
   * trimmed (the same courtesy `ollama()` extends to its 8.0.0 configs),
   * and a bare `host:port` gets `http://`.
   *
   * Defaults to `FOUNDRY_LOCAL_ENDPOINT` when set, then
   * `FOUNDRY_LOCAL_BASE_URL` — the second spelling is honored because
   * our own demo taught it, and a config written for that demo should
   * keep working — otherwise `http://localhost:5272`. Know that the
   * default is only the docs' example port: Foundry Local picks a NEW
   * port on every `foundry server start` unless one was pinned with
   * `--port`, and `foundry server status` prints the live URL.
   *
   * A BLANK value anywhere in that chain — `ENV FOUNDRY_LOCAL_ENDPOINT=`
   * in a Dockerfile, an empty compose value, `manager.urls = ['']` —
   * counts as unset, not as the URL `http:`. The next candidate gets its
   * turn.
   */
  readonly endpoint?: string;
  /**
   * A `foundry-local-sdk` `FoundryLocalManager`, duck-typed — this
   * package never imports the SDK. When given, `manager.urls[0]` (the
   * manager's discovered service URL) wins over the env vars and the
   * default, so a consumer already using the SDK for model management
   * gets the REAL dynamic port for free. An explicit `endpoint` still
   * beats it — the most specific word wins.
   */
  readonly manager?: { readonly urls?: readonly string[] };
  /**
   * Model used when `LLMRequest.model` is the `'foundry-local'`
   * shorthand. Prefer the positional form: `foundryLocal('qwen2.5-0.5b')`.
   */
  readonly defaultModel?: string;
  /** Default token cap when the request doesn't set one. Maps to `max_tokens`. */
  readonly defaultMaxTokens?: number;
  /**
   * How long to wait for the service to ANSWER, in ms. Default 10000.
   *
   * This bounds the wait for response headers, NOT generation: a laptop
   * model may take minutes to finish a long answer and that is fine.
   * What it prevents is the failure this whole file exists to avoid — a
   * run that hangs because nothing is listening. Stopping a call that is
   * already streaming is the caller's `AbortSignal`'s job, not this
   * one's — and that signal is honored for the WHOLE call, body included.
   */
  readonly timeoutMs?: number;
  /** @internal Custom fetch implementation for tests. */
  readonly _fetch?: typeof fetch;
}

/**
 * The docs' own REST example port. Only a default, never a promise —
 * see {@link FoundryLocalProviderOptions.endpoint} for the truth about
 * dynamic ports.
 */
const DEFAULT_ENDPOINT = 'http://localhost:5272';
/** The alias the Foundry Local docs use in their own REST walkthrough. */
const DEFAULT_MODEL = 'qwen2.5-0.5b';
const DEFAULT_TIMEOUT_MS = 10_000;

/** Request `model` values that mean "whatever this provider was configured with". */
const MODEL_SHORTHANDS = new Set(['foundry-local']);

/**
 * Which roles this wire carries inside `messages`.
 *
 * The OpenAI dialect takes the system prompt as a message like any other
 * (no separate top-level `system` field), so all three roles survive the
 * trip.
 */
const CARRIES_IN_MESSAGES: readonly WireRole[] = Object.freeze(['system', 'user', 'assistant']);

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Build an `LLMProvider` backed by an on-device Foundry Local service.
 *
 * Free, offline, no API key. The rung between `mock()` and a paid API on
 * a machine where Foundry Local is the local runtime — and the agent
 * code above it does not change between the three.
 *
 * @example
 *   import { Agent } from 'agentfootprint';
 *   import { foundryLocal } from 'agentfootprint/providers';
 *
 *   const agent = Agent.create({
 *     provider: foundryLocal('qwen2.5-0.5b'),
 *     model: 'qwen2.5-0.5b',
 *   }).build();
 *
 * @example  // the service on its real (dynamic) port, via the SDK's manager
 *   foundryLocal('phi-3.5-mini', { manager });
 *
 * @example  // a pinned port on another machine
 *   foundryLocal('qwen2.5-0.5b', { endpoint: 'http://192.168.1.20:5272' });
 */
export function foundryLocal(model: string, options?: FoundryLocalProviderOptions): LLMProvider;
/**
 * Object form, matching the shape every sibling factory accepts.
 * `defaultModel` names the model; everything else keeps its meaning.
 */
export function foundryLocal(options?: FoundryLocalProviderOptions): LLMProvider;
export function foundryLocal(
  modelOrOptions?: string | FoundryLocalProviderOptions,
  maybeOptions?: FoundryLocalProviderOptions,
): LLMProvider {
  const options: FoundryLocalProviderOptions =
    typeof modelOrOptions === 'string' ? maybeOptions ?? {} : modelOrOptions ?? {};
  const positionalModel = typeof modelOrOptions === 'string' ? modelOrOptions : undefined;

  const endpoint = resolveEndpoint(options);
  const defaultModel = positionalModel ?? options.defaultModel ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options._fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const chatUrl = `${endpoint}/v1/chat/completions`;

  const cfg: BuildConfig = {
    defaultModel,
    ...(options.defaultMaxTokens !== undefined && { defaultMaxTokens: options.defaultMaxTokens }),
  };

  // Tool-call ids are synthesized per provider instance — the dialect says
  // every call carries one, small local models sometimes disagree, and the
  // whole tool round-trip in this library is keyed by id.
  let toolCallSeq = 0;
  const nextToolCallId = (): string => `foundry-call-${++toolCallSeq}`;

  // Alias → variant-id resolutions, cached per provider instance — HIT OR
  // MISS. The catalog does not change under a running service often enough
  // to be worth re-asking on every call, and the cache is what keeps an
  // alias-configured agent at one catalog fetch per process. Caching the
  // FALLBACK too is what keeps that promise true when the catalog has no
  // answer for the alias.
  const resolutionCache = new Map<string, string>();

  /**
   * REST chat calls take the FULL variant id, so an alias must be
   * resolved first:
   *
   *   • A name already shaped like a variant id (it ends in the
   *     execution-provider suffix `-cpu`/`-gpu`/`-npu`, optionally
   *     `:version`) is used AS-IS — no catalog round-trip. That suffix is
   *     how Foundry Local itself distinguishes a variant from an alias.
   *   • Anything else is treated as an alias: `GET /foundry/list`, first
   *     variant whose alias matches wins (the list's order is the
   *     service's priority order), and the answer is cached.
   *   • A silent or alias-less catalog resolves to the name UNCHANGED —
   *     the chat call's own 404 then reports honestly, with the model
   *     name the caller actually wrote. A failed lookup must never
   *     replace the error that was coming anyway. That fallback is CACHED
   *     exactly like a success: ONE catalog attempt per name per provider,
   *     so an alias the service has no answer for cannot put a
   *     `/foundry/list` round-trip — and, against a host that accepts but
   *     never answers, a whole `timeoutMs` — in front of every single
   *     call. A model pulled with `foundry model run` after the fact is
   *     picked up by a FRESH provider; that is the retry.
   */
  const resolveModel = async (requested: string): Promise<string> => {
    const named = MODEL_SHORTHANDS.has(requested) ? cfg.defaultModel : requested;
    if (looksLikeVariantId(named)) return named;
    const cached = resolutionCache.get(named);
    if (cached !== undefined) return cached;
    const catalog = await fetchJsonBounded(fetchImpl, `${endpoint}/foundry/list`, timeoutMs);
    // The fallback is cached like an answer, so the catalog is asked once
    // per name whatever it says. A fresh provider re-asks.
    const answer = firstVariantForAlias(catalog, named) ?? named;
    resolutionCache.set(named, answer);
    return answer;
  };

  const post = async (body: FoundryChatRequest, req: LLMRequest): Promise<Response> => {
    // No Authorization header: no key exists on this wire, and nothing is
    // sent where a secret could be invented, logged, or leaked.
    const response = await fetchUntilHeaders(
      fetchImpl,
      chatUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { timeoutMs, endpoint, ...(req.signal && { signal: req.signal }) },
    );
    if (!response.ok) {
      throw await describeFailure(response, body.model, endpoint, fetchImpl, timeoutMs);
    }
    return response;
  };

  const provider: LLMProvider = {
    name: 'foundry-local',
    carriesInMessages: CARRIES_IN_MESSAGES,
    // `tool_choice` support is undocumented on this wire. Absence would mean
    // the same thing; saying it out loud documents that this was checked
    // rather than forgotten. See the header's ceilings.
    carriesForcedToolChoice: false,

    async complete(req: LLMRequest): Promise<LLMResponse> {
      // A signal that fired BEFORE the call stops it here, before any socket
      // opens — the catalog lookup included. An already-aborted signal never
      // dispatches another 'abort' event, so a listener alone cannot see it.
      throwIfAborted(req.signal);
      const model = await resolveModel(req.model);
      const body = buildBody(req, cfg, model, false);
      const response = await post(body, req);
      // `fetch` resolves on HEADERS, so reading the body is the stretch where
      // a caller abort would otherwise be inert — honor it for that too.
      const json = (await untilAborted(response.json(), req.signal)) as FoundryChatResponse;
      return fromFoundryResponse(json, nextToolCallId);
    },

    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      throwIfAborted(req.signal);
      const model = await resolveModel(req.model);
      const body = buildBody(req, cfg, model, true);
      const response = await post(body, req);
      if (!response.body) throw new Error('[foundry-local] response has no body');

      const textParts: string[] = [];
      // The dialect streams tool calls as DELTAS — id and name on the first
      // fragment, argument JSON split across the rest — assembled by index.
      const toolCallsByIndex = new Map<number, { id: string; name: string; argsJson: string }>();
      let finishReason: string | null = null;
      let usage: FoundryWireUsage | undefined;
      let lastId = '';
      let tokenIndex = 0;

      // The signal rides INTO the parser: it is what stops a generation the
      // caller no longer wants, and what cancels the body when it does.
      for await (const parsed of parseSse(response.body, req.signal)) {
        const frame = parsed.data as FoundryStreamChunk;
        // An already-200 stream can still FAIL mid-generation, and this
        // dialect says so IN BAND. Such a frame carries no `choices`, so the
        // guard below would drop it and the terminal chunk would report a
        // truncated answer as `stopReason: 'stop'` with nobody told. Raise
        // instead: a failed generation is a failure, never a shorter answer.
        const failure = frameFailureText(parsed);
        if (failure) {
          throw providerError(`[foundry-local] the stream failed mid-generation — ${failure}`);
        }
        // Usage FIRST, and OUTSIDE the choice guard. With
        // `stream_options.include_usage` (set in buildBody) the token counts
        // ride a FINAL chunk whose `choices` array is EMPTY — the exact bug
        // class 9.73.0 fixed in the OpenAI adapter: a `continue` on a missing
        // choice threw away the only usage the stream ever reports, and every
        // streamed local call read zero tokens everywhere usage is consumed.
        if (frame.id) lastId = frame.id;
        if (frame.usage) usage = frame.usage;
        const choice = frame.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta;
        if (!delta) continue;
        if (delta.content) {
          textParts.push(delta.content);
          yield { tokenIndex, content: delta.content, done: false };
          tokenIndex++;
        }
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index ?? 0;
            const existing = toolCallsByIndex.get(idx) ?? { id: '', name: '', argsJson: '' };
            if (tcDelta.id) existing.id = tcDelta.id;
            if (tcDelta.function?.name) existing.name = tcDelta.function.name;
            if (tcDelta.function?.arguments) existing.argsJson += tcDelta.function.arguments;
            toolCallsByIndex.set(idx, existing);
          }
        }
      }

      // Sorted by INDEX, not by first-seen order: a wire is free to open
      // index 1 before index 0, and a consumer reading `toolCalls[0]` as
      // "the first tool the model asked for" would then name the wrong one.
      const toolCalls = Array.from(toolCallsByIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
          id: tc.id.length > 0 ? tc.id : nextToolCallId(),
          name: tc.name,
          args: coerceArgs(tc.argsJson),
        }));
      const authoritative: LLMResponse = {
        content: textParts.join(''),
        toolCalls,
        usage: {
          input: usage?.prompt_tokens ?? 0,
          output: usage?.completion_tokens ?? 0,
        },
        stopReason: normalizeStopReason(finishReason ?? 'stop', toolCalls.length > 0),
        ...(lastId && { providerRef: lastId }),
      };
      yield { tokenIndex, content: '', done: true, response: authoritative };
    },
  };

  return provider;
}

/**
 * Class form for consumers who prefer `new FoundryLocalProvider(...)`.
 */
export class FoundryLocalProvider implements LLMProvider {
  readonly name = 'foundry-local';
  readonly carriesInMessages = CARRIES_IN_MESSAGES;
  readonly carriesForcedToolChoice = false;
  private readonly inner: LLMProvider;

  constructor(
    model?: string | FoundryLocalProviderOptions,
    options?: FoundryLocalProviderOptions,
  ) {
    this.inner =
      typeof model === 'string'
        ? foundryLocal(model, options)
        : foundryLocal(model as FoundryLocalProviderOptions);
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
 * Resolve where the service lives. Most specific wins: an explicit
 * `endpoint`, then a duck-typed SDK manager's discovered URL, then the
 * two env spellings, then the docs' example port.
 *
 * A `/v1` suffix is trimmed rather than rejected — someone copying the
 * chat URL out of `foundry server status` output means the same
 * machine — and a bare `host:port` gets `http://`.
 */
function resolveEndpoint(options: FoundryLocalProviderOptions): string {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const raw =
    firstConfigured(
      options.endpoint,
      options.manager?.urls?.[0],
      env?.FOUNDRY_LOCAL_ENDPOINT,
      env?.FOUNDRY_LOCAL_BASE_URL,
    ) ?? DEFAULT_ENDPOINT;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

/**
 * First candidate that actually says something.
 *
 * A blank value is treated as ABSENT rather than as an endpoint. `??` would
 * accept `''`, and `'' → 'http://' → strip trailing slashes` leaves the URL
 * `http:` — a refusal naming nothing the reader can check or fix. An env key
 * present with an empty value is a config that forgot to fill it in, so the
 * next candidate (and ultimately the default) gets its turn.
 */
function firstConfigured(...candidates: (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  return undefined;
}

/**
 * Does this name already carry a variant's shape?
 *
 * Full Foundry Local variant ids name their execution provider as the
 * terminal segment — `-cpu`, `-gpu` or `-npu`, optionally followed by a
 * `:version` — e.g. `qwen2.5-0.5b-instruct-generic-cpu:1`. Aliases never
 * do. This structural fact is what lets a fully-qualified id skip the
 * catalog round-trip entirely.
 */
function looksLikeVariantId(model: string): boolean {
  const bare = model.replace(/:\d+$/, '');
  return /-(cpu|gpu|npu)$/i.test(bare);
}

/**
 * First catalog variant whose alias matches — `/foundry/list` order is
 * the service's priority order, so first wins. Tolerates both a bare
 * array and a `{ models: [...] }` wrapper, and both id spellings.
 */
function firstVariantForAlias(catalog: unknown, alias: string): string | undefined {
  const entries: unknown = Array.isArray(catalog)
    ? catalog
    : (catalog as { models?: unknown } | null | undefined)?.models;
  if (!Array.isArray(entries)) return undefined;
  for (const raw of entries) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as FoundryCatalogEntry;
    if (entry.alias !== alias) continue;
    const id = entry.name ?? entry.id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return undefined;
}

interface BuildConfig {
  readonly defaultModel: string;
  readonly defaultMaxTokens?: number;
}

function buildBody(
  req: LLMRequest,
  cfg: BuildConfig,
  model: string,
  stream: boolean,
): FoundryChatRequest {
  const body: FoundryChatRequest = {
    model,
    messages: toFoundryMessages(req.messages, req.systemPrompt),
    stream,
  };
  // Always ask for usage on a stream. This wire is a documented Foundry
  // Local surface, not an arbitrary OpenAI-compatible server, so the
  // reject-unknown-field caution that cost `openai({ baseURL })` its token
  // counts (fixed in 9.73.0) has no purchase here — and a streamed call
  // that reports zero tokens silently disarms `.compaction()` and budgets.
  if (stream) body.stream_options = { include_usage: true };
  if (req.tools && req.tools.length > 0) body.tools = req.tools.map(toFoundryTool);

  const maxTokens = req.maxTokens ?? cfg.defaultMaxTokens;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) body.stop = [...req.stop];

  // `req.toolChoice` is intentionally NOT translated: support for it is
  // undocumented on this wire, `carriesForcedToolChoice` says so, and the
  // agent refuses before it ever reaches here.
  return body;
}

/**
 * messages → wire messages.
 *
 * Roles map 1:1. The system prompt is prepended as an ordinary `system`
 * message (this dialect has no separate system field). Assistant turns
 * carry their `tool_calls` back — arguments re-serialized to the JSON
 * STRING the dialect expects — and tool results carry `tool_call_id`,
 * which is how this wire correlates a result with the call that asked
 * for it. A role the port does not define is dropped, not forwarded
 * blindly.
 */
function toFoundryMessages(
  messages: readonly LLMMessage[],
  systemPrompt: string | undefined,
): FoundryWireMessage[] {
  const result: FoundryWireMessage[] = [];
  if (systemPrompt) result.push({ role: 'system', content: systemPrompt });

  for (const m of messages) {
    if (m.role === 'system' || m.role === 'user') {
      result.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const msg: FoundryWireMessage = { role: 'assistant', content: m.content };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
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
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
      });
      continue;
    }
  }
  return result;
}

function toFoundryTool(schema: LLMToolSchema): FoundryWireTool {
  return {
    type: 'function',
    function: {
      name: schema.name,
      description: schema.description,
      parameters: { ...schema.inputSchema },
    },
  };
}

/**
 * Wire response → the port's shape.
 *
 * @throws a `FoundryLocalProviderError` when the 200 body is really a
 *   failure (`{"error": ...}`). Reading it as a response would yield empty
 *   content with `stopReason: 'stop'` and zero tokens — a failed call
 *   dressed as a successful one.
 */
function fromFoundryResponse(
  response: FoundryChatResponse,
  nextToolCallId: () => string,
): LLMResponse {
  if (response.error !== undefined && response.error !== null) {
    const detail = extractErrorPayload(response.error) || 'the service named no reason';
    throw providerError(`[foundry-local] the service answered 200 with an error — ${detail}`);
  }
  const choice = response.choices?.[0];
  const message = choice?.message;
  const wireToolCalls = message?.tool_calls ?? [];
  const toolCalls = wireToolCalls.map((tc) => toLLMToolCall(tc, nextToolCallId));
  return {
    content: message?.content ?? '',
    toolCalls,
    usage: {
      input: response.usage?.prompt_tokens ?? 0,
      output: response.usage?.completion_tokens ?? 0,
    },
    stopReason: normalizeStopReason(choice?.finish_reason ?? 'stop', toolCalls.length > 0),
    ...(response.id && { providerRef: response.id }),
  };
}

/**
 * One wire tool call → the port's shape.
 *
 * Two wire facts handled here:
 *   • `id` should always be present on this dialect, but small local
 *     models have been seen to omit it — and the whole tool round-trip
 *     in this library is keyed by id. So an id is SYNTHESIZED when
 *     missing, unique per provider instance.
 *   • `arguments` is a JSON STRING per the dialect (Ollama sends an
 *     object); the object form is still tolerated in case a proxy in the
 *     middle reshaped it.
 */
function toLLMToolCall(
  tc: FoundryWireToolCallIn,
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
 * `finish_reason` → the port's stop vocabulary.
 *
 * `tool_calls` is the dialect's own word for a tool-ending turn, but a
 * local model has been seen to report plain `stop` with tool calls
 * attached — so the presence of tool calls also decides, the same
 * correction the Ollama adapter makes.
 */
function normalizeStopReason(raw: string, hasToolCalls: boolean): string {
  if (hasToolCalls && (raw === 'stop' || raw === '')) return 'tool_use';
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

/**
 * Parse an SSE body — `data: {...}` lines, one JSON payload each, each
 * carrying its frame's `event:` name when it had one.
 *
 * The same discipline as the Ollama adapter's NDJSON parser, adapted to
 * SSE: a cross-read buffer so a frame split anywhere (even mid-byte
 * sequence — TextDecoder streams) reassembles; a malformed line is
 * SKIPPED, never fatal; comments and every other field are ignored; and
 * the `[DONE]` sentinel ends the stream, so anything a broken server
 * writes after it never reaches a consumer.
 *
 * Two things here that a plain SSE reader would not do, both because the
 * other end is a model on THIS machine: the `event:` name survives (it is
 * one of the two ways this dialect spells a mid-generation failure), and
 * the caller's `signal` both interrupts the read and CANCELS the body —
 * a generation nobody is reading still occupies the GPU.
 */
async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let eventName: string | undefined;
  try {
    for (;;) {
      // The read is RACED against the caller's signal. `fetch` resolved on
      // headers, so this loop is the whole rest of the call — a signal that
      // only reached the headers would be a cancellation that cancels nothing.
      const { value, done } = await untilAborted(reader.read(), signal);
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); // trim eats the \r of a \r\n wire
        buf = buf.slice(idx + 1);
        if (line.length === 0) {
          eventName = undefined; // the blank line ends a frame
          continue;
        }
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim();
          continue;
        }
        if (!line.startsWith('data:')) continue;
        const payload = line.slice('data:'.length).trim();
        if (payload === '[DONE]') return;
        let data: unknown;
        try {
          data = JSON.parse(payload);
        } catch {
          /* skip malformed line */
          eventName = undefined;
          continue;
        }
        yield { ...(eventName !== undefined && { event: eventName }), data };
        eventName = undefined;
      }
    }
    // A final data line with no trailing newline still counts.
    const tail = buf.trim();
    if (tail.startsWith('data:')) {
      const payload = tail.slice('data:'.length).trim();
      if (payload !== '[DONE]') {
        let data: unknown;
        try {
          data = JSON.parse(payload);
        } catch {
          return; // skip a malformed tail — there is nothing after it anyway
        }
        yield { ...(eventName !== undefined && { event: eventName }), data };
      }
    }
  } finally {
    // CANCEL, not merely release the lock. `[DONE]`, a consumer that breaks
    // out of the loop, an error frame, a caller abort — every one of them
    // leaves an open body, and an open body means the on-device model keeps
    // generating for nobody and the socket stays up.
    try {
      await reader.cancel();
    } catch {
      /* already closed or errored — nothing left to close */
    }
    try {
      reader.releaseLock();
    } catch {
      /* a lock the runtime already dropped */
    }
  }
}

/**
 * POST, but never hang waiting for a service that is not there.
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
 * abort is re-thrown as an abort rather than blamed on the service —
 * including a signal that was ALREADY aborted when the call was made, which
 * never dispatches an event for a listener to hear.
 */
async function fetchUntilHeaders(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; endpoint: string; signal?: AbortSignal },
): Promise<Response> {
  // An already-aborted signal never dispatches another 'abort' event, so the
  // bridge below could not fire and the request would go out on a turn the
  // caller has cancelled. Refuse before the socket opens, and refuse with the
  // caller's own reason: an abort is their call, never a service fault.
  throwIfAborted(opts.signal);
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onCallerAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true });

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        new FoundryLocalUnavailableError({
          reason: 'service-unreachable',
          endpoint: opts.endpoint,
        }),
      );
    }, opts.timeoutMs);
  });

  try {
    return await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), deadline]);
  } catch (err) {
    if (err instanceof FoundryLocalUnavailableError) throw err; // the deadline fired
    if (opts.signal?.aborted && !timedOut) throw err; // the caller's call, not ours
    // Timed out, or connection refused / DNS failure / TLS failure — either
    // way, nothing answered at that endpoint. The original is preserved as
    // `cause` for anyone who wants it — just never in the message.
    throw new FoundryLocalUnavailableError({
      reason: 'service-unreachable',
      endpoint: opts.endpoint,
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
 * Best-effort GET-and-parse, bounded the same way the main POST is.
 *
 * Used for the two side lookups (`/foundry/list`, `/openai/models`),
 * where the answer improves an outcome but its absence must never worsen
 * one. Any failure — non-2xx, bad JSON, a fetch that hangs past the
 * deadline — resolves to `undefined`; the race (not just the abort)
 * keeps the "never hangs" promise even against a fetch implementation
 * that ignores its signal.
 */
async function fetchJsonBounded(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(undefined);
    }, timeoutMs);
  });
  const attempt = (async (): Promise<unknown> => {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    return (await response.json()) as unknown;
  })();
  try {
    return await Promise.race([attempt, deadline]);
  } catch {
    // Best-effort lookup. Its failure must never replace the error the
    // caller is on the way to reporting.
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // If the deadline won, the losing attempt may still reject later with
    // nobody listening — swallow that deliberately.
    attempt.catch(() => undefined);
  }
}

/**
 * Turn a non-2xx into the most actionable error available.
 *
 * A 404 from chat means the model is not on this service. Before saying
 * so we ask `/openai/models` — a cheap local call — so the message can
 * also name what IS cached here, which is usually enough to spot a typo.
 * If that lookup fails too, the `foundry model run` instruction stands
 * on its own.
 *
 * A 404 whose body does not speak this dialect's `{"error": ...}` may not
 * be a model 404 at all — the endpoint may point at something that is not
 * Foundry Local's chat route. The refusal still names the model command
 * (guessing the other way would be just as confident and just as wrong),
 * but it also names the endpoint as a suspect instead of pretending to know.
 */
async function describeFailure(
  response: Response,
  model: string,
  endpoint: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Error> {
  const bodyText = await safeText(response);
  if (response.status === 404) {
    const availableModels = await listCachedModels(fetchImpl, endpoint, timeoutMs);
    return new FoundryLocalUnavailableError({
      reason: 'model-not-available',
      endpoint,
      model,
      ...(availableModels && { availableModels }),
      ...(speaksDialectError(bodyText) ? {} : { routeUnconfirmed: true }),
    });
  }
  const detail = extractErrorText(bodyText);
  const said = detail ? ` — ${detail}` : '';
  return providerError(
    `[foundry-local] ${response.status} ${response.statusText}${said}`.trim(),
    response.status,
  );
}

/** `GET /openai/models` — a bare JSON array of cached model names. */
async function listCachedModels(
  fetchImpl: typeof fetch,
  endpoint: string,
  timeoutMs: number,
): Promise<readonly string[] | undefined> {
  const json = await fetchJsonBounded(fetchImpl, `${endpoint}/openai/models`, timeoutMs);
  if (!Array.isArray(json)) return undefined;
  const names = json.filter((n): n is string => typeof n === 'string' && n.length > 0);
  return names.length > 0 ? names : undefined;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Errors are `{"error": {"message": "..."}}` per the OpenAI dialect; a
 * bare `{"error": "..."}` string and raw text are tolerated. Every path
 * is capped at 200 chars — the wire's words help diagnose, but a server
 * echoing something enormous (or poisoned) must not become the message.
 */
function extractErrorText(bodyText: string): string {
  if (!bodyText) return '';
  try {
    const parsed = JSON.parse(bodyText) as FoundryErrorBody;
    const detail = extractErrorPayload(parsed.error);
    if (detail) return detail;
  } catch {
    /* not JSON — fall through */
  }
  return bodyText.slice(0, ERROR_TEXT_CAP);
}

/**
 * Did this body speak the dialect's `{"error": ...}`?
 *
 * The one fact {@link describeFailure} needs to tell a model 404 from a 404
 * that is really "this route is not ours".
 */
function speaksDialectError(bodyText: string): boolean {
  if (!bodyText) return false;
  try {
    const parsed = JSON.parse(bodyText) as FoundryErrorBody;
    return parsed.error !== undefined && parsed.error !== null;
  } catch {
    return false;
  }
}

/**
 * The words out of an `error` payload — `{"message": "..."}` per the
 * dialect, a bare string tolerated — capped like every other piece of wire
 * text this file repeats. Empty when there is nothing usable to say, so a
 * caller can tell "no error" from "an error that named no reason".
 */
function extractErrorPayload(err: unknown): string {
  if (typeof err === 'string') return err.slice(0, ERROR_TEXT_CAP);
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message.slice(0, ERROR_TEXT_CAP);
    }
  }
  return '';
}

/**
 * What a mid-stream frame says went wrong — '' when nothing did.
 *
 * Two spellings on this dialect: a `data:` frame carrying `error`, and an
 * `event: error` frame whose payload names the failure at the top level.
 * Both mean the generation failed; neither carries `choices`, which is
 * exactly why an unchecked one looks like an ordinary skippable frame.
 */
function frameFailureText(frame: SseFrame): string {
  const data =
    typeof frame.data === 'object' && frame.data !== null
      ? (frame.data as { error?: unknown; message?: unknown })
      : undefined;
  const carriesError = data?.error !== undefined && data?.error !== null;
  const isErrorEvent = frame.event === 'error';
  if (!carriesError && !isErrorEvent) return '';
  const detail =
    (carriesError ? extractErrorPayload(data?.error) : '') ||
    (typeof data?.message === 'string' ? data.message.slice(0, ERROR_TEXT_CAP) : '');
  return detail || 'the service reported an error but named no reason';
}

/**
 * The provider's own labelled error — one shape for every failure that is
 * not one of the two typed, actionable ones.
 */
function providerError(message: string, status?: number): Error {
  return Object.assign(new Error(message), {
    name: 'FoundryLocalProviderError',
    ...(status !== undefined && { status }),
  });
}

/**
 * An abort is the CALLER's word, so it must reach them AS an abort — never
 * dressed up as a service failure. The signal's own `reason` is used when it
 * is an Error (what every runtime supplies: a DOMException named
 * 'AbortError'); anything else becomes one, keeping the reason as `cause`.
 */
function asAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return Object.assign(new Error('This operation was aborted'), {
    name: 'AbortError',
    ...(reason !== undefined && { cause: reason }),
  });
}

/** Stop right here when the caller's signal has already fired. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw asAbortError(signal.reason);
}

/**
 * `promise`, except that a caller abort ends the wait immediately.
 *
 * `fetch` resolves on HEADERS. Everything after that — a streamed body, a
 * large non-streaming JSON read — used to be deaf to the caller's signal, so
 * a cancelled turn kept the local model generating to completion. This is
 * what makes `LLMRequest.signal` honest for the whole call rather than only
 * until the headers land.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => undefined); // the abandoned work must not warn
    return Promise.reject(asAbortError(signal.reason));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(asAbortError(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}
