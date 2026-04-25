/**
 * Shared helpers for v2 slot subflow builders.
 *
 * Pattern: utility module.
 * Role:    Tiny pure functions the slot builders share — hash, truncate,
 *          breakdown. Kept co-located to avoid cross-package import churn.
 */

import type {
  ContextSource,
  ContextSlot,
} from '../../events/types.js';
import type {
  InjectionRecord,
  SlotComposition,
} from '../../recorders/core/types.js';

/** Non-cryptographic stable hash — sufficient for InjectionRecord dedup. */
export function fnv1a(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** Truncate with ellipsis for contentSummary fields. */
export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

/** Aggregate injection chars/count per source — payload for SlotComposition. */
export function breakdown(
  injections: readonly InjectionRecord[],
): Readonly<Partial<Record<ContextSource, { chars: number; count: number }>>> {
  const out: Partial<Record<ContextSource, { chars: number; count: number }>> = {};
  for (const r of injections) {
    const chars = r.rawContent?.length ?? r.contentSummary.length;
    const existing = out[r.source];
    if (existing) {
      out[r.source] = {
        chars: existing.chars + chars,
        count: existing.count + 1,
      };
    } else {
      out[r.source] = { chars, count: 1 };
    }
  }
  return out;
}

/**
 * Build a SlotComposition summary record from injections + budget cap.
 * Drop tracking is opt-in — pass `dropped` when the slot actually
 * evicted anything during composition.
 */
export function composeSlot(
  slot: ContextSlot,
  iteration: number,
  injections: readonly InjectionRecord[],
  budgetCap: number,
  orderingStrategy?: string,
  dropped?: { count: number; summaries: readonly string[] },
): SlotComposition {
  const used = injections.reduce(
    (sum, r) => sum + (r.rawContent?.length ?? r.contentSummary.length),
    0,
  );
  return {
    slot,
    iteration,
    budget: { cap: budgetCap, used, headroomChars: Math.max(0, budgetCap - used) },
    sourceBreakdown: breakdown(injections),
    ...(orderingStrategy !== undefined && { orderingStrategy }),
    droppedCount: dropped?.count ?? 0,
    droppedSummaries: dropped?.summaries ?? [],
  };
}
