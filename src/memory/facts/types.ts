/**
 * Facts — stable, timeless claims about the user or world.
 *
 * Unlike beats (which summarize what happened in a turn) and messages
 * (which are the raw conversation), facts capture *what's currently
 * true*:
 *   - Identity: "user.name" = "Alice"
 *   - Preferences: "user.favorite_color" = "blue"
 *   - Commitments: "task.ORD-123.status" = "refunded"
 *
 * Facts dedupe by `key`. The storage layer uses stable ids of the form
 * `fact:${key}`, so a second write to the same key overwrites the
 * first. This is the difference from beats/messages (which are
 * append-only log entries).
 */

/**
 * A single fact — a key/value claim with optional confidence +
 * category metadata.
 *
 * **Key convention**: dotted path for nested taxonomies
 * (`user.name`, `user.preferences.color`, `task.ORD-123.status`).
 * The library doesn't enforce any structure — extractors define their
 * own key namespaces.
 */
export interface Fact<V = unknown> {
  /** Stable key — used to dedupe. */
  readonly key: string;

  /** The claimed value. JSON-serializable. */
  readonly value: V;

  /**
   * Extractor's confidence in `[0, 1]`. Used by `pickByBudget` to
   * prefer high-confidence facts when the budget is tight. Optional
   * — extractors that can't estimate confidence may omit it, in
   * which case consumers default to a neutral 0.5.
   */
  readonly confidence?: number;

  /**
   * Optional taxonomy tag — free-form string like `"identity"`,
   * `"preference"`, `"commitment"`, `"fact"`. Useful for filtering
   * recall by category.
   */
  readonly category?: string;

  /**
   * Ids of the source messages this fact was extracted from. Mirrors
   * `NarrativeBeat.refs` — consumers answer "why does the agent think
   * `user.name` is Alice?" by walking back to the raw message text.
   * Optional because some extractors (pattern-based, aggregate) can't
   * reliably trace a fact to a specific message. LLM-based extractors
   * should populate it.
   */
  readonly refs?: readonly string[];
}

/** Build the stable `MemoryStore` id for a fact with the given key. */
export function factId(key: string): string {
  return `fact:${key}`;
}

/** True iff the string is a fact id (starts with the `fact:` prefix). */
export function isFactId(id: string): boolean {
  return id.startsWith('fact:');
}

/**
 * Duck-typed guard — true iff `value` has the shape of a `Fact`.
 * Used by pipelines that handle mixed-payload stores (facts +
 * beats + raw messages) to route entries correctly.
 */
export function isFact(value: unknown): value is Fact {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.key === 'string' && v.key.length > 0 && 'value' in v;
}

/**
 * Clamp a value to `[0, 1]`; non-finite → 0.5 (neutral). Matches the
 * `asImportance` convention in the beats layer so pickers can treat
 * `confidence` and `importance` the same way.
 */
export function asConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
