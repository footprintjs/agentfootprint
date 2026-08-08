/**
 * Recorder-layer types — shapes builders use to communicate with recorders.
 *
 * Pattern: Data Transfer Object (Fowler, PoEAA).
 * Role:    Shared vocabulary between builders (which WRITE injections) and
 *          recorders (which OBSERVE those writes and emit grouped events).
 */

import type {
  ContextLifetime,
  ContextRecency,
  ContextRole,
  ContextSlot,
  ContextSource,
} from '../../events/types.js';

/**
 * An injection record written by a slot subflow into `scope[INJECTION_KEYS[slot]]`.
 * ContextRecorder reads this to construct the corresponding event payload.
 *
 * Builders write arrays of these; recorders diff old-vs-new to detect NEW
 * injections.
 */
export interface InjectionRecord {
  /** Short human-readable content summary. */
  readonly contentSummary: string;
  /** Full content (may be redacted downstream). Optional. */
  readonly rawContent?: string;
  /** Stable hash of the content — enables duplicate detection. */
  readonly contentHash: string;
  /** The 3-slot target (sanity-checked against the subflow ID). */
  readonly slot: ContextSlot;
  /** Where this content came from. */
  readonly source: ContextSource;
  /** Optional source-specific identifier (retriever id, skill id, ...). */
  readonly sourceId?: string;
  /** Upstream event reference (runtimeStageId that produced the content). */
  readonly upstreamRef?: string;
  /** Why this was injected. */
  readonly reason: string;
  /** Role, when injecting into messages slot. */
  readonly asRole?: ContextRole;
  /** Recency, when injecting into messages slot. */
  readonly asRecency?: ContextRecency;
  /** Position within the slot (messages index, system-prompt section order). */
  readonly position?: number;
  /** Section tag for structured system prompts (e.g. "<skill>", "<retrieved>"). */
  readonly sectionTag?: string;
  /** Retrieval / ranking evidence. */
  readonly retrievalScore?: number;
  readonly rankPosition?: number;
  readonly threshold?: number;
  readonly budgetSpent?: { readonly tokens: number; readonly fractionOfCap: number };
  /** How long this injection is expected to persist. */
  readonly expiresAfter?: ContextLifetime;
}

/**
 * Slot composition summary — written by a slot subflow at the END of its
 * composition pass. ContextRecorder emits one `context.slot_composed`
 * event per slot exit, built from this record.
 */
export interface SlotComposition {
  readonly slot: ContextSlot;
  readonly iteration: number;
  readonly budget: {
    readonly cap: number;
    readonly used: number;
    readonly headroomChars: number;
  };
  readonly sourceBreakdown: Readonly<
    Partial<Record<ContextSource, { readonly chars: number; readonly count: number }>>
  >;
  readonly orderingStrategy?: string;
  readonly droppedCount: number;
  readonly droppedSummaries: readonly string[];
}

/**
 * Eviction record — a piece that was removed from a slot under pressure.
 */
export interface EvictionRecord {
  readonly slot: ContextSlot;
  readonly contentHash: string;
  readonly reason: 'budget' | 'stale' | 'low_score' | 'policy' | 'user_revoked';
  readonly survivalMs: number;
}

/**
 * Budget-pressure warning — emitted before evictions fire.
 *
 * `cap` and `projected` are counted in {@link unit}. They were added in 8.14.0
 * beside `capTokens` / `projectedTokens`, which asserted a unit this channel
 * does not use: on THIS channel the numbers are CHARS (`composeSlot` measures
 * `String.length`), while a window strategy fills the same event with tokens.
 * 9.0.0 removed the two misnamed fields, and `cap` / `projected` are required
 * in their place — a record that carried neither pair would be a record with
 * no numbers on it.
 *
 * {@link unit} stays OPTIONAL, unlike on the event payload, because this
 * record is written by slot builders — including any a consumer wrote. A
 * missing `unit` reads as `'chars'`, which is not a guess: every write to
 * `COMPOSITION_KEYS.BUDGET_PRESSURE` comes off a slot composition, and a slot
 * composition is counted in characters by construction.
 *
 * `planAction: 'none'` means no mitigation was performed — nothing was
 * evicted or truncated and the full content still went to the LLM. It is
 * the honest reading of a slot that composed over its `budgetCap`.
 */
export interface BudgetPressureRecord {
  readonly slot: ContextSlot;
  readonly overflowBy: number;
  readonly planAction: 'evict' | 'summarize' | 'abort' | 'none';
  /** What the numbers count. Absent on a record written by a third-party slot
   *  builder — the slot channel is `'chars'`. */
  readonly unit?: 'chars' | 'tokens';
  /** The budget, in {@link unit}. */
  readonly cap: number;
  /** What was measured against it, in {@link unit}. */
  readonly projected: number;
}

// Convention scope keys for composition / eviction / pressure signals.
// These live alongside INJECTION_KEYS in conventions.ts; re-exported here
// for recorder convenience.
export const COMPOSITION_KEYS = {
  SLOT_COMPOSED: 'slotCompositions',
  EVICTED: 'slotEvictions',
  BUDGET_PRESSURE: 'slotBudgetPressures',
} as const;

export type CompositionKey = (typeof COMPOSITION_KEYS)[keyof typeof COMPOSITION_KEYS];
