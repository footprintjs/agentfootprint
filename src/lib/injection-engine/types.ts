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

import type { ContextRole, ContextSource } from '../../events/types.js';
import type { SkillCachePolicy, SkillTool, SkillToolSchema } from './hostContract.js';
import type { ToolResultStatus } from './toolOutcome.js';
import { isSaidByPerson } from '../saidByPerson.js';
import { renderTemplate } from './promptTemplate.js';

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
   *
   * Typed as the NARROW {@link SkillTool} — a schema and something to run —
   * rather than agentfootprint's own `Tool` (9.34.0). Every other member of
   * `Tool` is optional, so a `Tool` satisfies this and this is accepted
   * everywhere a `Tool` is; what changes is that DECLARING a skill no longer
   * needs the framework's tool type, which is what lets this engine be read
   * by a host that has its own.
   */
  readonly tools?: readonly SkillTool[];
}

// ─── Context — read-only state predicates can inspect ─────────────

/**
 * Context passed to `rule` predicates. Read-only snapshot of the
 * agent's iteration state. Internal mutable state is hidden.
 */
export interface InjectionContext {
  /** Current ReAct iteration (1-based). */
  readonly iteration: number;
  /**
   * The turn's ACTION BUDGET — the agent's `maxIterations` (9.57.0).
   *
   * Absent only when the engine was driven without one (a hand-built
   * evaluation, a foreign host). Every agent-mounted evaluation carries it.
   *
   * It arrives PAIRED with {@link iterationsRemaining}: both are present or
   * neither is. A count without a denominator is the exact fabrication this
   * pairing exists to prevent — "you have used 23" says nothing, and "23 of
   * undefined" says something false.
   */
  readonly maxIterations?: number;
  /**
   * Actions left in this turn — `maxIterations - iteration`, never negative
   * (9.57.0). Computed by `iterationsRemainingOf`, the same one function the
   * cache decision and the request assembly use, so the three cannot drift by
   * one. Zero at the out-of-budget wrap-up call, which legally runs at
   * `maxIterations + 1`.
   *
   * Paired with {@link maxIterations} — see there.
   */
  readonly iterationsRemaining?: number;
  /** The current user message that started this turn. */
  readonly userMessage: string;
  /**
   * Conversation history up to (but not including) the current
   * iteration's LLM call. Includes prior iterations within the same turn.
   *
   * **Not everything with `role: 'user'` here was said by a person.** This
   * library writes five kinds of user-role message itself — a compaction
   * frame, a drop notice (whose text NAMES TOOLS), a schema-check correction,
   * an evidence-check correction (which QUOTES the model's own values), and a
   * message an Injection delivered — and all five sit in this list beside the
   * real ones. Read the person's messages with {@link saidByPerson}; a
   * predicate that scans raw `history` for a phrase will sooner or later match
   * our own bookkeeping.
   */
  readonly history: ReadonlyArray<{
    readonly role: ContextRole;
    readonly content: string;
    readonly toolName?: string;
    /**
     * WHO let this message in, when it was not the conversation (9.84.0).
     *
     * Present exactly when an Injection's `messages` slot delivered it — the
     * same marker `LLMMessage.injectedBy` carries, narrowed to the two fields
     * a routing decision has any business reading. It was on the object all
     * along; until 9.84.0 this type hid it, so a rule could hand-match the
     * four authored frames by their opening text and still not see this, the
     * fifth library-written class.
     *
     * Absent on every message that came from the conversation itself, which
     * is what makes `injectedBy === undefined` half of the rule
     * {@link saidByPerson} applies.
     */
    readonly injectedBy?: {
      /** The `Injection.id` that produced this message. */
      readonly injectionId: string;
      /** The injection's flavor — the `source` the slot records. */
      readonly flavor: ContextSource;
    };
  }>;
  /**
   * The most recent tool result, if the previous iteration ended in a
   * tool call. Used by `rule` predicates; `on-tool-return` triggers and
   * skill-graph routes read the full batch (`toolResults`) and fall back
   * to this when only the singular was provided. When the model called
   * several tools in one message this is the LAST of them — read
   * `toolResults` when the whole batch matters.
   *
   * **`result` is the string the MODEL read, which artifact PLACEMENT can
   * replace.** With `artifacts: { store, placement: { maxInlineChars } }`
   * configured, a tool result over the threshold is checked into the artifact
   * store and both the model and this field get the claim ticket instead —
   * `{"placed":true,"ref":"art_…","kind":"tool-result/<tool>",…}` — or the
   * tool's declared `resultKind` in place of that default kind (see
   * `placeResults` in stages/toolCalls.ts, where the other end of this note
   * lives). So a predicate matching on payload text stops firing once an
   * operator turns placement on or lowers the threshold, and one matching on
   * the ticket's `kind` only fires after it. Deliberate: routing judges what
   * the model was told, never a string that is not in the conversation. Match
   * on the tool NAME (`onToolReturn`) or a declared `status` (`onToolStatus`)
   * when you want a guard placement cannot move.
   */
  readonly lastToolResult?: {
    readonly toolName: string;
    readonly result: string;
  };
  /**
   * EVERY tool result of the previous iteration's batch, in call order
   * (9.16.0). When the model calls several tools in one message, each
   * result lands here as it happens — so `on-tool-return` triggers and
   * skill-graph routes evaluate the whole batch instead of only the last
   * call (`lastToolResult` === the last entry). A batch of one behaves
   * byte-identically to the singular. Absent on iteration 1 and for
   * contexts built by callers that only supply `lastToolResult` — use
   * {@link toolResultsOf} to read the batch with that fallback applied.
   *
   * Each `result` here is the same string the model read, so artifact
   * PLACEMENT can substitute a claim ticket for it — see the note on
   * {@link InjectionContext.lastToolResult}, which owns the statement.
   */
  readonly toolResults?: ReadonlyArray<{
    readonly toolName: string;
    readonly result: string;
    /** The provider's tool_use id for this call — names the exact call in
     *  `skill.route_conflict`. Absent for singular-fallback entries. */
    readonly toolCallId?: string;
    /** The tool's OWN declared outcome (9.19.0) — present only when the
     *  tool returned a result envelope carrying `status`. `onToolStatus`
     *  route edges key on it; a result without one can never match a
     *  status edge (an undeclared outcome is not evidence). */
    readonly status?: ToolResultStatus;
  }>;
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
   * The `propose-transition` tool effect the gate ACCEPTED last iteration
   * (9.19.0) — a TOOL's validated proposal to move the cursor, already
   * reachability-checked where it was accepted. One-shot by data: it is
   * stamped with the granting iteration and threaded into this context only
   * on the following one. `graph.nextSkill` honours it BETWEEN a declared
   * edge (the author's determinism still wins — `D1`) and the model's own
   * pick (a deterministic tool outranks a model guess): the winning clause
   * is recorded as `cursorMove.by: 'tool-proposal'`. Present only for
   * skill-graph agents whose tools returned one; absent everywhere else.
   */
  readonly pendingToolTransition?: { readonly targetSkillId: string };
  /**
   * Injection ids a `require-instruction` tool effect is PUSHING into this
   * very evaluation (9.19.0) — the lease-served set, computed per pass from
   * the granted leases (`'next-call'` serves exactly the following call;
   * `'until-skill-exit'` serves while the granting tenure holds). The
   * evaluator admits these ids into the active set beside what their own
   * triggers decided; `read_skill` stays the pull door. Absent unless a
   * lease is live this pass.
   */
  readonly leaseActiveIds?: readonly string[];
  /**
   * Injection ids the mount kernel is SUPPRESSING this pass (9.58.0) —
   * members of a parked map. The evaluator skips them with the honest
   * reason `'parked'` before any trigger or lease is consulted. Absent
   * unless the maps kernel is mounted AND something is parked, so the
   * common evaluation is byte-identical to 9.57.0.
   */
  readonly parkedIds?: readonly string[];
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
  /**
   * The turn-start routing verdict (SG-C) — written once per turn by the
   * RouteTurn stage on agents whose graph runs the cascade (`classify` or
   * `continuity: 'conversation'` configured), carried by the mount mappers.
   * The cursor resolver consumes `to` on iteration 1 (the same
   * precomputed-input pattern as `pendingSkillPick`); the tier-3 envelope
   * reads `offered` while the menu is outstanding. Absent everywhere else —
   * a graph without the new options never sees this key.
   */
  readonly turnRoute?: import('./routingPolicy.js').TurnRoute;
  /**
   * WHERE the active skill's declared procedure stands (9.18.0) — present
   * only while a stepped skill holds the tenure. THE FRESH pointer: the
   * Evaluate stage re-keys it (cursor moved → reset; tenant unchanged →
   * pass-through) BEFORE triggers run, so a `rule` predicate — the
   * auto-registered `defineStepsHint` first among them — judges the tenure
   * that is beginning, not the one that just ended. `step === total + 1`
   * means the procedure completed. Strictly subordinate to
   * `currentSkillId`: it can never move the cursor.
   */
  readonly stepPointer?: import('./skillSteps.js').StepPointer;
}

/**
 * The iteration's tool-result batch, in call order — with the singular
 * fallback applied (9.16.0). THE one reader for batch-aware evaluation:
 * `ctx.toolResults` when the runtime supplied it, else `[ctx.lastToolResult]`
 * for contexts built by callers that only know the singular, else `[]`.
 * Both the evaluator's `on-tool-return` arm and the skill-graph cursor
 * resolver go through here, so the two can never disagree about what the
 * batch was.
 */
export function toolResultsOf(ctx: InjectionContext): ReadonlyArray<{
  readonly toolName: string;
  readonly result: string;
  readonly toolCallId?: string;
  readonly status?: ToolResultStatus;
}> {
  return ctx.toolResults ?? (ctx.lastToolResult ? [ctx.lastToolResult] : []);
}

/**
 * The messages in `ctx.history` a PERSON actually wrote, in order (9.84.0).
 * THE one reader for a predicate that judges what was said.
 *
 * Five kinds of `role: 'user'` message in that list came from this library,
 * not from anybody: a compaction frame, a drop notice, the two in-loop
 * corrections, and a message an Injection delivered. They are ours, they are
 * in the person's voice, one of them names tools and two quote text the model
 * or a validator produced — so a rule written as
 *
 * ```ts
 * activeWhen: (ctx) => ctx.history.some((m) => m.content.includes('refund'))
 * ```
 *
 * fires on a summary of a refund conversation and on a notice saying the
 * refund tool's result was dropped. Written as
 * `saidByPerson(ctx).some(...)`, it fires only when somebody said it.
 *
 * The test itself is `isSaidByPerson` in `lib/saidByPerson.ts` — the same
 * function the window's refusal engine uses to decide which message it may
 * never drop, imported rather than restated so the two answers cannot differ.
 *
 * @param ctx the iteration context a trigger or entry rule was handed
 */
export function saidByPerson(ctx: InjectionContext): InjectionContext['history'] {
  return ctx.history.filter(isSaidByPerson);
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
   * `true` when `inject.systemPrompt` is a TEMPLATE — it names run-time facts
   * from the closed vocabulary in `promptTemplate.ts` and must be rendered
   * before it reaches anything (9.57.0).
   *
   * Top-level rather than a `metadata` key on purpose. At least one live path
   * rebuilds `metadata` wholesale (`toolsFromActiveSkill`), and a marker lost
   * there means the literal `{{actionsRemaining}}` reaches the model — the
   * exact class of failure this feature exists to prevent. Top-level fields
   * survive every `{...injection}` spread in the repo.
   *
   * The template text stays in `inject.systemPrompt`, so the nine build-time
   * readers that ask length/existence questions about it keep answering them
   * unchanged.
   */
  readonly templated?: true;
  /**
   * Optional flavor-specific metadata. Engine ignores keys it doesn't
   * recognize; flavor factories use this for opt-in fields without
   * widening the Injection contract.
   *
   * Known keys:
   *   - `surfaceMode` (Skill) — `'auto' | 'system-prompt' | 'tool-only' | 'both'`
   *   - `autoActivate` (Skill) — `'currentSkill'`, the tool gate
   *   - `cache` (any flavor) — the cache directive
   *   - `steps` / `onSkip` (Skill, 9.18.0) — the declared procedure; folded
   *     into a frozen StepPlan map at Agent build (skillSteps.ts owns the
   *     grammar)
   *   - `refreshPolicy` (Skill) — `{ afterTokens, via }`; DEPRECATED-pending-steps:
   *     stored, never read, and staying that way — superseded by `steps`
   *     (9.18.0), whose banner + result suffixes re-deliver by construction
   *     (see `RefreshPolicy`'s docstring)
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
    /**
     * `'unknown-fact'` (9.57.0): a templated instruction named a run-time fact
     * this evaluation cannot supply, so the WHOLE instruction was skipped.
     * All-or-nothing by design — a rendered gap, or a fabricated zero, is
     * worse than an instruction that did not speak.
     *
     * `'parked'` (9.58.0): the injection belongs to a map the mount kernel
     * parked — its contribution was served without corroboration for the
     * configured grace, so it stops riding until evidence re-engages it.
     * The map's own cursor is untouched.
     */
    readonly reason: 'predicate-threw' | 'unknown-trigger-kind' | 'unknown-fact' | 'parked';
    readonly error?: string;
  }>;
}

/**
 * THE BOUNDARY CONTRACT — an active Injection as plain, serializable data.
 *
 * POJO projection of an active Injection: it flows through footprintjs scope
 * (which cannot serialize functions) so that slot subflows can read it across
 * the subflow boundary. It drops the `trigger` (already evaluated) and
 * projects `inject.tools` to SCHEMAS ONLY — the tool's `execute` lives on the
 * host's closure-held registry, looked up by injection id at exec time.
 *
 * That description is also, exactly, what a host on ANOTHER framework needs
 * (9.34.0). This is the shape the injection engine hands out: no predicates,
 * no closures, no framework tool objects, nothing that has to survive a
 * `structuredClone` and doesn't. A host reads `inject.systemPrompt` into its
 * own system message, `inject.messages` into its own history, and
 * `inject.tools[].schema` into its own tool list — resolving `execute` by
 * `injectionId` in whatever registry it keeps. Which is why the two fields
 * that used to name our own layers by inline import — the tool schema and the
 * cache directive — are now the structural {@link SkillToolSchema} and
 * {@link SkillCachePolicy} from `hostContract.ts`: the same shapes, spelled
 * without reaching for an adapter or a cache implementation.
 *
 * It is a PROJECTION, not a second source of truth. `projectActiveInjection`
 * below is the only thing that builds one, and a field that is not on its
 * copy list does not cross — see `cache` for what that cost once.
 */
export interface ActiveInjection {
  readonly id: string;
  readonly flavor: ContextSource;
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
   * `agentfootprint/providers`.
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
  readonly cache?: SkillCachePolicy;
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
      readonly role: ContextRole;
      readonly content: string;
    }>;
    /** Tool schemas only — `execute` lives on Agent's closure registry. */
    readonly tools?: ReadonlyArray<{
      readonly schema: SkillToolSchema;
      readonly injectionId: string;
    }>;
  };
}

/**
 * Project a full Injection (with functions) into a scope-safe POJO.
 *
 * `ctx` (9.57.0) is THE rendering seam: it is the one moment the context and
 * the content are both in scope, and every downstream reader — the slots, the
 * cache decision, Deliver, the ledger, the recorders, a foreign host —
 * continues to see the same static `ActiveInjection` it always saw. Optional,
 * so a caller from before 9.57.0 still compiles.
 *
 * A TEMPLATED injection projected with no usable ctx comes back with NO
 * `systemPrompt` at all. Absence is honest; a literal `{{actionsRemaining}}`
 * in front of the model is not. Through the engine that path is unreachable —
 * `evaluateInjections` has already skipped such an injection by name.
 */
export function projectActiveInjection(
  inj: Injection,
  ctx?: Pick<InjectionContext, 'iteration' | 'maxIterations'>,
): ActiveInjection {
  // Project per-skill metadata that slot subflows need to dispatch on.
  // `surfaceMode` drives the system-prompt-suppression decision.
  // `autoActivate` drives runtime tool gating: it tells the tools slot that
  // this skill's tools are not in the static registry and must be readmitted
  // while it is active.
  const meta = inj.metadata as
    | { surfaceMode?: string; autoActivate?: string; cache?: unknown }
    | undefined;
  // Rendered HERE, once, so the projection every reader shares is already
  // plain text. `undefined` = a template whose facts this ctx cannot supply,
  // and then the piece is absent rather than gappy.
  const systemPrompt =
    inj.templated === true && inj.inject.systemPrompt !== undefined
      ? ctx === undefined
        ? undefined
        : renderTemplate(inj.inject.systemPrompt, ctx)
      : inj.inject.systemPrompt;
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
      ...(systemPrompt !== undefined && systemPrompt.length > 0 && { systemPrompt }),
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
