/**
 * GeminiProvider — wraps `@google/genai` as an `LLMProvider` (9.13.0).
 *
 * Pattern: Adapter (GoF) + Ports-and-Adapters (Cockburn 2005).
 * Role:    Outer ring — translates `LLMRequest`/`LLMResponse` to/from Google's
 *          `generateContent` API. Knows nothing about agents, recorders, or
 *          compositions.
 * Emits:   N/A — providers don't emit; recorders observe via Agent.
 *
 * ─── Two doors, one adapter ─────────────────────────────────────────
 *
 * The same SDK reaches two different services, and which one you get is a
 * property of the OPTIONS, not of a separate factory:
 *
 *   • **Vertex** — `gemini({ project, location })` builds
 *     `new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions })`.
 *     Auth is Application Default Credentials (env key file, gcloud user
 *     credentials, or the metadata server on GCE / Cloud Run / Agent Runtime).
 *     No API key exists on this path.
 *   • **Gemini API (AI Studio)** — `gemini({ apiKey })` builds
 *     `new GoogleGenAI({ apiKey })`. One key, no cloud project.
 *
 * Neither is guessed. The factory refuses at construction when it can resolve
 * neither a project nor a key, naming both doors — because the SDK's own
 * behaviour in that case is to WARN on stderr, construct anyway, and fail on
 * the first call, which reads like a network problem rather than a missing
 * setting.
 *
 * ─── Status, per door, because the doors differ ─────────────────────
 *
 * • **Vertex: field-validated.** An independent trial ran this adapter,
 *   unchanged since 9.13.0, against a live project through Application Default
 *   Credentials: a two-call tool loop on `gemini-2.5-flash` returning the
 *   expected answer with real token counts, and a stream delivering 10 content
 *   chunks that reconstructed exactly (FINDINGS "Part 1 — native Gemini on
 *   Vertex through ADC", "Part 2C"). `geminiEmbedder` passed on the same door.
 * • **Gemini API (AI Studio): NOT field-validated, and not for want of
 *   trying.** The trial's key-door calls never reached a model: the old
 *   default model answered 404 for a new account, and a current model answered
 *   429 for AI Studio prepayment, which is billing SEPARATE from the Google
 *   Cloud account's credit. What that door does with a funded key is
 *   untested here, which is why it has no default model.
 * • **Tool calling on a 3.x model: field-validated.** The signature round trip
 *   below was built from the trial's captured 400, and the same independent
 *   trial then re-ran it on live Vertex against the published fix
 *   (2026-08-14): `gemini-3.1-flash-lite` called a tool, the tool answered,
 *   the signature went back byte for byte, and the second model call
 *   completed with the right answer — two LLM calls, one tool execution, real
 *   token counts. What it does NOT cover is a signature attached to a TEXT
 *   part with no function call beside it; see below.
 *
 * ─── Why native, and not `openai({ baseURL })` ──────────────────────
 *
 * Google publishes an OpenAI-compatible endpoint, and it does work — for about
 * an hour. It authenticates with an OAuth access token that expires (9.29.0
 * gives `openai({ apiKey })` a callback form so a long-running process can
 * refresh one, which is a mitigation and not a fix); its
 * `tools.function.parameters` is **OpenAPI**, not JSON Schema, so `$ref` /
 * `oneOf` / `additionalProperties` diverge silently; unsupported parameters are
 * ignored rather than refused; and its documented response carries no cached-
 * or reasoning-token counts. This adapter exists because every one of those is
 * answerable on the native SDK: ADC refreshes itself, tools go over as JSON
 * Schema untranslated (`parametersJsonSchema`), a forced single tool is
 * expressible, and `usageMetadata` reports cached and thinking tokens as
 * separate numbers.
 *
 * A field trial measured both halves of that: the native path completed a call
 * after a forced credential expiry, while the compatible path returned HTTP 401
 * on an expired token (FINDINGS "Part 2B").
 *
 * ─── Thought signatures: the round trip a tool loop cannot skip ─────
 *
 * A current Gemini model does not merely PREFER its thought signature back —
 * it refuses the turn without it. An independent field trial on live GCP ran
 * `gemini-3.1-flash-lite` on Vertex through one ordinary tool loop: the first
 * call asked for the function, the tool ran, and the second call came back
 *
 *   400 INVALID_ARGUMENT — "Function call is missing a thought_signature in
 *   functionCall parts. This is required for tools to work correctly …"
 *
 * (FINDINGS "Failure 4"). The cost of that shape is what makes it worth this
 * paragraph: the failure lands AFTER the tool has already executed, so a
 * side-effecting tool has run and the answer is unreachable.
 *
 * So the signature is CARRIED, not dropped. `Part.thoughtSignature` (a base64
 * string on the installed @google/genai 2.16.0 `Part`) is read off the same
 * part as the `functionCall` it belongs to, parked on the port's neutral
 * `toolCalls[].providerMeta`, and written back onto the reconstructed
 * `functionCall` part on the next request — byte for byte, because a signature
 * is checked and not read. This is the same round trip the Anthropic adapter
 * does with signed thinking blocks, one field along: there the carrier is
 * `LLMMessage.thinkingBlocks[].signature`, here it is the tool call itself,
 * because that is where Google puts it.
 *
 * What that does NOT cover, said plainly: a signature attached to a TEXT part
 * of an answer with no function call. The port's assistant turn is a string,
 * and a string has nowhere to keep one. The trial's failure was the functionCall
 * shape; that shape is fixed here, and the other one is named rather than
 * quietly half-handled.
 *
 * ─── Limitations (stated, not discovered) ───────────────────────────
 *
 * • Multi-modal input/output NOT supported — `LLMMessage.content` is `string`,
 *   so this adapter sends and reads text parts only. Inline data, files and
 *   generated images are out of scope for the port as it stands.
 * • **Thought summaries are not requested.** `usage.thinking` is reported
 *   honestly from `thoughtsTokenCount`, and `req.thinking.budget` is threaded
 *   to `thinkingConfig.thinkingBudget` — but `includeThoughts` is deliberately
 *   left unset, so no `rawThinking` is produced and there is no Gemini
 *   `ThinkingHandler` in this release to normalize thought TEXT. Asking for
 *   content nothing can carry would be a leak, not a feature. Signature
 *   round-tripping (above) is a separate thing and does not need one.
 *   `thinkingConfig.thinkingLevel` has no field on `LLMRequest` and is
 *   likewise not sent.
 * • `responseJsonSchema` (native structured output) is NOT exposed; use
 *   `.outputSchema(...)`, which goes over as a forced tool — a shape this
 *   adapter DOES carry.
 * • Grounding tools (Google Search, code execution, URL context, MCP servers)
 *   are not exposed. `tools` carries function declarations only.
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
import { asContextWindowExceeded } from './contextWindow.js';
import {
  createGoogleGenAIClientResolver,
  resolveGoogleDoor,
  type GoogleDoor,
  type GoogleGenAIConnectionOptions,
} from './googleGenAI.js';

// ─── The @google/genai surface, duck-typed ──────────────────────────
//
// Structural, so the real SDK, a client shared with the rest of your app, or a
// test double all satisfy it without this package taking a hard type
// dependency on an optional peer. The double is `{ models: { … } }` and
// nothing else — which is exactly what the Google pin injects.

/** One `parts[]` entry. Only the members this adapter reads or writes. */
export interface GeminiPart {
  readonly text?: string;
  /** `true` on a thought-summary part. Never joined into visible content. */
  readonly thought?: boolean;
  /**
   * The model's opaque signature for the thinking behind THIS part — base64,
   * per `Part.thoughtSignature` on the installed @google/genai 2.16.0 surface.
   *
   * Read off a `functionCall` part and written back onto the same part on the
   * next request. Never parsed, never trimmed, never regenerated: the service
   * verifies it, so the only correct handling is byte-for-byte.
   */
  readonly thoughtSignature?: string;
  readonly functionCall?: {
    readonly id?: string;
    readonly name?: string;
    readonly args?: Record<string, unknown>;
  };
  readonly functionResponse?: {
    readonly id?: string;
    readonly name?: string;
    readonly response?: Record<string, unknown>;
  };
}

/** One conversation turn. Gemini's assistant role is spelled `'model'`. */
export interface GeminiContent {
  readonly role: 'user' | 'model';
  readonly parts: readonly GeminiPart[];
}

/** A `FunctionDeclaration`, JSON-Schema flavour. */
export interface GeminiFunctionDeclaration {
  readonly name: string;
  readonly description: string;
  /**
   * JSON Schema, passed through UNCHANGED. The sibling `parameters` field
   * takes OpenAPI instead and is never set here — sending both is what makes
   * an adapter's tool schemas quietly disagree with the ones it was given.
   */
  readonly parametersJsonSchema: Record<string, unknown>;
}

export interface GeminiGenerateConfig {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
  tools?: { functionDeclarations: GeminiFunctionDeclaration[] }[];
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE';
      allowedFunctionNames?: string[];
    };
  };
  thinkingConfig?: { thinkingBudget: number };
}

export interface GeminiGenerateParams {
  readonly model: string;
  readonly contents: readonly GeminiContent[];
  readonly config?: GeminiGenerateConfig;
}

export interface GeminiUsageMetadata {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly cachedContentTokenCount?: number;
  readonly thoughtsTokenCount?: number;
  readonly totalTokenCount?: number;
}

export interface GeminiCandidate {
  readonly content?: { readonly parts?: readonly GeminiPart[] };
  readonly finishReason?: string;
}

export interface GeminiGenerateResponse {
  readonly candidates?: readonly GeminiCandidate[];
  readonly usageMetadata?: GeminiUsageMetadata;
  readonly responseId?: string;
}

/**
 * The `models` namespace, narrowed to the two operations this adapter
 * dispatches.
 *
 * `countTokens` is deliberately ABSENT. It exists on the real namespace and it
 * would be an easy way to fill in a usage number the wire did not report —
 * which is precisely why it is not here. A count we asked for separately is not
 * what the call was billed for; see the streaming note on `stream()`.
 */
export interface GeminiModelsLike {
  generateContent(params: GeminiGenerateParams): Promise<GeminiGenerateResponse>;
  /** Note the double await: the SDK returns a PROMISE of an async generator. */
  generateContentStream(
    params: GeminiGenerateParams,
  ): Promise<AsyncIterable<GeminiGenerateResponse>>;
}

/** What `new GoogleGenAI(...)` gives us, narrowed to what we use. */
export interface GeminiClientLike {
  readonly models: GeminiModelsLike;
}

// ─── Adapter ────────────────────────────────────────────────────────

export interface GeminiProviderOptions extends GoogleGenAIConnectionOptions {
  /**
   * Default model used when `LLMRequest.model` is `'gemini'` (the shorthand).
   * A request naming a full model id wins.
   *
   * **Unset behaves differently per door, because the doors behave
   * differently.** On **Vertex** the shorthand resolves to
   * `'gemini-2.5-flash'`, which a live field trial ran end to end through ADC.
   * On the **Gemini API (AI Studio)** door the shorthand is REFUSED by name:
   * the same trial's key-door call to that exact model returned HTTP 404 —
   * *"no longer available to new users"* (FINDINGS "Failure 1") — and no model
   * could be proven working on that door at all, because the account's separate
   * AI Studio prepayment was empty (FINDINGS "Failure 2", a 429 on
   * `gemini-3.1-flash-lite`, which at least proves that id resolves there).
   *
   * Shipping a second silent default nobody has run would be this library
   * guessing on a service's behalf; the refusal names the door and the fix.
   */
  readonly defaultModel?: string;
  /** Default `maxOutputTokens` when the request doesn't set it. Optional. */
  readonly defaultMaxTokens?: number;
  /** @internal Pre-built client for testing. Skips the SDK import entirely. */
  readonly _client?: GeminiClientLike;
}

/**
 * Which roles this wire carries inside `contents`.
 *
 * `'system'` is ABSENT, and it is the wire's own rule: Gemini takes the system
 * prompt as `config.systemInstruction`, a field OUTSIDE the turn list, exactly
 * like Anthropic's top-level `system`. So this is an Anthropic-family wire, not
 * an OpenAI-family one, and a `slot: 'messages'` injection with
 * `role: 'system'` is refused at run start rather than silently dropped between
 * the recording and the request.
 */
const CARRIES_IN_MESSAGES: readonly WireRole[] = Object.freeze(['user', 'assistant']);

/**
 * The model asked for when the request says only `'gemini'` — **on Vertex**.
 *
 * Field-proven rather than assumed: an independent trial on live GCP completed
 * a real Vertex tool round trip on `gemini-2.5-flash` through Application
 * Default Credentials, two LLM calls and one tool execution (FINDINGS "Part 1 —
 * native Gemini on Vertex through ADC"). Google lists the model's retirement
 * for **October 16, 2026**, so this is a default with an expiry date, not a
 * recommendation — name a current model in `defaultModel` when you have one.
 *
 * There is deliberately NO sibling constant for the key door. See
 * {@link GeminiProviderOptions.defaultModel}.
 */
const DEFAULT_VERTEX_MODEL = 'gemini-2.5-flash';

/** The request-side shorthand that asks for whatever the door's default is. */
const MODEL_SHORTHAND = 'gemini';

/**
 * Prefix on a tool-call id THIS ADAPTER invented.
 *
 * `FunctionCall.id` is optional on Gemini's wire and is routinely absent —
 * Vertex omits it. Our `LLMResponse.toolCalls[].id` is not optional, because
 * the agent matches a tool RESULT back to its call by id, so one has to exist.
 * Inventing it is safe; sending it BACK is not — Gemini never issued it, and a
 * `functionResponse.id` the service does not recognise is a request field that
 * means nothing to the model. The prefix is how the return trip tells the two
 * apart without holding state across provider instances (a resumed run rebuilds
 * its history from a checkpoint, so state would not survive anyway).
 */
const SYNTHETIC_ID_PREFIX = 'gemini-call-';

/**
 * Build an `LLMProvider` backed by Gemini — on Vertex or on the Gemini API.
 *
 * @example  Vertex (Application Default Credentials)
 * ```ts
 * import { Agent } from 'agentfootprint';
 * import { gemini } from 'agentfootprint/providers';
 *
 * const agent = Agent.create({
 *   provider: gemini({ project: 'my-project', location: 'us-central1' }),
 *   model: 'gemini',
 * })
 *   .tool(weatherTool)
 *   .build();
 * ```
 *
 * @example  Gemini API (one key, no cloud project)
 * ```ts
 * const provider = gemini({ apiKey: process.env.GEMINI_API_KEY });
 * ```
 *
 * @throws at construction when neither a project nor an API key is resolvable,
 *         and when `@google/genai` is not installed.
 */
export function gemini(options: GeminiProviderOptions = {}): LLMProvider {
  // Eager, so a missing `@google/genai` and an unanswerable door are still
  // refused where the consumer typed `gemini(...)`. Under a callback key
  // there is nothing to build yet — see the resolver.
  const connect = createGoogleGenAIClientResolver<GeminiClientLike>(
    options,
    'gemini',
    options._client,
    true,
  );
  // A double talks to nobody, so its door comes from the options alone and
  // never from the ambient environment of whoever is running the tests.
  const door = resolveGoogleDoor(options, options._client === undefined);
  const defaultModel =
    options.defaultModel ?? (door === 'vertex' ? DEFAULT_VERTEX_MODEL : undefined);
  const defaultMaxTokens = options.defaultMaxTokens;

  // Ids are invented per PROVIDER INSTANCE, in call order — the same shape
  // `ollama()` uses, and for the same reason: the wire omits them.
  let toolCallSeq = 0;
  const nextToolCallId = (): string => `${SYNTHETIC_ID_PREFIX}${++toolCallSeq}`;

  // The ONE secret this adapter holds, so the ONE string its errors promise
  // never to print — see `wrapError`. Under a callback key the secret CHANGES,
  // so the string to redact is the one the failing call actually used, not the
  // one the options were built with.
  const wrap = (err: unknown, apiKey: string | undefined): Error => wrapError(err, apiKey);

  const provider: LLMProvider = {
    name: 'gemini',
    carriesInMessages: CARRIES_IN_MESSAGES,
    // Earned, not assumed: `toolConfig.functionCallingConfig` with
    // `mode: 'ANY'` and a single `allowedFunctionNames` entry constrains the
    // model to answer through exactly that function. Both doors of this
    // adapter speak the same field, so unlike the OpenAI-compatible path there
    // is no endpoint whose behaviour we would be promising on its behalf.
    carriesForcedToolChoice: true,

    async complete(req: LLMRequest): Promise<LLMResponse> {
      const params = buildParams(
        req,
        resolveModel(req.model, defaultModel, door),
        defaultMaxTokens,
      );
      // Resolved BEFORE the try so a lease failure carries no key to redact
      // that we would have had to guess at; the resolver's own refusals never
      // quote the credential.
      const lease = await connect();
      try {
        const response = await lease.client.models.generateContent(params);
        return fromGeminiResponse(response, nextToolCallId);
      } catch (err) {
        throw wrap(err, lease.apiKey);
      }
    },

    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const params = buildParams(
        req,
        resolveModel(req.model, defaultModel, door),
        defaultMaxTokens,
      );
      // One lease for the whole stream. A key that rotates mid-stream cannot
      // be applied to a socket that is already open — see the refresh boundary
      // in googleGenAI.ts.
      const lease = await connect();
      let stream: AsyncIterable<GeminiGenerateResponse>;
      try {
        // Two awaits, one call: `generateContentStream` answers with a PROMISE
        // of an async generator, so `for await` over the return value directly
        // iterates a promise and yields nothing.
        stream = await lease.client.models.generateContentStream(params);
      } catch (err) {
        throw wrap(err, lease.apiKey);
      }

      const textParts: string[] = [];
      // The PART, not just its `functionCall`: the thought signature is the
      // part's field, and a call collected without it is a call that cannot
      // go back (see the file header's Failure-4 note).
      const functionParts: GeminiPart[] = [];
      let usage: GeminiUsageMetadata | undefined;
      let finishReason: string | undefined;
      let responseId: string | undefined;
      let tokenIndex = 0;

      try {
        for await (const chunk of stream) {
          // Usage FIRST, and outside any content guard. Gemini puts
          // `usageMetadata` on the chunk that closes the stream, whose
          // candidate carries no new text — a `continue` on an empty part list
          // throws away the only token counts the stream ever reports, which is
          // the failure that made streamed turns bill as zero on two other
          // adapters before this one.
          if (chunk.usageMetadata) usage = chunk.usageMetadata;
          if (chunk.responseId) responseId = chunk.responseId;
          const candidate = chunk.candidates?.[0];
          if (candidate?.finishReason) finishReason = candidate.finishReason;
          for (const part of candidate?.content?.parts ?? []) {
            if (part.functionCall) functionParts.push(part);
            // A thought-summary part is not visible content and is never
            // streamed as one. Nothing asks for them today (see the file
            // header); the guard is here so that a model that volunteers one
            // cannot leak reasoning into the answer.
            if (part.thought) continue;
            if (part.text) {
              textParts.push(part.text);
              yield { tokenIndex, content: part.text, done: false };
              tokenIndex++;
            }
          }
        }

        const toolCalls = functionParts.map((part) => toLLMToolCall(part, nextToolCallId));
        const response: LLMResponse = {
          content: textParts.join(''),
          toolCalls,
          // What the wire said, and nothing else. When a stream reports no
          // usage at all these are zero rather than an estimate: `countTokens`
          // would answer a DIFFERENT question (what a request tokenises to)
          // from the one a cost meter is asking (what this call was billed
          // for), and a plausible number in the right range is worse than a
          // zero somebody can see. Same law as `openai()` and `ollama()`.
          usage: toUsage(usage),
          stopReason: normalizeStopReason(finishReason, toolCalls.length > 0),
          ...(responseId !== undefined && { providerRef: responseId }),
        };
        yield { tokenIndex, content: '', done: true, response };
      } catch (err) {
        throw wrap(err, lease.apiKey);
      }
    },
  };

  return provider;
}

/**
 * The model this request is for — and the ONE refusal the doors do not share.
 *
 * A request naming a model wins, always. The shorthand `'gemini'` resolves to
 * the door's default, and the Gemini API door HAS no default (see
 * {@link GeminiProviderOptions.defaultModel}): the one this package used to
 * send was measured returning HTTP 404 on that door for a new account.
 *
 * Refused here rather than at construction because a consumer who always names
 * a model never needs a default, and a factory that refused them at the call
 * site they typed would be charging everyone for a setting only some use.
 */
function resolveModel(
  requested: string,
  defaultModel: string | undefined,
  door: GoogleDoor,
): string {
  if (requested !== MODEL_SHORTHAND) return requested;
  if (defaultModel !== undefined) return defaultModel;
  throw new Error(
    `gemini: model 'gemini' is a shorthand for this door's default model, and the ` +
      `${door === 'vertex' ? 'Vertex' : 'Gemini API (AI Studio)'} door has no default.\n` +
      "  A live field trial called that door with this package's old default, " +
      "'gemini-2.5-flash', and Google answered 404: \"This model models/gemini-2.5-flash is no " +
      'longer available to new users." Sending it anyway would fail on YOUR first call, after ' +
      'the request was built and paid for in latency.\n' +
      "  Fix:  gemini({ apiKey, defaultModel: 'the-model-your-key-can-use' })\n" +
      "  Or:   name the model per call — Agent.create({ model: 'gemini-3.1-flash-lite' }).\n" +
      '  On VERTEX the shorthand still resolves — to gemini-2.5-flash, which the same trial ran ' +
      'end to end (Google retires it 2026-10-16).',
  );
}

/**
 * Class form for consumers who prefer `new GeminiProvider(...)` over the
 * `gemini(...)` factory. Identical behavior; trivial wrapper.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly carriesInMessages = CARRIES_IN_MESSAGES;
  readonly carriesForcedToolChoice = true;
  private readonly inner: LLMProvider;

  constructor(options: GeminiProviderOptions = {}) {
    this.inner = gemini(options);
  }

  // `hooks` is FORWARDED, not dropped — see LLMCallHooks in adapters/types.ts.
  complete(req: LLMRequest, hooks?: LLMCallHooks): Promise<LLMResponse> {
    return this.inner.complete(req, hooks);
  }

  stream(req: LLMRequest, hooks?: LLMCallHooks): AsyncIterable<LLMChunk> {
    if (!this.inner.stream) {
      throw new Error('stream() unavailable on inner provider');
    }
    return this.inner.stream(req, hooks);
  }
}

// ─── Internals ──────────────────────────────────────────────────────

function buildParams(
  req: LLMRequest,
  model: string,
  defaultMaxTokens: number | undefined,
): GeminiGenerateParams {
  const config: GeminiGenerateConfig = {};
  // The system prompt is a top-level field, not a turn — see
  // CARRIES_IN_MESSAGES.
  if (req.systemPrompt) config.systemInstruction = req.systemPrompt;
  if (req.temperature !== undefined) config.temperature = req.temperature;
  const maxTokens = req.maxTokens ?? defaultMaxTokens;
  if (maxTokens !== undefined) config.maxOutputTokens = maxTokens;
  if (req.stop && req.stop.length > 0) config.stopSequences = [...req.stop];
  // Threaded so an aborted run stops paying for tokens nobody is waiting for.
  if (req.signal) config.abortSignal = req.signal;
  if (req.tools && req.tools.length > 0) {
    config.tools = [{ functionDeclarations: req.tools.map(toGeminiFunctionDeclaration) }];
  }
  // A budget, and only a budget — `includeThoughts` and `thinkingLevel` are
  // deliberately not sent (see the file header). A budget of 0 is a real value
  // on this wire (it turns thinking off), so the guard is on presence.
  if (req.thinking) config.thinkingConfig = { thinkingBudget: req.thinking.budget };
  // Forced choice of ONE named function. Guarded on tools being present for
  // the same reason the Anthropic and OpenAI adapters guard: a tool choice
  // naming a function the request does not carry is a request that cannot be
  // served, and Gemini would refuse it.
  if (req.toolChoice && config.tools !== undefined) {
    config.toolConfig = {
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [req.toolChoice.name] },
    };
  }

  return {
    model,
    contents: toGeminiContents(req.messages),
    ...(Object.keys(config).length > 0 && { config }),
  };
}

/**
 * messages → Gemini `contents`.
 *
 * Key transforms:
 *   • `role: 'system'` is DROPPED — it rides `config.systemInstruction`.
 *   • `role: 'assistant'` becomes `role: 'model'`, with `toolCalls` restored as
 *     `functionCall` parts so a multi-turn tool conversation round-trips —
 *     each one carrying back the `thoughtSignature` it arrived with, which is
 *     what makes the SECOND call of a tool loop legal on a current model.
 *   • `role: 'tool'` becomes a `functionResponse` part inside a **user** turn,
 *     which is where Gemini expects results. Consecutive tool messages merge
 *     into ONE user turn, so a reply that called three tools is answered by one
 *     turn carrying three responses — the same coalescing the Anthropic adapter
 *     does with `tool_result` blocks.
 */
function toGeminiContents(messages: readonly LLMMessage[]): GeminiContent[] {
  const result: GeminiContent[] = [];

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'user') {
      result.push({ role: 'user', parts: [{ text: m.content }] });
      continue;
    }

    if (m.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        const signature = thoughtSignatureOf(tc.providerMeta);
        parts.push({
          // Back on the PART, exactly where it came from and byte for byte.
          // Absent when the model never sent one (a 2.5-series turn), because
          // an invented signature is worse than a missing one.
          ...(signature !== undefined && { thoughtSignature: signature }),
          functionCall: {
            // Only an id GEMINI issued goes back to Gemini — see
            // SYNTHETIC_ID_PREFIX.
            ...(isRealId(tc.id) && { id: tc.id }),
            name: tc.name,
            args: { ...tc.args },
          },
        });
      }
      // An assistant turn with neither text nor calls still has to occupy its
      // position, or the user/model alternation the wire expects breaks.
      result.push({ role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] });
      continue;
    }

    if (m.role === 'tool') {
      const part: GeminiPart = {
        functionResponse: {
          ...(isRealId(m.toolCallId) && { id: m.toolCallId }),
          // Gemini matches a response to its call BY NAME, so the name is the
          // load-bearing field here — not the id.
          name: m.toolName ?? '',
          // The wire takes an object, and a tool result in this library is a
          // string. `{ output }` is that string in the one field the model can
          // read, unwrapped; inventing a schema for it would make every tool
          // result a different shape.
          response: { output: m.content },
        },
      };
      const last = result[result.length - 1];
      if (last && last.role === 'user' && last.parts[0]?.functionResponse) {
        (last.parts as GeminiPart[]).push(part);
      } else {
        result.push({ role: 'user', parts: [part] });
      }
      continue;
    }
  }

  return result;
}

/** Did the SERVICE issue this id, or did we? */
function isRealId(id: string | undefined): id is string {
  return id !== undefined && id.length > 0 && !id.startsWith(SYNTHETIC_ID_PREFIX);
}

/** The key this adapter parks a thought signature under on `providerMeta`. */
const THOUGHT_SIGNATURE = 'thoughtSignature';

/**
 * A signature off the port's neutral metadata bag — or nothing.
 *
 * Shape-checked rather than trusted: `providerMeta` survives a checkpoint, a
 * `structuredClone` and whatever a consumer did to the history in between, and
 * a non-string in the `thoughtSignature` field would go on the wire as a
 * garbled signature, which the service rejects less clearly than a missing one.
 */
function thoughtSignatureOf(
  meta: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const raw = meta?.[THOUGHT_SIGNATURE];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/**
 * `LLMToolSchema` → `FunctionDeclaration`, with the schema untranslated.
 *
 * `parametersJsonSchema` is the whole reason this adapter exists rather than a
 * `baseURL` on the OpenAI one: it takes JSON Schema as JSON Schema. The
 * `parameters` field beside it takes an OpenAPI subset, where `$ref`,
 * `oneOf` and `additionalProperties` mean something else or nothing at all —
 * which is a divergence you only find out about from a model that ignored half
 * your constraints.
 */
function toGeminiFunctionDeclaration(schema: LLMToolSchema): GeminiFunctionDeclaration {
  return {
    name: schema.name,
    description: schema.description,
    parametersJsonSchema: { ...schema.inputSchema },
  };
}

function fromGeminiResponse(
  response: GeminiGenerateResponse,
  nextToolCallId: () => string,
): LLMResponse {
  const candidate = response.candidates?.[0];
  const textParts: string[] = [];
  const toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];

  for (const part of candidate?.content?.parts ?? []) {
    if (part.functionCall) toolCalls.push(toLLMToolCall(part, nextToolCallId));
    // Thought summaries are not the answer. See the header.
    if (part.thought) continue;
    if (part.text) textParts.push(part.text);
  }

  return {
    content: textParts.join(''),
    toolCalls,
    usage: toUsage(response.usageMetadata),
    stopReason: normalizeStopReason(candidate?.finishReason, toolCalls.length > 0),
    ...(response.responseId !== undefined && { providerRef: response.responseId }),
  };
}

/**
 * One `functionCall` PART → one port tool call, signature included.
 *
 * Takes the part rather than the `functionCall` because the two fields that
 * have to travel together live at different levels: the call is inside the
 * part, the signature is on it.
 */
function toLLMToolCall(
  part: GeminiPart,
  nextToolCallId: () => string,
): {
  id: string;
  name: string;
  args: Record<string, unknown>;
  providerMeta?: Record<string, unknown>;
} {
  const fc = part.functionCall ?? {};
  const signature = part.thoughtSignature;
  return {
    id: fc.id && fc.id.length > 0 ? fc.id : nextToolCallId(),
    name: fc.name ?? '',
    args: { ...(fc.args ?? {}) },
    // Only when there IS one. An empty bag on every tool call would be noise
    // in every recording, every checkpoint and every narrative line.
    ...(typeof signature === 'string' &&
      signature.length > 0 && { providerMeta: { [THOUGHT_SIGNATURE]: signature } }),
  };
}

/**
 * `usageMetadata` → the port's four numbers.
 *
 * This is the payoff of going native. `cachedContentTokenCount` and
 * `thoughtsTokenCount` are separate line items on Google's own wire, so
 * `usage.cacheRead` and `usage.thinking` are REPORTED rather than left
 * undefined — the OpenAI-compatible endpoint's documented response has neither
 * field, so a cost dashboard behind it can only ever show the total.
 *
 * `cacheWrite` stays undefined on purpose: Gemini's context caching is created
 * by a separate `caches.create` call that this adapter does not make, so there
 * is no write for a `generateContent` turn to report.
 *
 * **`output` does not include thinking on this wire, and that matters for
 * money.** A field trial's 256-token stream came back `input 21, output 9,
 * thinking 243` — 243 tokens that were spent, were billed, and appear in
 * neither `input` nor `output` (FINDINGS "Failure 5"). Anything adding
 * `input + output` to estimate a Gemini turn is under-counting by whatever the
 * model thought. `usage.thinking` is the number to add, and it now survives all
 * the way to `agentfootprint.stream.llm_end`.
 */
function toUsage(usage: GeminiUsageMetadata | undefined): LLMResponse['usage'] {
  return {
    input: usage?.promptTokenCount ?? 0,
    output: usage?.candidatesTokenCount ?? 0,
    ...(usage?.cachedContentTokenCount !== undefined && {
      cacheRead: usage.cachedContentTokenCount,
    }),
    ...(usage?.thoughtsTokenCount !== undefined && { thinking: usage.thoughtsTokenCount }),
  };
}

/**
 * `FinishReason` → agentfootprint's stop vocabulary.
 *
 * Two facts shape this. First, **Gemini has no `tool_use` finish reason**: a
 * turn that asks for a function still finishes `STOP`, so the presence of
 * function calls is what distinguishes it — the same correction `ollama()`
 * makes on its wire. Second, everything not listed passes through UNCHANGED,
 * in Google's own spelling. `RECITATION`, `MALFORMED_FUNCTION_CALL`,
 * `TOO_MANY_TOOL_CALLS` and the image-specific reasons are real answers with no
 * equivalent in this vocabulary, and mapping them onto the nearest word would
 * be this adapter guessing on the model's behalf.
 */
function normalizeStopReason(raw: string | undefined, hasToolCalls: boolean): string {
  if (hasToolCalls && (raw === undefined || raw === 'STOP' || raw === '')) return 'tool_use';
  switch (raw) {
    case undefined:
    case '':
      return 'stop';
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'max_tokens';
    // The four that are unmistakably a safety refusal rather than an ending.
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
    case 'SPII':
      return 'content_filter';
    default:
      return raw;
  }
}

/**
 * Vendor error → ours, with the key taken out.
 *
 * The prefix-and-rename half is the same as every other adapter's. The
 * REDACTION half is this adapter's alone, and it is narrow on purpose: the only
 * string removed is the literal API key this provider was constructed with, and
 * it is removed because a thrown provider error is handed to the model as a
 * tool result, written to the commit log, rendered in the narrative and
 * serialized by every attached recorder — one interpolation reaches all of them.
 *
 * This is not a heuristic scrubber and must never become one. It cannot know
 * about a secret it was not given, and a pattern that guessed at "things that
 * look like keys" would eventually delete the sentence that explains the
 * failure. What it guarantees is exactly what it can: the key YOU passed in
 * does not come back out, whoever put it in the message.
 */
function wrapError(err: unknown, apiKey?: string): Error {
  // See OpenAIProvider.wrapError — one shared detector, one typed error, so
  // "the request did not fit" reads the same whichever vendor said it. Google's
  // sentence is "The input token count (N) exceeds the maximum number of tokens
  // allowed (M)."; the phrase list in contextWindow.ts carries it.
  const tooBig = asContextWindowExceeded(err, { provider: 'gemini' });
  if (tooBig) return redactKey(tooBig, apiKey);
  if (err instanceof Error) {
    return redactKey(
      Object.assign(new Error(`[gemini] ${redact(err.message, apiKey)}`), {
        name: 'GeminiProviderError',
        cause: err,
        // `ApiError` from @google/genai carries `status`; withRetry reads it.
        status: (err as { status?: number }).status,
      }),
      apiKey,
    );
  }
  return new Error(`[gemini] ${redact(String(err), apiKey)}`);
}

/** A key short enough to be an accident is not redacted — replacing a two-
 *  character string everywhere would shred the message it appears in. */
function redact(text: string, apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.length < 8) return text;
  return text.split(apiKey).join('[redacted apiKey]');
}

/**
 * A `stack` is built from the message at construction, and a `cause` carries
 * the vendor's untouched original — both are printed by ordinary logging, so
 * neither may keep a copy of the key the message just gave up.
 */
function redactKey<E extends Error>(error: E, apiKey: string | undefined): E {
  if (apiKey === undefined || apiKey.length < 8) return error;
  if (typeof error.stack === 'string' && error.stack.includes(apiKey)) {
    error.stack = redact(error.stack, apiKey);
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    if (cause.message.includes(apiKey)) cause.message = redact(cause.message, apiKey);
    if (typeof cause.stack === 'string' && cause.stack.includes(apiKey)) {
      cause.stack = redact(cause.stack, apiKey);
    }
  }
  return error;
}
