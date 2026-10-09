/**
 * BrowserAnthropicProvider — fetch-based Anthropic adapter for browsers.
 *
 * Pattern: Adapter (GoF). Zero peer dependencies — uses global `fetch`.
 * Role:    Outer ring. Same `LLMProvider` contract as `AnthropicProvider`,
 *          but skips `@anthropic-ai/sdk` (which doesn't bundle cleanly
 *          for browser). Aimed at playgrounds / prototypes where the
 *          user supplies their own key.
 * Emits:   N/A.
 *
 * Anthropic requires the `anthropic-dangerous-direct-browser-access: true`
 * header for direct browser-to-API calls. This is intentional — production
 * apps should proxy through a backend.
 *
 * ─── Limitations ────────────────────────────────────────────────────
 *
 * • Multi-modal NOT supported.
 * • Browser CORS — works because Anthropic explicitly allows the
 *   dangerous-direct header. Future API changes could require a proxy.
 */

import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  WireRole,
} from '../types.js';
import { asContextWindowExceeded } from './contextWindow.js';
import { ANTHROPIC_PROMPT_CACHING } from './anthropicCacheWire.js';
import { thinkingModeWith } from './anthropicThinkingWire.js';
import { anthropicTakesForcedToolChoice } from './anthropicModels.js';
import { anthropicThinkingHandler } from '../../thinking/AnthropicThinkingHandler.js';
import type { ThinkingMode } from '../../thinking/types.js';
import {
  assembleAnthropicStream,
  buildMessagesBody,
  fromAnthropicResponse,
  type AnthropicMessage,
  type AnthropicMessagesBody,
  type AnthropicStreamEvent,
} from './anthropicMessagesWire.js';
import { toolManifestOf } from './wireManifest.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

// ─── Types (Anthropic API shapes) ──────────────────────────────────
//
// The Messages body, message/tool/response mapping and the stream assembly
// live in anthropicMessagesWire.ts (shared with invokeModelGateway, which puts
// the same body on a different transport). This adapter adds `model` + `stream`.

interface AnthropicRequestBody extends AnthropicMessagesBody {
  model: string;
  stream?: boolean;
}

// ─── Adapter ────────────────────────────────────────────────────────

export interface BrowserAnthropicProviderOptions {
  /** API key. REQUIRED — browser providers don't read env vars. */
  readonly apiKey: string;
  /** Default model when `LLMRequest.model` is `'anthropic'`. */
  readonly defaultModel?: string;
  /** Default max tokens. Default 4096. */
  readonly defaultMaxTokens?: number;
  /** Override the API URL (proxies, edge deployments, mocks). */
  readonly apiUrl?: string;
  /**
   * May the model ask for several tools at once in a single reply?
   * Mirror of `AnthropicProviderOptions.parallelToolCalls` — see there
   * for the full rationale.
   *
   * Anthropic's default is `true` (batching allowed). `false` caps the
   * model at one tool per reply, which keeps every tool result on its
   * own agent iteration so per-iteration analysis can attribute and
   * ablate each source separately. `true`/omitted sends nothing.
   *
   * @default undefined (Anthropic's default — batching allowed)
   */
  readonly parallelToolCalls?: boolean;
  /**
   * Which thinking request a model takes, where the built-in table is not
   * the answer you want — an id behind `apiUrl` it cannot read, or Opus 4.6 /
   * Sonnet 4.6 wanted adaptive. Return `undefined` to use the table. Mirror of
   * `AnthropicProviderOptions.thinkingMode` — see there.
   */
  readonly thinkingMode?: (model: string) => ThinkingMode | undefined;
  /** @internal Custom fetch implementation for tests / workers. */
  readonly _fetch?: typeof fetch;
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

export function browserAnthropic(options: BrowserAnthropicProviderOptions): LLMProvider {
  const apiKey = options.apiKey;
  if (!apiKey) {
    throw new Error(
      'BrowserAnthropicProvider requires `apiKey`. Browser providers do not read environment variables.',
    );
  }
  const apiUrl = options.apiUrl ?? ANTHROPIC_API_URL;
  const defaultModel = options.defaultModel ?? 'claude-sonnet-4-5-20250929';
  const defaultMaxTokens = options.defaultMaxTokens ?? 4096;
  const parallelToolCalls = options.parallelToolCalls;
  const fetchImpl = options._fetch ?? fetch;
  /** The ONE mode function: declared below and used for every body. */
  const modeOf = thinkingModeWith(options.thinkingMode);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  const provider: LLMProvider = {
    name: 'browser-anthropic',
    carriesInMessages: CARRIES_IN_MESSAGES,
    // Per model — the same table `buildMessagesBody` refuses from (anthropicModels.ts).
    carriesForcedToolChoice: (model) =>
      anthropicTakesForcedToolChoice(modelOf(model, defaultModel)),
    // The same body `anthropic()` builds — `buildMessagesBody` applies the
    // markers — so the same declaration (see anthropicCacheWire.ts).
    promptCaching: ANTHROPIC_PROMPT_CACHING,
    thinkingHandler: anthropicThinkingHandler,
    // …and the same per-model thinking shapes (anthropicThinkingWire.ts).
    thinkingMode: (model) => modeOf(modelOf(model, defaultModel)),
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const { body, thinkingBinding } = buildBody(
        req,
        defaultModel,
        defaultMaxTokens,
        modeOf,
        parallelToolCalls,
      );
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
      const json = (await response.json()) as AnthropicMessage;
      // Manifest read from the FINAL body — the very object JSON.stringify
      // sent — after every transform (wireManifest.ts).
      return {
        ...fromAnthropicResponse(json, thinkingBinding),
        wireManifest: toolManifestOf(body.tools),
      };
    },
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const built = buildBody(req, defaultModel, defaultMaxTokens, modeOf, parallelToolCalls);
      const body: AnthropicRequestBody = { ...built.body, stream: true };
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
      if (!response.body) throw new Error('[browser-anthropic] response has no body');

      // Malformed tool-argument JSON becomes `{}` here — this adapter's
      // behaviour since it shipped (the gateway adapter refuses instead).
      yield* assembleAnthropicStream(parseSSE(response.body), {
        wireManifest: toolManifestOf(body.tools),
        onMalformedToolArgs: () => ({}),
        ...(built.thinkingBinding !== undefined && { thinkingBinding: built.thinkingBinding }),
      });
    },
  };
  return provider;
}

export class BrowserAnthropicProvider implements LLMProvider {
  readonly name = 'browser-anthropic';
  readonly carriesInMessages = CARRIES_IN_MESSAGES;
  /** The inner provider's own function — per model, a closure, safe to forward unbound. */
  readonly carriesForcedToolChoice: (model: string) => boolean;
  readonly promptCaching = ANTHROPIC_PROMPT_CACHING;
  readonly thinkingHandler = anthropicThinkingHandler;
  /** The inner provider's own function — a closure, safe to forward unbound. */
  readonly thinkingMode: (model: string) => ThinkingMode;
  private readonly inner: LLMProvider;

  constructor(options: BrowserAnthropicProviderOptions) {
    this.inner = browserAnthropic(options);
    this.thinkingMode = this.inner.thinkingMode!;
    this.carriesForcedToolChoice = this.inner.carriesForcedToolChoice as (model: string) => boolean;
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

/** The model a request goes to — either shorthand is the default model. */
function modelOf(model: string, defaultModel: string): string {
  return model === 'anthropic' || model === 'browser-anthropic' ? defaultModel : model;
}

/** The request body, and the stamp the reply's thinking gets (a model that binds it). */
function buildBody(
  req: LLMRequest,
  defaultModel: string,
  defaultMaxTokens: number,
  thinkingMode: (model: string) => ThinkingMode,
  parallelToolCalls?: boolean,
): { readonly body: AnthropicRequestBody; readonly thinkingBinding?: string } {
  const model = modelOf(req.model, defaultModel);
  const { body, thinkingBinding } = buildMessagesBody(req, {
    model,
    thinkingMode,
    provider: 'browser-anthropic',
    maxTokensDefault: defaultMaxTokens,
    ...(parallelToolCalls !== undefined && { parallelToolCalls }),
  });
  // `model` first, then the shared Messages body (anthropicMessagesWire.ts).
  return { body: { model, ...body }, ...(thinkingBinding !== undefined && { thinkingBinding }) };
}

/** Parse Anthropic's SSE event stream from a fetch ReadableStream. */
async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<AnthropicStreamEvent> {
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
      // Events are separated by \n\n.
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        // Belt-and-suspenders: a malformed SSE chunk should not throw out of
        // the async generator and tear down the whole stream. v1 wrapped
        // this; an upstream proxy or a partial flush could in principle
        // produce a non-JSON `data:` line.
        let data: unknown = {};
        if (dataLines.length > 0) {
          try {
            data = JSON.parse(dataLines.join('\n'));
          } catch {
            data = {};
          }
        }
        yield { event, data };
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
  // Same as the browser OpenAI adapter: an HTTP refusal never reaches
  // `wrapError`, and the body is where "prompt is too long" is written.
  const tooBig = asContextWindowExceeded(new Error(bodyText), {
    provider: 'browser-anthropic',
    bodyText,
    status: response.status,
  });
  if (tooBig) return tooBig;
  return Object.assign(
    new Error(
      `[browser-anthropic] ${response.status} ${response.statusText} — ${bodyText.slice(0, 200)}`,
    ),
    {
      name: 'BrowserAnthropicProviderError',
      status: response.status,
    },
  );
}

function wrapError(err: unknown): Error {
  const tooBig = asContextWindowExceeded(err, { provider: 'browser-anthropic' });
  if (tooBig) return tooBig;
  if (err instanceof Error) {
    return Object.assign(new Error(`[browser-anthropic] ${err.message}`), {
      name: 'BrowserAnthropicProviderError',
      cause: err,
    });
  }
  return new Error(`[browser-anthropic] ${String(err)}`);
}
