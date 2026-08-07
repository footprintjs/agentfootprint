/**
 * Injection Engine — types.
 *
 * THE primitive that unifies every form of context engineering in the
 * library. Skills, Steering docs, Instructions, RAG, Memory, custom
 * Context — all reduce to one shape: an `Injection` with a `trigger`
 * (when), `inject` (what — one or more slot targets), and a `flavor`
 * (observability tag).
 *
 * Pattern: Strategy (GoF) — each Injection's trigger is a strategy for
 *          "should I activate this iteration?". Each Injection's
 *          `inject` is the Memento (GoF) carrying content to slots.
 * Role:    Layer-3 context engineering primitive in the stack.
 *          Sits below the slot subflows.
 * Emits:   Engine emits `agentfootprint.context.evaluated` once per
 *          iteration. Slot subflows emit `agentfootprint.context.injected`
 *          for each InjectionRecord they place.
 */

import type { Tool } from '../../core/tools.js';
import type { ContextRole, ContextSource } from '../../events/types.js';

// ─── Trigger — WHEN does this Injection activate? ──────────────────

/**
 * Discriminated union — exactly one of four kinds. Adding a new
 * trigger kind is one new variant; engine evaluator + Lens chip
 * naturally extend.
 */
export type InjectionTrigger =
  /** Always-on. Used for steering-doc-style injections. */
  | { readonly kind: 'always' }
  /** Predicate runs once per iteration. Most flexible. */
  | {
      readonly kind: 'rule';
      readonly activeWhen: (ctx: InjectionContext) => boolean;
    }
  /** Activates after a specific tool returns. The "Dynamic ReAct" flavor —
   *  tool results steer the next iteration's prompt. `toolName` matches
   *  literally (string) or by regex. */
  | {
      readonly kind: 'on-tool-return';
      readonly toolName: string | RegExp;
    }
  /** Activates when the LLM calls a designated tool. The "Skill" flavor:
   *  `read_skill('billing')` activates the billing Skill for the next
   *  iteration. */
  | {
      readonly kind: 'llm-activated';
      readonly viaToolName: string;
    };

// ─── Slot targets — WHAT does the Injection contribute? ────────────

/**
 * Multi-slot per Injection. A Skill for example targets BOTH
 * system-prompt (the body) AND tools (the unlocked capabilities)
 * in one Injection. Lens displays the same Injection chip across
 * each slot it lands in.
 */
export interface InjectionContent {
  /** Text appended to the system-prompt slot when active. */
  readonly systemPrompt?: string;
  /**
   * Messages DELIVERED into the conversation when active (7.21.0).
   *
   * Delivery means what it says: the agent's `Deliver` stage appends these
   * to `scope.history` itself at the injection-engine boundary — never a
   * parallel array spliced in at send time — so the window strategies, the
   * three slots, the commit log and the wire all see one past. Two rules
   * govern it, and both can say no:
   *
   *   • a role the attached provider does not carry inside `messages` is
   *     REFUSED at run start, naming the provider (the Anthropic family
   *     drops `role: 'system'` there; the OpenAI family carries it);
   *   • a message whose role would collide with the turn at the end of the
   *     window, or that would split a `tool_use`/`tool_result` pair, is
   *     DEFERRED to the next boundary and recorded on
   *     `messagesDelivery.deferred`.
   *
   * Between 7.19.1 and 7.21.0 this field was unreachable by declaration:
   * content placed here was recorded as injected and never sent, so the
   * declaration was refused rather than believed. See
   * `messagesSlotRefusal.ts` for the whole arc.
   */
  readonly messages?: ReadonlyArray<{
    readonly role: ContextRole;
    readonly content: string;
  }>;
  /**
   * Tools this Injection contributes (Skills are the flavor that carries them).
   *
   * By default a Skill's tools go into the agent's tool registry at BUILD time
   * and are visible to the model from iteration 1 — activation adds the body,
   * not the tools. Only a Skill with `autoActivate: 'currentSkill'` has its
   * tools held back and readmitted through the tools slot while it is active.
   */
  readonly tools?: readonly Tool[];
}

// ─── Context — read-only state predicates can inspect ─────────────

/**
 * Context passed to `rule` predicates. Read-only snapshot of the
 * agent's iteration state. Internal mutable state is hidden.
 */
export interface InjectionContext {
  /** Current ReAct iteration (1-based). */
  readonly iteration: number;
  /** The current user message that started this turn. */
  readonly userMessage: string;
  /**
   * Conversation history up to (but not including) the current
   * iteration's LLM call. Includes prior iterations within the same turn.
   */
  readonly history: ReadonlyArray<{
    readonly role: ContextRole;
    readonly content: string;
    readonly toolName?: string;
  }>;
  /**
   * The most recent tool result, if the previous iteration ended in a
   * tool call. Used both by `rule` predicates and by `on-tool-return`
   * trigger evaluation.
   */
  readonly lastToolResult?: {
    readonly toolName: string;
    readonly result: string;
  };
  /**
   * IDs of LLM-activated injections that the LLM has activated this
   * turn (via their `viaToolName` tool call). Engine includes them
   * in the active set on subsequent iterations until turn end.
   */
  readonly activatedInjectionIds: readonly string[];
  /**
   * The skill-graph CURSOR — which skill node the graph is currently
   * *in*, persisted across iterations. Undefined before the first entry
   * (cold start). `skillGraph()` route edges are `from`-gated against it:
   * an edge `A → B` only fires while `currentSkillId === 'A'`, which kills
   * cross-skill edge bleed (an edge firing while in an unrelated skill).
   *
   * Set by the loop's cursor-update stage to `graph.nextSkill(ctx)` each
   * iteration; absent for agents that don't use `skillGraph()`. Plain
   * `rule`/`always`/`on-tool-return` predicates may ignore it.
   *
   * **Scope: ONE run.** "Persisted across iterations" means across the iterations of
   * a single `agent.run()`. It lives in that run's state, so a second `run()` on the
   * same agent begins cold — at the entry, not at the skill the previous turn ended
   * on. That is deliberate: a skill graph declares how ONE turn is routed, and a
   * cursor that survived would silently make turn 2 start somewhere the author never
   * declared. To carry a position between turns, persist the id in your own store and
   * start the next turn's graph from it.
   */
  readonly currentSkillId?: string;
  /**
   * The skill the MODEL asked for with `read_skill` on the previous iteration —
   * and that the skill-graph reachability gate ACCEPTED. One-shot: the tool-calls
   * stage rewrites it every iteration, so it names a pick made just now, never a
   * stale one (which is what keeps it from dragging the cursor backwards after a
   * declared edge has moved on).
   *
   * `graph.nextSkill` honours it as the "validated volunteer" hop — but only after
   * a declared edge has had its say, so an author's deterministic route is never
   * overridden by a model guess. Present only for agents with a `skillGraph()`
   * whose gate is wired; absent everywhere else, which is why plain `read_skill`
   * agents are untouched by it.
   */
  readonly pendingSkillPick?: string;
  /**
   * The relevance ranking of entry candidates from an entry scorer (`.entryBy()` /
   * `.entryByRelevance()`) — written by the PickEntry stage at turn start.
   * `defineRelevanceHint()` reads it to detect a near-tie. Absent unless the graph
   * used an entry scorer. `score` is the raw strategy score (cosine / word-overlap);
   * `relevance` is the softmax share (the surfaced %).
   */
  readonly entryScores?: ReadonlyArray<{
    readonly id: string;
    readonly score: number;
    readonly relevance: number;
  }>;
  /** Name of the entry scorer that produced `entryScores` (e.g. `'keyword'`,
   *  `'embedding'`). Absent unless an entry scorer ran. */
  readonly entryScorer?: string;
}

// ─── The primitive ─────────────────────────────────────────────────

/**
 * THE primitive. Five fields. Four trigger kinds. Three slot targets.
 *
 * Every named flavor (Skill, Steering, Instruction, Context, RAG,
 * Memory, Guardrail, …) is a sugar factory that produces one of these.
 *
 * @example
 *   // Direct construction (power user)
 *   const myInjection: Injection = {
 *     id: 'demo',
 *     flavor: 'instructions',
 *     trigger: { kind: 'rule', activeWhen: (ctx) => ctx.iteration > 1 },
 *     inject: { systemPrompt: 'Refine the previous answer.' },
 *   };
 *
 *   // Sugar (recommended)
 *   const myInjection2 = defineInstruction({
 *     id: 'demo',
 *     activeWhen: (ctx) => ctx.iteration > 1,
 *     prompt: 'Refine the previous answer.',
 *   });
 */
export interface Injection {
  /** Unique id. Used for observability + de-duplication + LLM-activation lookup. */
  readonly id: string;
  /** Human-readable description (Lens / docs / debug). */
  readonly description?: string;
  /** Observability tag. Drives Lens chip color + ContextRecorder source field. */
  readonly flavor: ContextSource;
  /** WHEN to activate. */
  readonly trigger: InjectionTrigger;
  /** WHAT to contribute (one or more slots). */
  readonly inject: InjectionContent;
  /**
   * Optional flavor-specific metadata. Engine ignores keys it doesn't
   * recognize; flavor factories use this for opt-in fields without
   * widening the Injection contract.
   *
   * Known keys:
   *   - `surfaceMode` (Skill) — `'auto' | 'system-prompt' | 'tool-only' | 'both'`
   *   - `autoActivate` (Skill) — `'currentSkill'`, the tool gate
   *   - `cache` (any flavor) — the cache directive
   *   - `refreshPolicy` (Skill) — `{ afterTokens, via }`; stored, not yet read
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ─── Evaluation result ─────────────────────────────────────────────

/**
 * Returned by `evaluateInjections()`. Slot subflows consume `active`;
 * `skipped` is observability metadata (predicate errors).
 */
export interface InjectionEvaluation {
  readonly active: readonly Injection[];
  readonly skipped: ReadonlyArray<{
    readonly id: string;
    readonly reason: 'predicate-threw' | 'unknown-trigger-kind';
    readonly error?: string;
  }>;
}

/**
 * POJO projection of an active Injection — flows through footprintjs
 * scope (which cannot serialize functions) so that slot subflows can
 * read it across the subflow boundary.
 *
 * Drops the `trigger` (already evaluated) and projects `inject.tools`
 * to schemas only (the Tool's `execute` function lives on the Agent's
 * closure-held registry, looked up by injection id at exec time).
 */
export interface ActiveInjection {
  readonly id: string;
  readonly flavor: import('../../events/types.js').ContextSource;
  readonly description?: string;
  /**
   * The DECLARED surfaceMode (Skill flavor only), copied through as written.
   * It drives runtime dispatch — slot subflows skip system-slot injection when
   * this is `'tool-only'`; the read_skill tool delivers the body in its result
   * for `'tool-only'` and `'both'`.
   *
   * `'auto'` and absent both deliver like `'system-prompt'` (body in system
   * slot, tool result is confirmation only). Nothing here resolves `'auto'`
   * against provider/model — `resolveSurfaceMode` is a recommendation callers
   * ask for, not a step in this projection.
   */
  readonly surfaceMode?: 'auto' | 'system-prompt' | 'tool-only' | 'both';
  /**
   * Per-skill tool gating (Skill flavor only). Set, it means this skill's
   * tools were kept OUT of the static registry, so the tools slot must
   * readmit them for as long as the skill is active — which is exactly what
   * `buildToolsSlot` does with `inject.tools` on every active injection.
   * Compose your own ToolProvider instead with `skillScopedTools` from
   * `agentfootprint/tool-providers`.
   */
  readonly autoActivate?: 'currentSkill';
  /**
   * The injection's cache directive, carried across the projection.
   *
   * It has to be here explicitly. `Injection.metadata` is a free-form bag
   * that this projection deliberately does NOT copy wholesale, and the cache
   * decision (`computeCacheMarkers`) reads exactly one key out of it — so
   * before 7.21.0 every injection arrived at that decision with no policy
   * and resolved to `'never'`, which meant no `tools` or `messages` cache
   * marker could ever fire in a real run no matter what the consumer
   * declared. Projecting the one key the decision reads makes the declared
   * policy the policy that is applied.
   *
   * Absent when the injection declared none (hand-built Injections); the
   * decision's own `?? 'never'` default then applies, as it always did.
   */
  readonly cache?: import('../../cache/types.js').CachePolicy;
  /**
   * Why THIS piece of retrieved content earned its place (8.8.0).
   *
   * Present only on injections a retrieval produced — one per admitted
   * chunk, carrying that chunk's own similarity score, its rank in the
   * candidate pool, and the floor it had to clear. The slot composer
   * copies these onto the `InjectionRecord`, which is what finally fills
   * `ContextInjectedPayload.retrievalScore` / `.rankPosition` /
   * `.threshold` — three fields declared since 2.x that nothing has ever
   * written, because until the recall was split per chunk there was no
   * single score for a record to carry.
   */
  readonly retrieval?: {
    readonly score: number;
    readonly rank: number;
    readonly threshold?: number;
  };
  readonly inject: {
    readonly systemPrompt?: string;
    readonly messages?: ReadonlyArray<{
      readonly role: import('../../events/types.js').ContextRole;
      readonly content: string;
    }>;
    /** Tool schemas only — `execute` lives on Agent's closure registry. */
    readonly tools?: ReadonlyArray<{
      readonly schema: import('../../adapters/types.js').LLMToolSchema;
      readonly injectionId: string;
    }>;
  };
}

/** Project a full Injection (with functions) into a scope-safe POJO. */
export function projectActiveInjection(inj: Injection): ActiveInjection {
  // Project per-skill metadata that slot subflows need to dispatch on.
  // `surfaceMode` drives the system-prompt-suppression decision.
  // `autoActivate` drives runtime tool gating: it tells the tools slot that
  // this skill's tools are not in the static registry and must be readmitted
  // while it is active.
  const meta = inj.metadata as
    | { surfaceMode?: string; autoActivate?: string; cache?: unknown }
    | undefined;
  const out: ActiveInjection = {
    id: inj.id,
    flavor: inj.flavor,
    ...(inj.description && { description: inj.description }),
    ...(meta?.surfaceMode && { surfaceMode: meta.surfaceMode as ActiveInjection['surfaceMode'] }),
    ...(meta?.autoActivate && {
      autoActivate: meta.autoActivate as ActiveInjection['autoActivate'],
    }),
    // The cache directive rides across too — see the field's note. Without it
    // the cache decision reads `undefined` for every injection and defaults to
    // "never cacheable", which silently discards what the consumer declared.
    ...(meta?.cache !== undefined && {
      cache: meta.cache as ActiveInjection['cache'],
    }),
    inject: {
      ...(inj.inject.systemPrompt && { systemPrompt: inj.inject.systemPrompt }),
      ...(inj.inject.messages && { messages: inj.inject.messages.map((m) => ({ ...m })) }),
      ...(inj.inject.tools && {
        tools: inj.inject.tools.map((t) => ({
          schema: { ...t.schema },
          injectionId: inj.id,
        })),
      }),
    },
  };
  return out;
}
