// tools.* (3)
export interface ToolsOfferedPayload {
  readonly availableIds: readonly string[];
  readonly withheldIds: readonly string[];
  readonly withheldReasons: Readonly<
    Record<string, 'permission' | 'skill_inactive' | 'gated' | 'cost_guard'>
  >;
  readonly reason: string;
}

export interface ToolsActivatedPayload {
  readonly toolId: string;
  readonly reason: 'skill_activated' | 'autoActivate' | 'permission_granted';
  readonly source?: string;
}

export interface ToolsDeactivatedPayload {
  readonly toolId: string;
  readonly reason: 'skill_deactivated' | 'permission_revoked';
}

/**
 * Emitted at the start of a `ToolProvider.list(ctx)` call inside the
 * Discover stage. Pairs with `tools.discovery_completed` (success) or
 * `tools.discovery_failed` (error). Use the pair to measure async-
 * provider latency per iteration without joining stages by hand.
 */
export interface ToolsDiscoveryStartedPayload {
  readonly providerId: string | undefined;
  readonly iteration: number;
}

/**
 * Emitted when `ToolProvider.list(ctx)` resolves successfully. The
 * `durationMs` is the wall-clock between `tools.discovery_started` and
 * resolution; `toolCount` is the size of the returned tool list. For
 * sync providers `durationMs` is ~0; for async hub-backed providers
 * this is your observability hook for catalog-fetch latency.
 */
export interface ToolsDiscoveryCompletedPayload {
  readonly providerId: string | undefined;
  readonly iteration: number;
  readonly durationMs: number;
  readonly toolCount: number;
}

/**
 * Emitted when a custom `ToolProvider.list(ctx)` throws or rejects.
 * The iteration is aborted; a configured `reliability` rule decides
 * whether to retry, fall back, or fail-fast. `providerId` lets
 * consumers route alerts to the right hub adapter (rube / mcp /
 * custom-discovery). `durationMs` measures how long the failed call
 * spent before throwing, so timeouts vs immediate rejections are
 * distinguishable.
 */
export interface ToolsDiscoveryFailedPayload {
  readonly providerId: string | undefined;
  readonly error: string;
  readonly errorName: string;
  readonly iteration: number;
  readonly durationMs: number;
}

/**
 * The parties that can put a tool name on the wire or answer to one — the
 * vocabulary `tools.shadowed` and `tools.claim_swallowed` name them in (9.92.0).
 *
 *   • `registry`  — a static `.tool()` registration;
 *   • `provider`  — a `ToolProvider` (`.toolProvider()`, MCP through `staticTools`,
 *                   `.selfExplain()`'s trace pack — its id says which);
 *   • `skill`     — a skill's `tools:[]`, always-visible or scoped;
 *   • `framework` — an auto-attach the framework owns: `read_skill`, `present`,
 *                   `skip_step`.
 */
export type ToolNameChannel = 'provider' | 'registry' | 'skill' | 'framework';

/**
 * Emitted, per iteration, for a tool name that two parties BOTH put forward
 * for the wire and only one could win (8.7.0; re-subjected 9.92.0).
 *
 * Until 9.92.0 the two halves of a call could come from different parties:
 * the tools slot merges `[static, provider, skill, step]` first-wins while the
 * dispatcher resolved a build-time map first, so the model read one contract
 * and called another implementation. Since 9.92.0 dispatch FOLLOWS THE OFFER —
 * the party whose contract is on the wire is the party that answers — so
 * `schemaFrom` and `dispatchTo` name the same party, and both are the wire's.
 * The event still fires because the collision is still real: the losing
 * party's contract was hidden behind the winner's on this iteration, and a
 * rename is still the fix. The loser is named by the companion
 * `tools.claim_swallowed`, which fires for every party that lost a name whether
 * or not its contract competed this iteration.
 *
 * Not an error event: the run continues and a tool really executes. It fires
 * once per contested name PER ITERATION, because a provider list is resolved
 * per iteration and a collision can begin mid-run.
 *
 * Carries names only — never args, never results, never a description body.
 */
export interface ToolsShadowedPayload {
  /** The contested tool name. */
  readonly toolName: string;
  readonly iteration: number;
  /** Which party's CONTRACT the model was shown — the wire's party. */
  readonly schemaFrom: ToolNameChannel;
  /** That party's id — the `ToolProvider.id` or the skill id, when it has one. */
  readonly schemaFromId?: string;
  /** Which party's IMPLEMENTATION answers a call to this name — since 9.92.0
   *  always the wire's party, so it equals `schemaFrom`. Kept because a
   *  consumer that branched on it keeps working and the sentence stays true. */
  readonly dispatchTo: ToolNameChannel;
  /** That party's id, when it has one. */
  readonly dispatchToId?: string;
}

/**
 * Emitted, per iteration, for a party whose claim to a tool name is DEAD on
 * that iteration: another party holds the name on the wire, and since dispatch
 * follows the offer the loser's implementation cannot be reached by any call
 * (9.92.0 — the `claim-swallowed` family of the divergence walk).
 *
 * It fires whether or not the loser's contract competed for the wire this
 * iteration — a provider tool whose name a static `.tool()` already holds, a
 * skill tool named after a framework auto-attach, a never-activated scoped
 * skill's tool whose name a provider serves. Silence about a dead claim is the
 * defect this event exists to end: the party registered a tool the model can
 * never reach, and the trace said nothing.
 *
 * Carries names only — never args, never results, never a description body.
 */
export interface ToolsClaimSwallowedPayload {
  /** The contested tool name. */
  readonly toolName: string;
  readonly iteration: number;
  /** The party whose claim is dead this iteration. */
  readonly lostBy: ToolNameChannel;
  /** That party's id — the `ToolProvider.id` or the skill id, when it has one. */
  readonly lostById?: string;
  /** The party holding the name on the wire — and therefore answering it. */
  readonly wonBy: ToolNameChannel;
  /** That party's id, when it has one. */
  readonly wonById?: string;
}

/**
 * Emitted when the dispatcher hands a call to a tool whose name was NOT on
 * this iteration's wire (9.92.0).
 *
 * The capability law keeps a registry-routed tool dispatchable after a
 * narrowing takes it off the offer — a later step's tool, a parked map's tool,
 * a scoped skill's tool named from a restored transcript — and that is
 * deliberate. What was missing was the record: a call answered by a tool the
 * model was not shown on THIS call looked exactly like one that was. This is
 * that record, once per such call. It fires ONLY when the answering party is
 * the one the model last read this name under (or the name's only claimant
 * when it was never served); a name whose last-served contract belonged to a
 * party that can no longer answer is refused as a recorded tool result
 * instead (`toolCalls.ts` · `notServedResult`), never handed to somebody else.
 *
 * Carries names only — never args, never results.
 */
export interface ToolsAnsweredOffWirePayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** The party whose implementation answered. */
  readonly answeredBy: ToolNameChannel;
  /** That party's id — the skill id or the `ToolProvider.id`, when it has one. */
  readonly answeredById?: string;
}
