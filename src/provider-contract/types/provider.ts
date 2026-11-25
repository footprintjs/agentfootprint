import type { WireRole } from '../wireRole.js';
import type { LLMRequest } from './request.js';
import type { LLMChunk, LLMResponse } from './response.js';

/**
 * v7.8 — what a resilience decorator DID during one provider call.
 *
 * Plain data only (strings + numbers), so a report drops straight into a
 * typed event payload and survives `structuredClone`. Field names are
 * deliberately 1:1 with the declared event payloads
 * (`FallbackTriggeredPayload`, `ErrorRetriedPayload`,
 * `ErrorRecoveredPayload`) so the in-run call site maps a report to an
 * event without renaming or synthesizing anything.
 *
 * Produced by exactly one decorator per `kind`:
 *   • `'fell-back'` ← `withFallback`
 *   • `'retried'` / `'recovered'` ← `withRetry`
 *   • `'circuit-changed'` ← `withCircuitBreaker` (9.32.0)
 */
export type ResilienceReport =
  | {
      readonly kind: 'fell-back';
      /** Provider tried first, which failed. */
      readonly primary: string;
      /** Provider called instead — the one that actually served. */
      readonly fallback: string;
      /** Message of the error that triggered the fallback. */
      readonly reason: string;
    }
  | {
      readonly kind: 'retried';
      /** 1-based number of the attempt ABOUT TO START (2 = first retry). */
      readonly attempt: number;
      readonly maxAttempts: number;
      /** Message of the error that caused this retry. */
      readonly lastError: string;
      /** How long the decorator waits before the attempt — the stated wait when one won. */
      readonly backoffMs: number;
      /**
       * The wait the failure itself STATED (a `Retry-After` header, a
       * gateway's "try again in N seconds"), in ms, as the adapter declared
       * it on `retryAfterMs`. Absent when it stated none. `backoffMs` is
       * max(the schedule, this), capped by the policy's `maxDelayMs` — so a
       * reader sees both what was asked and what was done.
       */
      readonly statedWaitMs?: number;
      /**
       * Classification OF THE ERROR — **not** of the predicate's
       * reasoning. `shouldRetry` returns a bare boolean, so when a custom
       * predicate is in force the decorator cannot know *why* it said yes;
       * this field reports what the error looked like instead, derived
       * from the same `status`/`statusCode` fields `defaultShouldRetry`
       * inspects. One of: `'http-429'` | `'http-5xx'` | `'http-4xx'` |
       * `` `http-${code}` `` | `'no-status'`.
       */
      readonly reason: string;
    }
  | {
      readonly kind: 'recovered';
      /** 1-based attempt that finally succeeded. Always >= 2. */
      readonly attempt: number;
      readonly totalDurationMs: number;
    }
  | {
      /**
       * v9.32 — the breaker moved between `closed` / `open` / `half-open`.
       *
       * Until this arm existed `withCircuitBreaker` reported NOTHING through
       * the in-run channel: `onStateChange` was the only way to see a trip,
       * and that hook fires at consumer level where the run ids are
       * synthetic. An independent reviewer (2026-08-13, on a local harness of
       * scripted failures) watched a breaker open after two failures, serve
       * from fallback, half-open after cooldown and close after two probes —
       * all correct, and all invisible
       * to the typed stream. So the same trip is now on the record with the
       * run's real correlation ids, because every transition happens INSIDE a
       * call and there is nothing to synthesize.
       *
       * `onStateChange` is unchanged and still fires beside this: it is the
       * consumer's own hook, and a Redis-backed counter built on it must not
       * start depending on whether a run happened to be in flight.
       */
      readonly kind: 'circuit-changed';
      /** The state entered. Transitions only — a no-op re-entry never reports. */
      readonly state: 'closed' | 'open' | 'half-open';
      /** WHY, in the breaker's own words (`'3 consecutive failures'`,
       *  `'cooldown elapsed'`, `'half-open probe failed'`). Never an error's
       *  message — the failure that tripped it is reported by whoever threw. */
      readonly reason: string;
      /** WHICH provider this breaker wraps. A stack of breakers under one
       *  fallback produces one stream, and this is what tells them apart. */
      readonly providerName: string;
    };

/**
 * v7.8 — optional per-call hooks the CALLER hands a provider.
 *
 * Lets a resilience decorator report what it did to whoever invoked it,
 * without the decorator knowing anything about runs, scopes, or events.
 * The channel rides the CALL (not the factory) because decorators are
 * constructed by the consumer before any run exists.
 *
 * Passed by agentfootprint's in-run LLM call sites, which translate each
 * report into an already-declared typed event with real correlation ids.
 * Outside a run nothing passes hooks, so `hooks` is `undefined` and every
 * report site short-circuits — standalone decorator behaviour is
 * unchanged.
 *
 * ⚠ **IF YOU WRITE A PROVIDER WRAPPER, FORWARD THIS PARAMETER.** It is the
 * one silent-failure trap in the design. A wrapper that declares
 * `complete(req)` and calls `inner.complete(req)` still type-checks
 * perfectly — `hooks` is optional, and TypeScript has never rejected an
 * implementation for taking FEWER parameters than its signature — so
 * dropping it produces no compile error, no runtime error, and no test
 * failure. What it produces is a decorated provider that goes DARK the
 * moment it is placed underneath: the reports still happen, and nothing
 * receives them. Every wrapper shipped in this library forwards (the three
 * `src/resilience/` decorators, and EVERY class-form / Azure-shaped wrapper
 * in `src/adapters/llm/` — `foundry()` and `foundryLocal()` included; the
 * count is deliberately not written down, because a stale count reads as an
 * unaudited wrapper), so the trap can only be sprung by a
 * consumer-authored wrapper — `myWrapper(withRetry(p))`. There is no way to
 * police it from here; the only defence is this note and the one in the
 * resilience guide's "honest limits".
 */
export interface LLMCallHooks {
  /**
   * The actual leaf provider omitted eligible completed-turn thinking before
   * transport. Wrappers forward this channel unchanged, like onResilience.
   * The run records metadata and keeps the permitted omission in its history.
   */
  readonly onReplayPrepared?: (
    preparation: import('../../thinking/replay.js').ReplayPreparation,
  ) => void;
  /**
   * Called once per resilience decision (a fallback, a retry, a
   * recovery). Decorators forward this hook inward unchanged, so a
   * stack of decorators produces one concatenated report stream with no
   * duplication.
   */
  readonly onResilience?: (report: ResilienceReport) => void;
}

export interface LLMProvider {
  readonly name: string;
  /**
   * How this provider's wire caches a repeated prompt prefix (`PromptCaching`,
   * from `agentfootprint/cache`). The agent picks its cache strategy from
   * this, never from `name`. Absent = no caching the agent drives or meters.
   * A wrapper must forward it, like `carriesInMessages`.
   * A model-aware declaration returns undefined for an unknown/unsupported
   * model. `cacheStrategyFor(provider, model)` resolves either form; adapters
   * must consult the same rule before putting cache markers on the wire.
   */
  readonly promptCaching?:
    | import('../../cache/types.js').PromptCaching
    | ((model: string) => import('../../cache/types.js').PromptCaching | undefined);
  /**
   * The handler that normalizes this wire's thinking (`rawThinking`). The
   * agent uses it unless `.thinkingHandler()` overrides it; absent = no
   * thinking stage. Never chosen by `name` — a wrapper must forward it.
   */
  readonly thinkingHandler?: import('../../thinking/types.js').ThinkingHandler;
  /**
   * Which thinking request each model takes on this wire — `'budget'`,
   * `'adaptive'` or `'none'` (`ThinkingMode`, from `agentfootprint/providers`),
   * asked with the model id a request names (the adapter resolves its own
   * shorthand, e.g. `'anthropic'`). The adapter maps `LLMRequest.thinking` to
   * the right wire shape for that model; the agent reads this at build to
   * refuse `.thinking()` for a model that cannot think and to say, in dev
   * mode, when `'adaptive'` will not send the budget.
   *
   * Absent = no per-model claim: requests carry `thinking: { budget }` and the
   * adapter decides. A plain function of the model id — it must not use
   * `this`, because a wrapper forwards it as a value, like `carriesInMessages`;
   * `withFallback` answers for its pair.
   */
  readonly thinkingMode?: (model: string) => import('../../thinking/types.js').ThinkingMode;
  /**
   * Whether a thinking block this model returns stays valid only under the
   * system prompt, tool list and earlier messages it was written under
   * (Anthropic's preserved thinking: the API refuses or drops a block replayed
   * after any of them changed) — `bound`, `unbound` or `unknown`, and who said
   * so. Read with `thinkingBindingOf(provider, model)`. On a `bound` model the
   * agent refuses by name a tool turn whose context changed under its signed
   * reasoning (`ContextChangedError`); on an `unknown` one it sends the request
   * and records the change.
   *
   * A plain function of the model id (no `this`). **Absence means unbound.**
   * The Anthropic-wire adapters answer from their model table, `unknown` for an
   * id the table cannot place, and take the app's statement for such an id
   * (`thinkingBinding` option, `by: 'app'`). A WRAPPER must forward it;
   * `withFallback` forwards its primary's answer, the side every call goes to
   * first (a fallback's own adapter checks the calls it serves).
   */
  readonly thinkingBinding?: (model: string) => ThinkingBinding;
  /**
   * v7.21 — which roles this provider carries INSIDE the `messages` array.
   *
   * The wires disagree, and the disagreement is invisible from the outside:
   * the Anthropic-family adapters (Anthropic, Bedrock, Browser Anthropic) DROP
   * a `role: 'system'` message inside `messages` because system rides a
   * separate top-level field, while the OpenAI-family adapters carry it. So a
   * `slot: 'messages'` injection with `role: 'system'` would arrive on one
   * provider and vanish on another — and nothing in the recording would tell
   * the two apart. Declaring the capability is what lets the engine refuse at
   * run start instead, naming the provider and the roles it does carry.
   *
   * Consulted at DELIVERY time by the agent's `Deliver` stage. A role that is
   * not listed is REFUSED, never silently re-roled: changing who appears to
   * speak is a meaning change the app must make, not the library.
   *
   * **Optional, and absence is not "carries everything"** — a provider that
   * omits it is treated as `['user', 'assistant']`
   * ({@link DEFAULT_CARRIES_IN_MESSAGES}), the floor every known wire
   * supports. Declare it if your adapter carries more.
   *
   * A WRAPPER must forward it (the three `src/resilience/` decorators do);
   * `withFallback` publishes the INTERSECTION of the two providers it holds,
   * because a role only one of them carries is a role the call might drop.
   */
  readonly carriesInMessages?: readonly WireRole[];
  /**
   * v7.26 — whether this adapter puts {@link LLMRequest.toolChoice} on its
   * wire as a forced choice of one named tool.
   *
   * **Absence means NO, not "probably".** That is the opposite of
   * `carriesInMessages`, whose absence means the floor every wire supports,
   * and the difference is what the two capabilities are for. A role that
   * quietly vanishes costs a message; a tool choice that quietly vanishes
   * costs the guarantee the consumer selected the strategy FOR — the model
   * would answer in whatever shape it liked while the config said the shape
   * was constrained. So an agent using `strategy: 'tool-forced'` on a
   * provider that has not declared this refuses at run start, by name.
   *
   * Declare it only where it is true of the endpoint, not of the SDK: the
   * OpenAI adapter declares it for real OpenAI and Azure and NOT behind a
   * custom `baseURL` (Ollama, vLLM, Together, …), because what an
   * OpenAI-compatible server does with `tool_choice` is that server's
   * business and this library does not get to promise it.
   *
   * A WRAPPER must forward it; `withFallback` publishes the AND of the two
   * providers it holds. Model-specific restrictions are declared separately
   * by `supportsForcedToolChoice`; this existing wire flag remains boolean.
   */
  readonly carriesForcedToolChoice?: boolean;
  /**
   * Optional model-specific restriction on the forced-choice wire capability.
   * Read with `forcedToolChoiceFor(provider, model)`: the wire flag must be
   * true AND this predicate (when present) must answer true. Absence preserves
   * the wire flag's existing behaviour. The adapter resolves its shorthand.
   *
   * Like `thinkingMode`, this function must not depend on `this`; wrappers
   * forward it as a value. `withFallback` intersects both sides per model.
   */
  readonly supportsForcedToolChoice?: (model: string) => boolean;
  /**
   * Whether this adapter puts {@link LLMRequest.outputFormat} on its wire —
   * the provider's own structured output, `strategy: 'native'`. **Absence
   * means NO**, for the reason `carriesForcedToolChoice` gives: a format that
   * quietly vanishes costs the guarantee the strategy was chosen for. Declared
   * by `anthropic()`, `browserAnthropic()` and the mock; read with
   * `nativeOutputSchemaFor(provider, model)`. A WRAPPER must forward it;
   * `withFallback` publishes the AND of its pair.
   */
  readonly carriesNativeOutputSchema?: boolean;
  /**
   * Optional per-model restriction on {@link carriesNativeOutputSchema}, the
   * `supportsForcedToolChoice` twin: both must answer true. A plain function
   * of the model id (no `this`); the adapter resolves its own shorthand.
   */
  readonly supportsNativeOutputSchema?: (model: string) => boolean;
  /**
   * Positive model knowledge for automatic native output. Unlike explicit
   * native support, this must return false for unknown or opaque aliases.
   * Auto requires both native wire support and this predicate to return true;
   * absence keeps instruction-based generation. It must not depend on `this`.
   * Wrappers forward it; fallback pairs require both sides to know the model.
   */
  readonly supportsAutoNativeOutputSchema?: (model: string) => boolean;
  /**
   * `hooks` (v7.8) is optional and additive — implementations may declare
   * `complete(req)` with no second parameter and stay assignable. A LEAF
   * provider (one that talks to a vendor) may ignore it. A WRAPPER must
   * forward it, or everything it wraps goes silently dark — see the
   * `LLMCallHooks` docs above.
   */
  complete(req: LLMRequest, hooks?: LLMCallHooks): Promise<LLMResponse>;
  stream?(req: LLMRequest, hooks?: LLMCallHooks): AsyncIterable<LLMChunk>;
}

/** A provider's answer to `thinkingBinding`: the fact, and who stated it. */
export interface ThinkingBinding {
  /**
   * `bound`: a thinking block is valid only under the system prompt, tool list
   * and earlier messages it was written under. `unbound`: it is not. `unknown`:
   * the provider cannot tell for this model id (an id its table cannot place).
   */
  readonly binding: 'bound' | 'unbound' | 'unknown';
  /** `provider`: the adapter's own knowledge. `app`: the application stated it. */
  readonly by: 'provider' | 'app';
  /**
   * The model family the provider resolved the id to, when it knows it. Two
   * ids of one family read each other's reasoning bindings (a dated id and its
   * alias); a block written by another family is not checked against this one.
   */
  readonly family?: string;
  /**
   * The model id the provider resolved the asked id to — an adapter's
   * shorthand (`'anthropic'`) becomes the id it actually sends. Absent: the
   * asked id is the one sent.
   */
  readonly model?: string;
  /** The app's statement for this id was asked and could not be used (it threw or answered something else). */
  readonly appStatement?: 'failed';
}
