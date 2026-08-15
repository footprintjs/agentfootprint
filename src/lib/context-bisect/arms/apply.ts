/**
 * `applyArm` — the arm-shaped door onto the UNCHANGED removal machinery.
 *
 * The asymmetry this file exists to make visible: for a REMOVAL the library can
 * perform the intervention, because a removal is a filter over inputs and
 * `applyAblations` is that filter. For a SUBSTITUTION it cannot — replacing a
 * scorer happens inside the consumer's construction code, which no library can
 * reach into. So an arm's two halves are applied in two different places and by
 * two different parties:
 *
 *   - `arm.ablations` → HERE, by `applyAblations`, byte-for-byte the same call
 *     an `AblationRunner` already makes. No new filtering logic exists.
 *   - `arm.facets`    → by the consumer's own builder, which is why the engine
 *     VERIFIES them against the run manifest afterwards instead of applying
 *     them (see `manifest.ts`).
 *
 * There is deliberately no `applyFacets`. A function that took `{ scorer:
 * 'embedding' }` and returned something the consumer still had to interpret
 * would be a rename of the problem wearing the costume of a solution.
 */

import { applyAblations, type AblationTargets } from '../ablation.js';
import type { StrategyArm } from './types.js';

/** Anything with a stable id — mirrors `applyAblations`' own constraints. */
interface Identified {
  readonly id: string;
}

/** Anything with a named schema — the library's `Tool` fits. */
interface NamedTool {
  readonly schema: { readonly name: string };
}

/**
 * Apply this arm's REMOVALS to the inputs the agent is constructed from. An arm
 * with no `ablations` returns the targets unfiltered — the honest identity.
 *
 * @example inside an ArmRunner
 * ```ts
 * const runner: ArmRunner = async (arm, { seed }) => {
 *   const { tools, injections } = applyArm(arm, { tools: ALL_TOOLS, injections: ALL_FACTS });
 *   const agent = buildAgent({ retrieval: arm.facets?.memory?.retrieval, tools, injections, seed });
 *   const events: AgentfootprintEvent[] = [];
 *   agent.on('*', (e) => events.push(e));
 *   const output = await agent.run(question);
 *   return { output, manifest: manifestFromEvents(events) };
 * };
 * ```
 */
export function applyArm<
  TTool extends NamedTool,
  TInjection extends Identified,
  TMemoryEntry extends Identified,
>(
  arm: StrategyArm,
  targets: AblationTargets<TTool, TInjection, TMemoryEntry>,
): {
  tools: readonly TTool[];
  injections: readonly TInjection[];
  memoryEntries: readonly TMemoryEntry[];
} {
  return applyAblations(arm.ablations ?? [], targets);
}
