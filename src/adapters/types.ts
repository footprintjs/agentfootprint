/**
 * adapters/types — the Ports of the hexagonal architecture.
 *
 * Pattern: Adapter (GoF, Design Patterns ch. 4) + Ports-and-Adapters
 *          (Cockburn, 2005).
 * Role:    Contracts for every external dependency the library reaches for:
 *          LLM providers, memory stores, context sources, embeddings,
 *          guardrails, policy engines, pricing tables.
 * Emits:   N/A (interfaces only).
 *
 * Concrete adapters (AnthropicProvider, PineconeStore, LlamaGuardDetector,
 * ...) implement these contracts. `core/` and `core-flow/` depend only on
 * these interfaces — never on concrete adapters.
 */

import type { ContextRole, ContextSlot, ContextSource } from '../events/types.js';
import type { ThinkingBlock } from '../thinking/types.js';

// ─── LLM Provider ────────────────────────────────────────────────────

export interface LLMMessage {
  readonly role: ContextRole;
  readonly content: string;
  /** For `role: 'tool'` — the tool_use id this result corresponds to. */
  readonly toolCallId?: string;
  /** For `role: 'tool'` — the tool name this result corresponds to. */
  readonly toolName?: string;
  /**
   * For `role: 'assistant'` only — the tool calls the LLM requested in this
   * turn. Required for providers (Anthropic, OpenAI) that need to round-trip
   * tool_use blocks across iterations: when the next `complete()` includes
   * a `role: 'tool'` message, the provider reconstructs the matching
   * `tool_use` block on the previous assistant turn from this field.
   * Empty array on text-only turns; undefined for non-assistant roles.
   *
   * `providerMeta` (9.29.0) rides back UNCHANGED — it is the same bag the
   * response put there, and for Gemini it holds the `thoughtSignature` without
   * which the model refuses the turn after a tool call. See
   * {@link LLMResponse}'s `toolCalls[].providerMeta`. Unlike `injectedBy`, it
   * is NOT stripped on the way to a provider: it exists to be sent.
   */
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly providerMeta?: Readonly<Record<string, unknown>>;
  }[];
  /**
   * v2.14 — Thinking blocks emitted by the LLM on assistant turns.
   *
   * Required for Anthropic extended-thinking + tool-use flows: signed
   * blocks MUST be echoed BYTE-EXACT in subsequent assistant turns or
   * Anthropic's API rejects with 400. The framework persists blocks
   * here so the AnthropicProvider's serializer (Phase 4b) can restore
   * them on the next request.
   *
   * **Persistence model — DIFFERENT from `ephemeral`:**
   *   - `ephemeral` messages: NOT persisted to scope.history
   *   - `thinkingBlocks`: PERSISTED (required for signature round-trip)
   *
   * Visible to recorders + audit by default. Use
   * `RedactionPolicy.thinkingPatterns` (Phase 3) to scrub sensitive
   * reasoning content before audit-log adapters fire.
   *
   * Empty array OR undefined when no thinking is present (most calls).
   */
  readonly thinkingBlocks?: readonly ThinkingBlock[];
  /**
   * v2.13 — PERSISTENCE flag (NOT a visibility flag). When `true`:
   *   • The message IS sent to the LLM as part of the next request
   *     (visible to the model, counts toward its context window).
   *   • The message is OBSERVABLE via narrative/recorders/audit log
   *     (visible to humans for debugging + forensics).
   *   • The message is NOT persisted to `scope.history` after the gate
   *     loop that produced it completes — long-term memory writes,
   *     `getNarrative()` snapshots, and downstream consumers see only
   *     non-ephemeral messages.
   *
   * Use case: Instructor-style schema retry. The reliability gate
   * appends `{ role: 'user', content: feedbackForLLM, ephemeral: true }`
   * before retry — the LLM sees the validation feedback for the next
   * call, but the conversation history (and any memory persistence
   * downstream) sees only the final accepted exchange.
   *
   * Audit-trail safety: ephemeral DOES NOT mean invisible to security
   * review. `getNarrative()`, recorders, and the typed-event stream all
   * see ephemeral messages; only the persistent conversation log filters
   * them out. An attacker cannot use the ephemeral marker to construct
   * audit-invisible prompts.
   */
  readonly ephemeral?: boolean;
  /**
   * v7.21 — WHO let this message into the window.
   *
   * Stamped by the agent's `Deliver` stage on a message that came from a
   * `slot: 'messages'` Injection rather than from the conversation. It is the
   * stable marker the messages slot reads to attribute the message to its
   * injection (source / sourceId / reason) instead of inferring a baseline
   * source from the role — so one wire message produces exactly one
   * `context.injected` record, naming whoever put it there.
   *
   * **Never reaches a provider.** `callLLM` strips this field from every
   * message before the request is handed to `provider.complete()` / `stream()`,
   * so no adapter — first-party or consumer-authored — can leak framework
   * metadata onto a wire, even one that serializes a message wholesale.
   * Stripping removes a field, never a message, so wire indices are unchanged
   * (which is what lets a `CacheMarker{field:'messages'}` name a real position).
   *
   * Absent on every message that came from the conversation itself.
   */
  readonly injectedBy?: {
    /** The `Injection.id` that produced this message. */
    readonly injectionId: string;
    /** The injection's flavor — the `source` the slot records. */
    readonly flavor: ContextSource;
    /** The injection's description, when it had one. */
    readonly reason?: string;
    /** The ReAct iteration whose boundary delivered it. */
    readonly iteration: number;
  };
}

/**
 * The roles a provider can carry INSIDE the `messages` array.
 *
 * `'tool'` is deliberately absent: a tool message is an answer to a specific
 * `tool_use` id, so it cannot be authored by an injection — there is no call
 * for it to answer. See `LLMProvider.carriesInMessages`.
 */
export type WireRole = 'system' | 'user' | 'assistant';

/**
 * The floor every known wire supports. Used for any provider that does not
 * declare `carriesInMessages` — a third-party adapter is assumed to carry
 * only what all of them do, never more.
 */
export const DEFAULT_CARRIES_IN_MESSAGES: readonly WireRole[] = Object.freeze([
  'user',
  'assistant',
]);

export interface LLMToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface LLMRequest {
  readonly systemPrompt?: string;
  readonly messages: readonly LLMMessage[];
  readonly tools?: readonly LLMToolSchema[];
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stop?: readonly string[];
  readonly signal?: AbortSignal;
  /**
   * Cache markers (v2.6+) — provider-agnostic prefix-cache hints
   * populated by `CacheStrategy.prepareRequest` after the agent's
   * CacheGate decider routes to `apply-markers`. Each marker
   * identifies a cacheable prefix in `system` / `tools` / `messages`.
   *
   * Providers that support caching (Anthropic, Bedrock-Claude) read
   * this field and translate to their wire format. Providers without
   * cache support (OpenAI auto-cache, Mock, NoOp) ignore it.
   */
  readonly cacheMarkers?: readonly import('../cache/types.js').CacheMarker[];
  /**
   * v2.14 — request the LLM emit reasoning/thinking content on this call.
   *
   * Activation: presence of this field tells the provider to ASK for
   * thinking. Anthropic translates to `thinking: { type: 'enabled',
   * budget_tokens: budget }` on the wire. OpenAI ignores (o1/o3
   * thinking is selected at the model id level, not per-request).
   *
   * `budget` is the maximum reasoning tokens the model may spend.
   * Anthropic requires it; recommended range 1024-32000 for
   * claude-sonnet-4-5 / opus-4-5. Models that don't support extended
   * thinking will reject the request with HTTP 400 — pick a supported
   * model when setting this field.
   *
   * Independent from `LLMMessage.thinkingBlocks` (the response side):
   *   - `request.thinking` = activation (consumer ASKS for thinking)
   *   - `message.thinkingBlocks` = round-trip (consumer ECHOES prior
   *     assistant turn's signed blocks back to the model)
   *
   * Set via `AgentBuilder.thinking({ budget })` — applied to every
   * LLM call the agent makes. Leave undefined to call without thinking
   * (the v2.13 default).
   */
  readonly thinking?: {
    readonly budget: number;
  };
  /**
   * v7.26 — force the model to answer through one named tool.
   *
   * One arm, because one arm is what the library needs and can keep a
   * promise about: `.outputSchema(parser, { strategy: 'tool-forced' })`
   * presents the schema as a synthetic tool and forces the choice, so the
   * shape is constrained at generation instead of requested in prose.
   * Anthropic spells it `{type:'tool',name}`, OpenAI
   * `{type:'function',function:{name}}`, Bedrock Converse
   * `toolConfig.toolChoice.tool.name` — the field is the one word all three
   * agree on, and each adapter writes its own dialect.
   *
   * A provider that does not declare {@link LLMProvider.carriesForcedToolChoice}
   * never receives this field: the agent refuses at run start instead,
   * naming the provider. Silently sending it to a wire that ignores it would
   * turn a guarantee into a suggestion with nothing in the recording to say
   * so.
   */
  readonly toolChoice?: {
    readonly type: 'tool';
    readonly name: string;
  };
}

export interface LLMResponse {
  readonly content: string;
  readonly toolCalls: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
    /**
     * 9.29.0 — what the PROVIDER needs back with this call, opaque to
     * everything in between.
     *
     * Same escape-hatch shape and the same rules as
     * `ThinkingBlock.providerMeta`: plain data only, nothing
     * identity-bearing beyond what the wire itself demands, and no framework
     * behaviour keys on it. The framework's whole job is to keep it attached
     * to its call — through `scope.llmLatestToolCalls`, into the assistant
     * turn in `history`, across a checkpoint — and hand it back to the same
     * adapter on the next request.
     *
     * Why it exists: Gemini signs the reasoning behind a function call and
     * REFUSES the following turn when the signature does not come back
     * (`thought_signature`, HTTP 400 — measured in the field, after the tool
     * had already run). The signature belongs to the tool call, not to the
     * message and not to a thinking block, so it needed a home on the call.
     * Providers that sign nothing leave this undefined and cost nothing.
     */
    readonly providerMeta?: Readonly<Record<string, unknown>>;
  }[];
  readonly usage: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    /**
     * v2.14 — count of reasoning/thinking tokens used by the model.
     * Distinct from `output` (which is visible-content tokens).
     *
     * Semantics:
     *   - `undefined` — provider doesn't expose / no thinking enabled
     *                   on this call / call without extended thinking
     *   - `0`         — thinking enabled but model produced no
     *                   thinking tokens this call
     *   - `>0`        — actual reasoning token count (billing-relevant
     *                   for both Anthropic extended thinking and
     *                   OpenAI o1/o3 reasoning_tokens)
     *
     * Cost dashboards reading `cost.tick` events should track this
     * separately from `output` — pricing differs (Anthropic charges
     * extended thinking at output rates; OpenAI o1/o3 reasoning tokens
     * are billed as a separate line item).
     */
    readonly thinking?: number;
  };
  readonly stopReason: string;
  readonly providerRef?: string;
  /**
   * v2.14 — Provider-specific raw thinking data, opaque to the
   * framework. Providers that support extended thinking populate this
   * with their native shape (Anthropic: array of `{type, thinking,
   * signature}` blocks; OpenAI: `reasoning_summary` value; custom:
   * whatever the provider emits). The framework hands this to a
   * configured `ThinkingHandler.normalize(rawThinking)` to produce
   * the normalized `ThinkingBlock[]` that lands on
   * `LLMMessage.thinkingBlocks`.
   *
   * Undefined when the provider has no thinking content for this call
   * — most calls (gpt-4o, claude without extended thinking enabled,
   * etc.). The thinking subflow's stage early-returns in this case.
   */
  readonly rawThinking?: unknown;
}

export interface LLMChunk {
  readonly tokenIndex: number;
  /** Token text. Empty for the terminal chunk (`done: true`). */
  readonly content: string;
  /** True only for the final chunk in a stream. */
  readonly done: boolean;
  /**
   * Authoritative response payload, populated ONLY on the final chunk
   * (`done: true`). Carries `toolCalls`, `usage`, `stopReason` — the
   * fields that drive the ReAct loop. The `content` mirrors the
   * concatenation of all non-terminal chunks; consumers can use
   * either source.
   *
   * Streaming providers SHOULD populate this. Older providers that
   * yield only text and end with `done: true` (no `response`) are
   * still supported — Agent falls back to `complete()` for the
   * authoritative payload in that case.
   */
  readonly response?: LLMResponse;
  /**
   * v2.14 — streaming thinking-content tokens. Parallel to `content`
   * but for the model's reasoning chain rather than visible output.
   * Set on chunks that carry thinking deltas (Anthropic emits these
   * via `content_block_delta` events with `delta.type === 'thinking_delta'`);
   * undefined or empty on chunks that carry only visible-content tokens.
   *
   * Frameworks: this field drives `agentfootprint.stream.thinking_delta`
   * events when a `ThinkingHandler.parseChunk()` returns one. Consumers
   * who want to render thinking-as-it-streams subscribe to that event.
   *
   * Default consumer behavior: thinking tokens are not surfaced to end
   * users unless a consumer explicitly subscribes to the
   * `agentfootprint.stream.thinking_delta` event (or renders it through a
   * live-status strategy).
   */
  readonly thinkingDelta?: string;
}

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
      readonly backoffMs: number;
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
 * `src/resilience/` decorators, and all eight class-form / Azure wrappers
 * in `src/adapters/llm/`), so the trap can only be sprung by a
 * consumer-authored wrapper — `myWrapper(withRetry(p))`. There is no way to
 * police it from here; the only defence is this note and the one in the
 * resilience guide's "honest limits".
 */
export interface LLMCallHooks {
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
   * providers it holds, since a call that might be served by either is only
   * constrained if both constrain it.
   */
  readonly carriesForcedToolChoice?: boolean;
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

// ─── Context Source ──────────────────────────────────────────────────

export interface ResolveCtx {
  readonly userMessage: string;
  readonly turnIndex: number;
  readonly iterIndex: number;
  readonly availableBudgetTokens: number;
  readonly signal?: AbortSignal;
}

export interface ContextContribution {
  readonly contentSummary: string;
  readonly rawContent?: string;
  readonly score?: number;
  readonly rank?: number;
  readonly asRole?: ContextRole;
  readonly sectionTag?: string;
  readonly reason: string;
}

export interface ContextSourceAdapter {
  readonly id: string;
  readonly targetSlot: ContextSlot;
  readonly source: ContextSource;
  resolve(ctx: ResolveCtx): Promise<readonly ContextContribution[]>;
}

// ─── Embedding Provider ─────────────────────────────────────────────

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  embed(inputs: readonly string[], kind: 'query' | 'document'): Promise<number[][]>;
}

// ─── Risk Detector (guardrails) ─────────────────────────────────────

export interface RiskContext {
  readonly slot?: ContextSlot;
  readonly source?: ContextSource;
  readonly turnIndex?: number;
  readonly iterIndex?: number;
}

export interface RiskResult {
  readonly flagged: boolean;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly category:
    | 'pii'
    | 'prompt_injection'
    | 'runaway_loop'
    | 'cost_overrun'
    | 'hallucination_flag';
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly suggestedAction: 'warn' | 'redact' | 'abort';
}

export interface RiskDetector {
  readonly name: string;
  check(content: string, context: RiskContext): Promise<RiskResult>;
}

// ─── Permission Engine ──────────────────────────────────────────────

/**
 * One entry in the in-flight tool-call sequence delivered to
 * `PermissionChecker.check()` since v2.12. Lets sequence-aware
 * policies (exfil chain detection, idempotency limits, cost guards)
 * inspect what the agent has already dispatched this run.
 *
 * Derived from `scope.history` at check time — single source of truth,
 * survives `agent.resumeOnError(checkpoint)` correctly.
 */
export interface ToolCallEntry {
  /** Tool name dispatched. */
  readonly name: string;
  /** Tool args passed to `tool.execute(args, ctx)`. */
  readonly args: Readonly<Record<string, unknown>> | undefined;
  /** ReAct iteration the call was dispatched on. */
  readonly iteration: number;
  /**
   * Optional source identifier — `'local'` for tools registered via
   * `.tool(...)` / `staticTools(...)`, or the `ToolProvider.id` for
   * tools resolved through a `discoveryProvider`. Lets cross-hub
   * exfil rules match on origin, not just name.
   */
  readonly providerId?: string;
}

/**
 * What a tool DECLARES it touches (9.11.0).
 *
 * The four values a tool can honestly say about itself. Deliberately a subset
 * of {@link PermissionCapability}: `'tool_call'` is the framework's own word for
 * "a tool was dispatched" and `'skill_read'` is the framework's word for "a
 * skill was activated" — neither is something a tool declares about its own
 * behaviour.
 *
 * **The framework never infers these.** A tool's capabilities are not knowable
 * from its name, its schema or its description; classifying them by guess would
 * put a policy decision on a heuristic. Declared or absent — see `Tool.capabilities`.
 */
export type ToolCapability = 'memory_read' | 'memory_write' | 'external_net' | 'user_data';

/**
 * The full vocabulary a {@link PermissionRequest} can carry.
 *
 * ## What is actually ENFORCED, said plainly
 *
 * `'tool_call'` has been enforced since v2.4: every tool dispatch asks the
 * checker before `tool.execute`. The rest are enforced **only when both sides
 * speak** (9.11.0):
 *
 * - a tool DECLARES `Tool.capabilities`, and
 * - the checker DECLARES {@link PermissionChecker.governs}.
 *
 * With either side silent, nothing extra is asked and nothing extra is refused
 * — byte-identical to every earlier release. This is deliberate: a framework
 * that started sending `'memory_write'` to existing fail-closed allowlists would
 * deny work those deployments have always permitted.
 *
 * **What is still NOT gated by this port, and is not pretended to be:** the
 * agent's own memory pipeline. Recall and write stages are scoped by
 * `MemoryIdentity` (tenant / principal / conversation), which is a
 * different mechanism from a permission check, and no memory stage builds a
 * `PermissionRequest`. So `'memory_read'` / `'memory_write'` reach a checker
 * only for a TOOL that declared them.
 */
export type PermissionCapability = ToolCapability | 'tool_call' | 'skill_read';

export interface PermissionRequest {
  /**
   * What kind of operation is being asked about. See
   * {@link PermissionCapability} for which values the framework actually sends
   * and when.
   */
  readonly capability: PermissionCapability;
  readonly actor: string;
  /**
   * What is being asked about, in the vocabulary of the capability:
   *
   * - `'tool_call'` and every {@link ToolCapability} — the TOOL NAME.
   * - `'skill_read'` — `skill:<id>` (9.11.0). Prefixed so a skill and a tool of
   *   the same name are two different subjects to a policy that lists ids.
   */
  readonly target?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  /**
   * v2.12 — Sequence of tool calls already dispatched this run, in
   * call order. EMPTY for non-`tool_call` capabilities. Sequence-aware
   * policies (forbidden chains, idempotency limits) read this to make
   * decisions that single-call governance cannot.
   */
  readonly sequence?: readonly ToolCallEntry[];
  /**
   * v2.12 — Full conversation history at check time. Lets policies
   * inspect prior assistant content / tool results without maintaining
   * parallel state via event subscription.
   */
  readonly history?: readonly LLMMessage[];
  /**
   * v2.12 — Current ReAct iteration (1-based). Lets policies fire
   * different rules per iteration without external counters.
   */
  readonly iteration?: number;
  /**
   * v2.12 — Caller identity from `agent.run({ identity })`. Permission
   * predicates can role-check on `identity.principal` / `identity.tenant`.
   */
  readonly identity?: {
    readonly tenant?: string;
    readonly principal?: string;
    readonly conversationId: string;
  };
  /**
   * v2.12 — Optional abort signal propagated from `agent.run({ env: { signal } })`.
   * Async checkers (Redis lookups, hub-backed allowlists) MUST honor this
   * — when the agent run is cancelled, in-flight checks should abort.
   */
  readonly signal?: AbortSignal;
}

/**
 * v2.12 — content shape mirroring `LLMMessage.content`. Future-compatible
 * with multi-modal `tool_result` blocks once `LLMMessage` widens.
 */
export type ToolResultContent = string;

export interface PermissionDecision {
  /**
   * v2.12 — `'halt'` is NEW. Terminates the run cleanly with a typed
   * `PolicyHaltError`. The framework writes a synthetic `tool_result`
   * (using `tellLLM`) to `scope.history` BEFORE throwing, so:
   *   • Anthropic / OpenAI tool_use ↔ tool_result pairing is satisfied
   *   • The conversation history is consistent for `resumeOnError`
   *   • Lens / `getNarrative()` shows what the LLM was told
   *
   * `'deny'` keeps existing semantics: synthetic tool_result + LLM
   * continues and can pick differently.
   */
  readonly result: 'allow' | 'deny' | 'halt' | 'gate_open';
  readonly policyRuleId?: string;
  readonly rationale?: string;
  readonly gateId?: string;
  /**
   * v2.12 — telemetry tag (machine-readable, stable across versions).
   * Surfaces on `agentfootprint.permission.halt.reason` for routing
   * alerts (e.g. `'security:exfiltration'` → PagerDuty,
   * `'cost:context-bloat'` → Slack channel).
   */
  readonly reason?: string;
  /**
   * v2.12 — content delivered to the LLM as the synthetic `tool_result`
   * on `'deny'` and `'halt'`. When omitted, defaults to a deliberately
   * generic `"Tool '${name}' is not available in this context."` —
   * NEVER falls back to `reason` (which is telemetry, not user-facing).
   */
  readonly tellLLM?: ToolResultContent;
}

export interface PermissionChecker {
  readonly name: string;
  check(request: PermissionRequest): Promise<PermissionDecision> | PermissionDecision;
  /**
   * Which capabilities BEYOND `'tool_call'` this checker asks to be consulted
   * about (9.11.0). Optional and feature-detected — **absence is NO**.
   *
   * `'tool_call'` is always asked and needs no declaration. Everything else is
   * asked only when it appears here AND the other side declares it too:
   *
   * - a {@link ToolCapability} — asked once per declared capability, per
   *   dispatch of a tool whose `Tool.capabilities` names it, right after
   *   the `'tool_call'` check allows.
   * - `'skill_read'` — asked once per skill when the `read_skill` menu is
   *   composed (a refused skill's row disappears from what the model is
   *   offered) and again when the model activates one (a refused activation
   *   lands as the policy's own message, which the model reads and adapts to).
   *
   * The reason this exists rather than "just send everything": a checker
   * written before these values were sent is fail-closed by design, and would
   * deny a capability it has no rule for. Silence keeps such a checker doing
   * exactly what it does today. Declare it and the framework starts asking.
   *
   * @example a checker that also governs which skills a role may activate
   *   const checker: PermissionChecker = {
   *     name: 'my-policy',
   *     governs: ['skill_read'],
   *     check: (req) =>
   *       req.capability === 'skill_read' && req.target === 'skill:payroll'
   *         ? { result: 'deny', rationale: 'payroll is HR-only' }
   *         : { result: 'allow' },
   *   };
   */
  readonly governs?: readonly PermissionCapability[];
}

/**
 * Does this checker ask to be consulted about `capability`? (9.11.0)
 *
 * `'tool_call'` is always true — it has been enforced since v2.4 and needs no
 * declaration. Everything else is true only when the checker named it.
 * Absence is NO.
 */
export function checkerGoverns(
  checker: PermissionChecker | undefined,
  capability: PermissionCapability,
): boolean {
  if (!checker) return false;
  if (capability === 'tool_call') return true;
  return checker.governs?.includes(capability) === true;
}

// ─── Pricing Table ──────────────────────────────────────────────────

export type TokenKind = 'input' | 'output' | 'cacheRead' | 'cacheWrite';

export interface PricingTable {
  readonly name: string;
  /** USD per ONE token for the given model+kind. */
  pricePerToken(model: string, kind: TokenKind): number;
}

// ─── Code Runner (9.7.0) ────────────────────────────────────────────

/**
 * A service that runs code in an isolated session — a managed code
 * interpreter, a container pool, a subprocess.
 *
 * **The shape is Start → Execute ×N → Stop**, because that is what every real
 * one is, and the middle is the part a framework has to make possible. Paying
 * session start-up on every call is the honest cheap version; holding the
 * session in a module-level map is the fast version that hands one live sandbox
 * to whoever calls next. `ctx.onTeardown` + {@link ToolExecutionContext.runId}
 * are what let a tool do neither.
 *
 * ── Why this port exists at all: "summarize prose, compute data" ────────────
 * A tool that returns 40MB of rows does not need a bigger context window; it
 * needs to not put the rows in one. The motivating failure is a real production
 * request of 879,073 tokens — a tool result pasted straight into the prompt.
 * With a code runner, the model writes the aggregation, the RUNNER holds the
 * data, and what comes back is the answer. Prose gets summarized; data gets
 * computed. `CodeResult.truncated` exists so the second half of that promise
 * cannot quietly break.
 *
 * Implement it for your own backend; ship it to `codeRunnerTool({ runner })`.
 */
export interface CodeRunner {
  /** Stable id — reported on every `agentfootprint.tools.session_*` event so a
   *  row names its backend, not just its tool. */
  readonly id: string;
  /**
   * Open a session.
   *
   * `key` is the ISOLATION key the caller derived (see `toolSessionKey`). An
   * adapter may use it to name the remote session; it must never widen it.
   */
  start(req: {
    readonly key: string;
    readonly language?: string;
    readonly signal?: AbortSignal;
  }): Promise<CodeSession>;
}

/**
 * The environment variable an executing snippet reads its staged inputs from —
 * a JSON object mapping each input's NAME to the path it landed at.
 *
 * Part of {@link CodeSession.stageInputs}'s contract rather than one adapter's
 * convention, and named here so an adapter uses the constant instead of
 * retyping the string. It is what makes model-written code portable across
 * backends: the code reads one variable, and every adapter that stages inputs
 * fills it the same way.
 */
export const STAGED_INPUTS_ENV = 'AF_STAGED_INPUTS';

/**
 * One payload staged INTO a code session before code runs (9.26.0).
 *
 * `name` is the file name the caller wants it under — the tool derives it from
 * the declared argument (`dataset` → `dataset.json`), so the model can be told
 * the name in a static description. An adapter may sanitize it (a name is
 * caller data landing in a filesystem) but must not rename it beyond
 * recognition, because the manifest is keyed by what it was ASKED for.
 */
export interface CodeInput {
  /**
   * The MANIFEST KEY — what the executing code looks this input up by. The
   * tool uses the declared argument name (`dataset`), so a static description
   * can tell the model exactly what to look up before any session exists.
   */
  readonly name: string;
  /**
   * The file name to write it under, when it should differ from `name` — the
   * tool derives one from the artifact's media type (`dataset` +
   * `application/json` → `dataset.json`) so an interpreter's own loader sees a
   * familiar extension. Defaults to `name`.
   *
   * A separate field precisely so the manifest KEY and the on-disk NAME cannot
   * drift: the code looks up what it was told to look up, whatever the file
   * ended up being called.
   */
  readonly fileName?: string;
  /** The bytes. A string is written as UTF-8 text; a `Uint8Array` verbatim. */
  readonly data: string | Uint8Array;
  /** The producer's own statement about the payload, when it has one. */
  readonly mediaType?: string;
}

/** Where one staged input actually landed. */
export interface StagedCodeInput {
  /** The name it was asked for — the manifest key the code looks up. */
  readonly name: string;
  /** The path the executing code opens. Absolute, or relative to the session's
   *  working directory: whichever it is, it is what the manifest carries and
   *  what the code should use verbatim. */
  readonly path: string;
  /** How many bytes landed. */
  readonly bytes: number;
}

/** One live session. `stop()` is idempotent and tolerates "already gone". */
export interface CodeSession {
  /** The backend's own id for this session, when it has one. */
  readonly id: string;
  execute(req: {
    readonly code: string;
    readonly language?: string;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<CodeResult>;
  /**
   * OPTIONAL (9.26.0) — put payloads INTO the session, so code can read data
   * that never travelled through the context window.
   *
   * ── Why it is a new member rather than an argument to `execute` ──────────
   * The port's only input was the code STRING, and 9.22.0 stated the honest
   * consequence rather than working around it: pushing a resolved artifact
   * through that door would mean inlining megabytes into an argv, in
   * language-specific quoting, past operating-system argument limits. This is
   * the session file-write verb that note said it was waiting for.
   *
   * ── The contract, which is two promises not one ─────────────────────────
   *  1. The payloads are written where the session's code can read them, and
   *     the returned {@link StagedCodeInput.path} is what the code opens.
   *  2. Every later `execute` on this session exposes the manifest as the
   *     {@link STAGED_INPUTS_ENV} environment variable — a JSON object of
   *     `name → path`. That second promise is what makes the model's code
   *     portable: it reads one variable, on every backend that stages.
   *
   * Staged inputs live as long as the SESSION and are released by `stop()`.
   *
   * ── Absent, never faked ─────────────────────────────────────────────────
   * A backend that cannot write into its own session LEAVES THIS ABSENT.
   * Feature-detect with `canStageCodeInputs(session)`; `codeRunnerTool`
   * refuses by name when a tool declares artifact inputs and the runner cannot
   * carry them, because running the code without the data it declared would be
   * the accepted-and-silently-wrong failure.
   */
  stageInputs?(inputs: readonly CodeInput[]): Promise<readonly StagedCodeInput[]>;
  /**
   * Release the session.
   *
   * Must tolerate a session the far side already reaped — an idle timeout is
   * the reality on every managed backend, and a `Stop` on a dead session is a
   * no-op, not an error.
   */
  stop(): Promise<void>;
}

/** Can this session accept staged inputs? The feature-detection law: read the
 *  member, never assume it from the adapter's name. */
export function canStageCodeInputs(
  session: CodeSession,
): session is CodeSession & Required<Pick<CodeSession, 'stageInputs'>> {
  return typeof session.stageInputs === 'function';
}

/** What one execution produced. */
export interface CodeResult {
  /** Did the code run to completion without an error exit? */
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number;
  /** Files the run produced, described rather than inlined — the whole point is
   *  that big data does not enter the window. All fields beyond the original
   *  `{ name, bytes, uri? }` are ADDITIVE (9.22.0) and honest about absence:
   *  a runner that only knows the file exists states exactly what it always
   *  did.
   *
   *  `data` is the in-band payload, present ONLY when the adapter can hand
   *  the bytes back (a local runner reading its own working directory, a
   *  managed sandbox that returns file contents). When a store is attached,
   *  `codeRunnerTool` mints every data-carrying entry into the artifact
   *  store and the model's result names the ref — entries without `data`
   *  stay described-only, because minting needs bytes and inventing them is
   *  worse than stating the gap. `mediaType` is the adapter's own statement
   *  when it knows one; `ref` is stamped by whoever minted the file into an
   *  artifact store (today: `codeRunnerTool`'s mint-on-output). */
  readonly artifacts?: readonly {
    readonly name: string;
    readonly bytes: number;
    readonly uri?: string;
    readonly mediaType?: string;
    readonly data?: string | Uint8Array;
    readonly ref?: string;
  }[];
  /**
   * Present IFF output was cut, and then it says by how much.
   *
   * Load-bearing, not politeness. A runner exists so big data is computed
   * outside the context window instead of pasted into it; a runner that
   * quietly slices its own output to fit is the same bug wearing a different
   * hat, and the model would go on to reason over a truncated table it was
   * never told was truncated. An unstated slice is a silent success.
   */
  readonly truncated?: {
    readonly stdout?: boolean;
    readonly stderr?: boolean;
    /** The pre-truncation length, in characters, of whichever stream was cut. */
    readonly ofChars?: number;
  };
}
