/**
 * Narrative beats — the unit of narrative memory.
 *
 * A `NarrativeBeat` is a self-contained summary extracted from one or
 * more messages during a turn. Instead of persisting raw conversation
 * forever, a narrative pipeline compresses each turn into beats and
 * recalls them by composing beats back into a coherent story.
 *
 * Core properties:
 *   - **Summary**: a single sentence describing what happened.
 *   - **Importance**: 0..1 score the picker uses to prefer salient
 *     beats when the context-token budget is tight.
 *   - **Refs**: ids of the source messages the beat was extracted
 *     from. Lets consumers walk backwards from a recalled beat to
 *     the raw source — the explainability story.
 *   - **Category**: optional free-form tag (e.g. `"identity"`,
 *     `"preference"`, `"fact"`). Extractors / consumers pick their
 *     own taxonomy.
 *
 * Beats are persisted via the ordinary `MemoryStore` interface —
 * `MemoryEntry<NarrativeBeat>` slots in unchanged. No storage changes
 * needed to support narrative memory.
 */

/** Importance score in the half-open range [0, 1]. */
export type BeatImportance = number;

export interface NarrativeBeat {
  /** One-sentence summary of what happened in this beat. */
  readonly summary: string;

  /**
   * Importance score in [0, 1]. Picker stages use this to prefer
   * salient beats when the budget is tight. Default 0.5 (neutral).
   * Values outside [0, 1] are clamped by `asImportance()`.
   */
  readonly importance: BeatImportance;

  /**
   * Ids of the source messages this beat was extracted from. Consumers
   * answer "why does the agent remember X?" by walking refs backwards
   * to the raw message text. May be empty for synthesized beats
   * (e.g., beats produced from prior beats during compaction).
   */
  readonly refs: readonly string[];

  /**
   * Optional free-form category — `"identity"`, `"preference"`,
   * `"task-status"`, etc. Extractors / consumers pick their own
   * taxonomy. Useful for filtering recalls by type.
   */
  readonly category?: string;
}

/**
 * Clamp a value to the valid [0, 1] importance range. Non-finite
 * inputs collapse to 0.5 (neutral) so extractors that produce NaN
 * / ±Infinity don't poison the picker's comparisons.
 */
export function asImportance(value: unknown): BeatImportance {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Duck-typed guard — true iff `value` has the shape of a
 * `NarrativeBeat`. Used by pipelines that handle mixed-payload stores
 * (raw messages + beats) to route entries correctly.
 */
export function isNarrativeBeat(value: unknown): value is NarrativeBeat {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.summary === 'string' && typeof v.importance === 'number' && Array.isArray(v.refs);
}
