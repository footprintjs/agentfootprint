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
  /** Messages prepended to the messages slot when active. */
  readonly messages?: ReadonlyArray<{
    readonly role: ContextRole;
    readonly content: string;
  }>;
  /** Tools added to the tools slot when active. */
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
   *   - `refreshPolicy` (Skill) — `{ afterTokens, via }`
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
   * Resolved surfaceMode (Skill flavor only). Drives Block C runtime
   * dispatch — slot subflows skip system-slot injection when this is
   * `'tool-only'`; the read_skill tool delivers the body in its
   * result for `'tool-only'` and `'both'`.
   *
   * `'auto'` and absent both mean "keep v2.4 behavior" (body in
   * system slot, tool result is confirmation only). The Block A4
   * cascade resolves 'auto' against provider/model context at a
   * later layer; this projection stays declarative.
   */
  readonly surfaceMode?: 'auto' | 'system-prompt' | 'tool-only' | 'both';
  /**
   * Per-skill tool gating intent (Skill flavor only). Reserved for
   * Block C+ runtime auto-wiring of `skillScopedTools`. Today
   * consumers wire this manually via `agentfootprint/tool-providers`.
   */
  readonly autoActivate?: 'currentSkill';
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
  // `surfaceMode` drives the system-prompt-suppression decision (Block C).
  // `autoActivate` is reserved for runtime tool gating (forward-compat).
  const meta = inj.metadata as { surfaceMode?: string; autoActivate?: string } | undefined;
  const out: ActiveInjection = {
    id: inj.id,
    flavor: inj.flavor,
    ...(inj.description && { description: inj.description }),
    ...(meta?.surfaceMode && { surfaceMode: meta.surfaceMode as ActiveInjection['surfaceMode'] }),
    ...(meta?.autoActivate && {
      autoActivate: meta.autoActivate as ActiveInjection['autoActivate'],
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
