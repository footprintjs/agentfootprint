/**
 * CacheDecision subflow — provider-agnostic translation from
 * `activeInjections + DSL directives` → `CacheMarker[]`.
 *
 * This is the core "policy → markers" Lego layer. It runs every
 * iteration (after slot subflows produce their output, before the
 * CacheGate decider). Pure transform: no IO, no LLM calls, no
 * provider knowledge.
 *
 * Algorithm:
 *   1. Build a `CachePolicyContext` from agent state
 *   2. For each injection in `activeInjections`, evaluate its
 *      `metadata.cache` directive against the context → cacheable boolean
 *   3. For each slot (system / tools / messages):
 *      a. Walk the slot's contributions in order
 *      b. Find the LAST index that's contiguous-from-start cacheable
 *      c. Emit one CacheMarker at that boundary if any cacheable
 *   4. The moving breakpoint: when EVERYTHING the policies govern before
 *      the conversation is cacheable — every tools entry, every system
 *      entry, every delivered message — mark the conversation's LAST
 *      message, so the next call (which repeats the conversation and
 *      appends to it) reads the whole prefix back. See
 *      `conversationTailMarker`.
 *
 * Nothing is marked when the tool schemas change on every call
 * (`toolsVaryPerCall`, the findings offer): tools render first on a
 * breakpoint wire, so every breakpoint would pay the write premium on bytes
 * the next call does not send.
 *
 * Each marker is provider-agnostic. Provider strategy translates
 * to wire format in Phase 6+.
 *
 * Special case — base system prompt: the agent's
 * `agent.getSystemPromptCachePolicy()` value is folded in at index 0
 * of the system slot. Always-on injections (Steering / Fact /
 * always-active rules) follow.
 */

import type { TypedScope } from 'footprintjs';
import type { CacheMarker, CachePolicy, CachePolicyContext } from './types.js';
import type { LLMMessage } from '../adapters/types.js';
import type { ActiveInjection, Injection } from '../lib/injection-engine/types.js';
import { iterationsRemainingOf } from '../lib/iterationBudget.js';

/**
 * Subflow scope state. Set via inputMapper from the agent's parent
 * scope; produces `cacheMarkers` consumed by the BuildLLMRequest stage.
 */
export interface CacheDecisionState {
  // ── Inputs (set by parent scope's inputMapper) ────────────────
  readonly activeInjections: readonly Injection[];
  readonly iteration: number;
  readonly maxIterations: number;
  readonly userMessage: string;
  readonly lastToolName?: string;
  /**
   * Cumulative input tokens spent across all LLM calls in THIS
   * `agent.run()` invocation only. Resets at the start of each turn
   * (each `agent.run()` call). Predicates can use this for budget-
   * aware cache invalidation (e.g., "flush cache after 50K tokens").
   */
  readonly cumulativeInputTokens: number;
  /**
   * Base system prompt's cache policy (from
   * `agent.getSystemPromptCachePolicy()`). Folded in at index 0 of
   * the system slot's cache evaluation, ahead of any always-on
   * injections.
   */
  readonly systemPromptCachePolicy: CachePolicy;
  /** Global kill switch. When `true`, subflow emits zero markers. */
  readonly cachingDisabled: boolean;
  /**
   * The window as the request will carry it (7.21) — post-window-strategy,
   * post-delivery. Only the `messages` marker needs it, and it needs it for
   * one reason: that marker's `boundaryIndex` is read by providers as an
   * index INTO THIS ARRAY, so it has to be computed here from the array
   * itself. Optional so the standalone/unit uses of `computeCacheMarkers`
   * that predate delivery keep working; absent means no messages marker —
   * neither a delivered-message one nor the conversation tail.
   */
  readonly history?: readonly LLMMessage[];
  /**
   * `true` when the tool schemas are re-decorated on every call — the
   * findings offer (`.findings()`) binds the served result ids into every
   * tool's `_findings` schema, newest first, so the list changes whenever a
   * result is served. Tools render FIRST on a breakpoint wire (Anthropic:
   * tools → system → messages), so no prefix through them repeats from one
   * tool-calling iteration to the next, and every breakpoint would pay the
   * cache-write premium on bytes the next call does not send — measured on
   * the inputs bench, 97% of request bytes marked and 3% read back. The
   * decision places none. Absent ≡ `false`. The agent charts pass it at BUILD
   * time (`cacheDecisionStage`), never through scope.
   */
  readonly toolsVaryPerCall?: boolean;
  // ── Output ────────────────────────────────────────────────────
  cacheMarkers: readonly CacheMarker[];
}

/**
 * Evaluate a `CachePolicy` against the current context.
 * Returns `true` if the policy says THIS iteration's content is cacheable.
 */
export function evaluateCachePolicy(policy: CachePolicy, ctx: CachePolicyContext): boolean {
  if (policy === 'always') return true;
  if (policy === 'never') return false;
  if (policy === 'while-active') {
    // Membership in `activeInjections` IS being-active. By the time
    // the subflow walks an injection, the InjectionEngine has already
    // confirmed it's active for THIS iteration. So 'while-active'
    // policy → cacheable while in the list.
    return true;
  }
  if (typeof policy === 'object' && policy !== null && 'until' in policy) {
    // Cache UNTIL predicate returns true. So cacheable iff !predicate.
    try {
      return !policy.until(ctx);
    } catch {
      // Failing predicates are treated as "do not cache" — fail-closed.
      // Avoids the failure mode where a buggy predicate accidentally
      // caches volatile content.
      return false;
    }
  }
  // Unknown policy form — fail-closed (don't cache).
  return false;
}

/**
 * Identify which slots an injection contributes to. An injection can
 * target multiple slots simultaneously (Skills target both system +
 * tools); we visit each contributing slot independently.
 */
export function injectionTargetSlots(
  injection: Injection,
): ReadonlyArray<'system' | 'tools' | 'messages'> {
  const slots: Array<'system' | 'tools' | 'messages'> = [];
  if (injection.inject.systemPrompt && injection.inject.systemPrompt.length > 0) {
    slots.push('system');
  }
  if (injection.inject.tools && injection.inject.tools.length > 0) {
    slots.push('tools');
  }
  if (injection.inject.messages && injection.inject.messages.length > 0) {
    slots.push('messages');
  }
  return slots;
}

/**
 * Pure transform: state → markers. Exported so tests can exercise
 * the algorithm directly without the FlowChartExecutor ceremony of
 * mounting the subflow as a child of a parent chart.
 *
 * The subflow body (`decide` below) is a thin wrapper that pulls
 * state from scope and delegates here.
 */
export function computeCacheMarkers(
  state: Omit<CacheDecisionState, 'cacheMarkers'>,
): readonly CacheMarker[] {
  // Kill switch short-circuits immediately
  if (state.cachingDisabled || state.toolsVaryPerCall === true) return [];

  const ctx: CachePolicyContext = {
    iteration: state.iteration,
    iterationsRemaining: iterationsRemainingOf(state.maxIterations, state.iteration),
    userMessage: state.userMessage,
    ...(state.lastToolName !== undefined && { lastToolName: state.lastToolName }),
    cumulativeInputTokens: state.cumulativeInputTokens,
  };

  // Per-slot list of {cacheable, reason}
  type SlotEntry = { readonly cacheable: boolean; readonly reason: string };
  const perSlot: Record<'system' | 'tools', SlotEntry[]> = {
    system: [],
    tools: [],
  };
  /** Cacheability by injection id — what the messages pass indexes with. */
  const cacheableById = new Map<string, boolean>();

  // Index 0 of system slot is the base system prompt
  perSlot.system.push({
    cacheable: evaluateCachePolicy(state.systemPromptCachePolicy, ctx),
    reason: 'base system prompt',
  });

  // Walk each active injection
  for (const inj of state.activeInjections) {
    // The policy the consumer declared. `metadata.cache` is where a full
    // `Injection` carries it; `cache` is where the scope-safe
    // `ActiveInjection` projection carries it (the projection drops
    // `metadata`, so reading only the former made every real run resolve to
    // 'never' — see ActiveInjection.cache).
    const policy =
      (inj.metadata?.cache as CachePolicy | undefined) ??
      ((inj as unknown as ActiveInjection).cache as CachePolicy | undefined) ??
      'never';
    const cacheable = evaluateCachePolicy(policy, ctx);
    const reason = `${inj.flavor}:${inj.id}`;
    cacheableById.set(inj.id, cacheable);
    for (const slot of injectionTargetSlots(inj)) {
      if (slot === 'messages') continue; // indexed against the wire, below
      perSlot[slot].push({ cacheable, reason });
    }
  }

  // Find per-slot last-contiguous-cacheable boundary; emit a marker per
  // slot that has at least one cacheable entry from index 0.
  const markers: CacheMarker[] = [];
  for (const slot of ['system', 'tools'] as const) {
    const entries = perSlot[slot];
    let boundary = -1;
    let lastReason = '';
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i].cacheable) break;
      boundary = i;
      lastReason = entries[i].reason;
    }
    if (boundary >= 0) {
      markers.push({
        field: slot,
        boundaryIndex: boundary,
        ttl: 'short',
        reason: `${slot} stable prefix (${boundary + 1} entries, ending at ${lastReason})`,
      });
    }
  }

  const history = state.history ?? [];
  const messagesMarker = messagesMarkerFor(history, cacheableById);
  if (messagesMarker) markers.push(messagesMarker);

  const prefixCacheable =
    perSlot.system.every((e) => e.cacheable) && perSlot.tools.every((e) => e.cacheable);
  const tail = conversationTailMarker(history, cacheableById, prefixCacheable);
  if (tail && tail.boundaryIndex !== messagesMarker?.boundaryIndex) markers.push(tail);

  return markers;
}

/**
 * The moving breakpoint — the conversation's LAST message, marked.
 *
 * An agent loop sends the whole conversation on every call and only ever
 * appends to it (the window stage is its one writer; a compaction is the
 * rare exception and simply misses once). So everything up to this call's
 * last message is the next call's prefix, byte for byte, and a breakpoint
 * here lets the next call read it back instead of paying for it again. The
 * index is a position in `history`, which is where `callLLM` puts the
 * conversation — request-only lines (the staged-refs nudge, the time line,
 * the evidence conclusion) are appended AFTER it and are never inside the
 * cached prefix, so a line that is gone on the next call cannot break it.
 *
 * Placed only when the prefix before the conversation is cacheable this
 * iteration — every system and tools entry (`prefixCacheable`) — and every
 * message an injection delivered into the conversation is too: on a
 * breakpoint wire this marker covers all of them, and marking past a piece
 * its policy calls volatile would write a cache entry the next call cannot
 * read. Fail-closed, like every other unknown in this file.
 */
function conversationTailMarker(
  history: readonly LLMMessage[],
  cacheableById: ReadonlyMap<string, boolean>,
  prefixCacheable: boolean,
): CacheMarker | undefined {
  if (!prefixCacheable || history.length === 0) return undefined;
  for (const m of history) {
    const by = m.injectedBy;
    if (by !== undefined && cacheableById.get(by.injectionId) !== true) return undefined;
  }
  const boundary = history.length - 1;
  return {
    field: 'messages',
    boundaryIndex: boundary,
    ttl: 'short',
    reason:
      `conversation tail through wire index ${boundary} — the moving breakpoint: the next ` +
      'call repeats this prefix and appends after it',
  };
}

/**
 * The `messages` marker, computed against the ACTUAL wire array (7.21).
 *
 * The old version counted entries in a per-slot list of injections and handed
 * that count to providers who read it as a position in `request.messages` —
 * two different index spaces wearing one name. It could not be caught because
 * it could not fire: nothing had been able to target the messages slot since
 * 7.19.1. Delivery makes it reachable, so it is computed the only way that
 * can be true — from the array the marker points into.
 *
 * The prefix rule is unchanged in spirit, just re-anchored: walk the DELIVERED
 * messages in wire order from the first one, stop at the first that is not
 * cacheable this iteration, and name the last one that was. An injection that
 * delivered on an earlier iteration and is no longer active has no policy now,
 * so it counts as not cacheable — fail-closed, like every other unknown in
 * this file. No delivered message, or the first one not cacheable, means no
 * marker at all: the conversation itself declares no cache policy, and this
 * decision does not invent one for it.
 */
function messagesMarkerFor(
  history: readonly LLMMessage[],
  cacheableById: ReadonlyMap<string, boolean>,
): CacheMarker | undefined {
  let boundary = -1;
  let lastReason = '';
  let count = 0;
  for (let i = 0; i < history.length; i++) {
    const by = history[i]!.injectedBy;
    if (by === undefined) continue;
    if (cacheableById.get(by.injectionId) !== true) break;
    boundary = i;
    lastReason = `${by.flavor}:${by.injectionId}`;
    count++;
  }
  if (boundary < 0) return undefined;
  // The reason says what was actually CHECKED. The prefix physically includes
  // the conversation messages sitting between the delivered ones, and those are
  // safe to cache for a reason this function never evaluated — a committed turn
  // does not change — not because a policy said so. Claiming otherwise would
  // describe a stability nobody measured.
  return {
    field: 'messages',
    boundaryIndex: boundary,
    ttl: 'short',
    reason:
      `messages prefix through wire index ${boundary} ` +
      `(${count} cacheable delivered message${count === 1 ? '' : 's'}, ending at ${lastReason}; ` +
      `the conversation turns inside the prefix carry no policy of their own)`,
  };
}

/** What a chart knows about its own wire when it builds the decision stage. */
export interface CacheDecisionStageOptions {
  /**
   * The chart re-decorates every tool schema per call (the findings door) —
   * see {@link CacheDecisionState.toolsVaryPerCall}. A BUILD-time fact, so it
   * is closed over here rather than read from scope: an unarmed agent's
   * decision stage reads exactly the keys it always did.
   */
  readonly toolsVaryPerCall?: boolean;
}

/**
 * The decision stage, built for one chart. Thin scope-binding wrapper around
 * `computeCacheMarkers`, so it can serve as the ROOT stage of the `sf-cache`
 * subflow (a chart cannot start with a nested subflow) — no logic
 * duplication.
 */
export function cacheDecisionStage(
  options: CacheDecisionStageOptions = {},
): (scope: TypedScope<CacheDecisionState>) => void {
  const toolsVaryPerCall = options.toolsVaryPerCall === true;
  return (scope) => {
    scope.cacheMarkers = computeCacheMarkers({
      activeInjections: scope.activeInjections,
      iteration: scope.iteration,
      maxIterations: scope.maxIterations,
      userMessage: scope.userMessage,
      ...(scope.lastToolName !== undefined && { lastToolName: scope.lastToolName }),
      cumulativeInputTokens: scope.cumulativeInputTokens,
      systemPromptCachePolicy: scope.systemPromptCachePolicy,
      cachingDisabled: scope.cachingDisabled,
      ...(scope.history !== undefined && { history: scope.history }),
      ...(toolsVaryPerCall && { toolsVaryPerCall: true }),
    });
  };
}

/** The decision stage for a chart whose tool schemas are stable per call. */
export const decideCacheMarkers: (scope: TypedScope<CacheDecisionState>) => void =
  cacheDecisionStage();

// NOTE: the cache decision is now the ROOT stage of the `sf-cache` subflow
// (see core/agent/buildCacheSubflow.ts) via the exported `decideCacheMarkers`
// above. The former standalone `cacheDecisionSubflow` FlowChart export was
// removed when the agent stopped mounting it directly — `computeCacheMarkers`
// + `decideCacheMarkers` are the reusable pieces.
