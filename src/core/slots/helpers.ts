/**
 * Shared helpers for slot subflow builders.
 *
 * Pattern: utility module.
 * Role:    Tiny pure functions the slot builders share — hash, truncate,
 *          breakdown. Kept co-located to avoid cross-package import churn.
 */

import type { ContextSource, ContextSlot } from '../../events/types.js';
import type {
  BudgetPressureRecord,
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

/**
 * Overflow detector for slot compositions.
 *
 * Returns a `BudgetPressureRecord` when `used > cap`, otherwise `null`.
 * `cap <= 0` is the "no budget" sentinel (see buildMessageApiChart's
 * `{ cap: 0, used: 0 }` composition) — it never overflows.
 *
 * `planAction: 'none'` is the honest answer: the built-in slots evict and
 * truncate NOTHING, so the full content went to the LLM and this record is
 * the loud signal that the slot's budget is not being respected. Units are
 * CHARS despite the historical `*Tokens` field names.
 */
export function slotOverflow(composition: SlotComposition): BudgetPressureRecord | null {
  const { cap, used } = composition.budget;
  if (cap <= 0 || used <= cap) return null;
  return {
    slot: composition.slot,
    capTokens: cap,
    projectedTokens: used,
    overflowBy: used - cap,
    planAction: 'none',
  };
}

/**
 * Human-facing warning text for a slot overflow. Says what actually
 * happened (nothing was truncated) and what to do about it — the typed
 * `context.budget_pressure` event carries the machine-readable truth.
 */
export function formatOverflowWarning(opts: {
  readonly pressure: BudgetPressureRecord;
  readonly itemCount: number;
  /** Singular noun for what filled the slot, e.g. 'tool definition'. */
  readonly itemNoun: string;
  /** Plural noun used in the "full … were sent" clause, e.g. 'definitions'. */
  readonly contentNoun: string;
  /** Actionable remedy sentence, ending with a period. */
  readonly remedy: string;
}): string {
  const { pressure, itemCount, itemNoun, contentNoun, remedy } = opts;
  return (
    `[agentfootprint] ${pressure.slot} slot over budget: ` +
    `${pressure.projectedTokens}/${pressure.capTokens} chars (+${pressure.overflowBy}), ` +
    `${itemCount} ${itemNoun}(s). Nothing was truncated — the full ${contentNoun} were sent ` +
    `to the LLM — but the slot budget signal is unreliable. ${remedy}`
  );
}
