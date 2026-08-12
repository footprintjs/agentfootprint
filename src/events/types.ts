/**
 * EventMeta + shared event vocabulary.
 *
 * Pattern: Domain-Driven Design value objects (Evans, 2003).
 * Role:    Shared vocabulary for the typed events in registry.ts.
 * Emits:   (types only — no runtime behavior here).
 */

export type ContextSlot = 'system-prompt' | 'messages' | 'tools';

/**
 * The origin / flavor of a context injection.
 *
 * BASELINE sources (regular LLM-API flow — NOT context engineering):
 *   - `user`        → the user's message (current turn or history replay)
 *   - `tool-result` → tool return for a tool call (current or history)
 *   - `assistant`   → prior-turn assistant output replayed as history
 *   - `base`        → static system prompt configured at build time
 *   - `registry`    → static tool registry configured at build time
 *
 * ENGINEERED sources (context engineering flavors — the teaching layer):
 *   - `rag`          → retrieval-augmented injection
 *   - `skill`        → skill activation (LLM-guided via read_skill)
 *   - `memory`       → memory strategy re-injection
 *   - `instructions` → rule-based behavior guidance
 *   - `steering`     → always-on policy / persona / format rule
 *   - `fact`         → developer-supplied data (user profile, env, …)
 *   - `custom`       → consumer-defined (anything bespoke)
 *
 * Adding a new source is NOT a breaking change; removing one IS.
 */
export type ContextSource =
  // Engineered flavors (show in Lens Context Engineering bin)
  | 'rag'
  | 'skill'
  | 'memory'
  | 'instructions'
  | 'steering'
  | 'fact'
  | 'custom'
  // Baseline flow (hidden from Context Engineering bin — shown via edges)
  | 'user'
  | 'tool-result'
  | 'assistant'
  | 'base'
  | 'registry';

export type ContextRole = 'system' | 'user' | 'assistant' | 'tool';

export type ContextRecency = 'latest' | 'earlier';

export type ContextLifetime = 'iteration' | 'turn' | 'run' | 'persistent';

// Known providers get autocomplete; custom providers supply any string
// (the `string & {}` trick preserves literal-type narrowing for the known
// values while keeping the overall type assignable from any string).
export type LLMProviderName =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'cohere'
  | 'local'
  | 'custom'
  | 'mock'
  // eslint-disable-next-line @typescript-eslint/ban-types -- (string & {}) preserves string-literal autocomplete while accepting any other string
  | (string & {});

export type ToolProtocol = 'native' | 'mcp' | 'http' | 'python-fn';

export type CompositionKind = 'Sequence' | 'Parallel' | 'Conditional' | 'Loop';

/**
 * Metadata attached by the dispatcher to every event. Consumers never
 * construct this manually — the dispatcher fills it in.
 */
export interface EventMeta {
  /** Wall-clock ms — for external correlation / dashboards. */
  readonly wallClockMs: number;
  /** ms since run start — deterministic replay. */
  readonly runOffsetMs: number;
  /** footprintjs universal stage key. */
  readonly runtimeStageId: string;
  /** Subflow path parsed from runtimeStageId. */
  readonly subflowPath: readonly string[];
  /** Composition ancestry — e.g. ['Sequence:pipeline','Agent:ethics']. */
  readonly compositionPath: readonly string[];
  /** Turn index (Agent context only). */
  readonly turnIndex?: number;
  /** Iteration index (Agent context only). */
  readonly iterIndex?: number;
  /** OTEL trace id (when env.traceId is set). */
  readonly traceId?: string;
  /** OTEL span id for the current composition boundary. */
  readonly spanId?: string;
  /** Domain correlation id — ties retrieval → injection → LLM. */
  readonly correlationId?: string;
  /** Run id — demultiplex concurrent runs sharing one dispatcher. */
  readonly runId: string;
  /**
   * The hosting CONVERSATION this run belongs to, when it belongs to one
   * (9.4.0).
   *
   * A `runId` is per `run()` / `resume()`; a session outlives both. So a
   * shipped event stream could say which run an event came from but not which
   * conversation — and every session-oriented host (AgentCore above all) asks
   * its questions the other way round: "what happened in session X?". Joining
   * runs back into sessions after the fact is not possible from the events
   * alone, which is why this rides on the meta rather than being reconstructed.
   *
   * **Absent when the run is not session-bound**, and never invented: an
   * anonymous `standingAgent` request has no session, and a bare `agent.run()`
   * has none either. `standingAgent` passes the caller's own session id
   * through; anyone else sets it with `run({ ... }, { sessionId })`.
   */
  readonly sessionId?: string;
  /**
   * WHO this run is for — the principal the caller NAMED (9.11.0).
   *
   * This is the actor half of an audit record. The event stream has always
   * carried *what* happened and *when*; `principal` and {@link tenant} are what
   * make it a who→what→when wire, and they ride on the meta for the same reason
   * `sessionId` does: nothing downstream can reconstruct them from the payloads.
   *
   * **Stamped ONLY from an explicit identity** — `agent.run(input, { identity })`
   * or `run({ message, identity })`, the same tuple memory and the permission
   * gate scope on. Never from the run's internal `runIdentity`, which is always
   * populated and defaults to `{ conversationId: '<runId>' }` (or, on a
   * session-bound run since 9.10.0, to `{ conversationId: sessionId }`).
   *
   * **A conversation id is not an actor.** Deriving a principal from a session
   * would put a caller-supplied string — anyone who can reach the host can send
   * any one — into the field an auditor reads as "who did this". Absent is the
   * honest answer for an anonymous run, and absent is what it says.
   */
  readonly principal?: string;
  /**
   * The organization / workspace / account boundary this run is for (9.11.0).
   *
   * Same rule as {@link principal} in every respect: explicit identity only,
   * never synthesized, absent for a single-tenant or anonymous run.
   */
  readonly tenant?: string;
}

/** Discriminated-union envelope every event implements. */
export interface AgentfootprintEventEnvelope<TType extends string, TPayload> {
  readonly type: TType;
  readonly payload: TPayload;
  readonly meta: EventMeta;
}
