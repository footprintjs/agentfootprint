/**
 * GroupTranslator — UI-agnostic composition-level translator hook.
 *
 * Pattern: Visitor (GoF) at the composition boundary. Consumer supplies
 *          a translator function; each agentfootprint composition
 *          (Parallel, Sequence, Loop, Conditional, Agent, LLMCall)
 *          invokes it with composition-level metadata to produce a
 *          consumer-shaped UI output.
 * Role:    The per-COMPOSITION hook alongside footprintjs's per-NODE
 *          `StructureRecorder`. The two are independent — a consumer
 *          can attach either, both, or neither.
 *
 *          - StructureRecorder observes ONE spec node at a time (record).
 *          - GroupTranslator sees the WHOLE composition (compose).
 *
 *          For Lens's compound rendering (Parallel-as-container,
 *          Agent-as-drillable-card, LLMCall-as-card-with-slots),
 *          this is the right granularity: the translator knows the
 *          composition KIND and its full member list at once, so it
 *          can emit a single group-level shape with children pre-laid.
 *
 * Cascade: each composition that runs nested compositions exposes its
 *          members' OWN translated outputs via `GroupMember.uiGroup`.
 *          The consumer threads the same translator through every
 *          composition's construction (or per-method override via
 *          L1c) to get end-to-end coverage. No automatic propagation
 *          — propagation requires footprintjs-level changes which
 *          we're not making for this hook.
 */

import type { Runner } from './runner.js';

/**
 * The composition KIND a translator sees in `GroupMetadata.kind`.
 * Closed union — every agentfootprint composition declares exactly
 * one of these via the literal string baked into its `buildChart()`
 * description prefix and surfaced here in `GroupMetadata`.
 */
export type GroupKind =
  | 'Parallel'
  | 'Sequence'
  | 'Loop'
  | 'Conditional'
  | 'Agent'
  | 'LLMCall';

/**
 * One member of a composition. Shape is uniform across composition
 * kinds — Parallel branches, Sequence steps, Loop body, Conditional
 * branches, Agent tools/slots, LLMCall slots all map to this.
 *
 * `memberId` is the stable id the composition assigned (e.g. `legal`
 * for a Parallel branch, `step-classify` for a Sequence step,
 * `body` for a Loop). Consumers can correlate this with the
 * SpecNode's `subflowId` / `id` to drill in.
 *
 * `runner` is the underlying `Runner` instance — useful for the
 * consumer to call `member.runner.getSpec()` for the nested chart or
 * `member.runner.getUIGroup()` for the nested translation result
 * (when the same translator was threaded through that runner's
 * construction).
 *
 * `uiGroup` is the member's already-translated output. Populated
 * when the consumer threaded the same `groupTranslator` reference
 * into each member's construction; `undefined` otherwise.
 */
export interface GroupMember {
  readonly memberId: string;
  readonly runner: Runner;
  readonly uiGroup?: unknown;
}

/**
 * What a composition hands to its `groupTranslator` at build time.
 * All composition kinds emit the same shape — the `kind` discriminator
 * + the `extra` bag carry per-composition specifics.
 */
export interface GroupMetadata {
  readonly kind: GroupKind;
  readonly id: string;
  readonly name: string;
  readonly members: ReadonlyArray<GroupMember>;
  /**
   * Composition-specific extras. Carried verbatim from the
   * composition's own state — `Parallel` puts the merge strategy
   * here, `Loop` puts iteration budgets, `Conditional` puts the
   * fallback branch id, etc. Closed enough per kind that consumers
   * can switch on `kind` to read it safely.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * The consumer-supplied translator. Pure function — no async, no
 * side effects expected. Runs ONCE per composition at the moment
 * `getUIGroup()` is first called (memoised behaviour is per
 * composition's discretion).
 *
 * Output type `T` is whatever the consumer wants — a React Flow
 * group node, a Mermaid string, a domain-specific layout object,
 * anything. agentfootprint stays UI-agnostic.
 */
export interface GroupTranslator<T = unknown> {
  (group: GroupMetadata): T;
}
