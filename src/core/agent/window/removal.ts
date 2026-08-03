/**
 * window/removal — "these messages left" → the facts the ledger needs.
 *
 * Pattern: Pure function over the meter's provenance.
 * Role:    core/ layer. The stage binds this into every
 *          `WindowStrategyInput.removalFacts`, so a strategy can name what it
 *          removed without ever touching the meter — and cannot file a
 *          removal it is unable to name.
 * Emits:   N/A.
 */

import type { MessageOrigin } from '../../../recorders/core/CompactionMeter.js';
import type { RemovalFacts, WindowEviction } from './strategy.js';

/**
 * Resolve which stages wrote the removed messages, and how long each lived.
 *
 * `survivalMs` is measured (`atMs - bornAtMs`), and is 0 — not a guess — when
 * a message's birth is unknown, which happens only for a window seeded from
 * outside this run.
 */
export function removalFacts(
  origins: readonly MessageOrigin[],
  indices: readonly number[],
  atMs: number,
): RemovalFacts {
  const removedStageIds: string[] = [];
  const evictions: WindowEviction[] = [];
  for (const index of indices) {
    const origin = origins[index];
    if (origin !== undefined && !removedStageIds.includes(origin.stageId)) {
      removedStageIds.push(origin.stageId);
    }
    evictions.push({
      index,
      survivalMs: origin === undefined ? 0 : Math.max(0, atMs - origin.bornAtMs),
    });
  }
  return { removedStageIds, evictions };
}

/** `[from, toExclusive)` as a list of indices. */
export function indexRange(from: number, toExclusive: number): number[] {
  const out: number[] = [];
  for (let i = from; i < toExclusive; i++) out.push(i);
  return out;
}
