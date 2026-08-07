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
 * `capTokens` / `projectedTokens` are historical names: on THIS channel the
 * numbers are CHARS (`composeSlot` measures `String.length`). Renaming them
 * would be breaking, so they stay and {@link unit} / {@link cap} /
 * {@link projected} were added beside them in 8.14.0.
 *
 * The three new fields are OPTIONAL here, unlike on the event payload, because
 * this record is written by slot builders — including any a consumer wrote —
 * and a record from one of those still typechecks. `ContextRecorder` fills a
 * missing `unit` with `'chars'`, which is not a guess: every write to
 * `COMPOSITION_KEYS.BUDGET_PRESSURE` comes off a slot composition, and a slot
 * composition is counted in characters by construction.
 *
 * `planAction: 'none'` means no mitigation was performed — nothing was
 * evicted or truncated and the full content still went to the LLM. It is
 * the honest reading of a slot that composed over its `budgetCap`.
 */
export interface BudgetPressureRecord {
  readonly slot: ContextSlot;
  /** @deprecated Read {@link cap} with {@link unit}. Still written. */
  readonly capTokens: number;
  /** @deprecated Read {@link projected} with {@link unit}. Still written. */
  readonly projectedTokens: number;
  readonly overflowBy: number;
  readonly planAction: 'evict' | 'summarize' | 'abort' | 'none';
  /** What the numbers count. Absent on a record written before 8.14.0 (or by
   *  a third-party slot builder) — the slot channel is `'chars'`. */
  readonly unit?: 'chars' | 'tokens';
  /** Same value as {@link capTokens}, under a name that asserts no unit. */
  readonly cap?: number;
  /** Same value as {@link projectedTokens}, under a name that asserts no unit. */
  readonly projected?: number;
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
