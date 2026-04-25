/**
 * extractFacts — write-side stage that distills `scope.newMessages` into
 * `Fact`s via a pluggable `FactExtractor`.
 *
 * Reads from scope:  `newMessages`, `turnNumber`, optional `loadedFacts`
 * Writes to scope:   `newFacts` (MemoryEntry<Fact>[], ready for writeFacts)
 *
 * The extractor is called ONCE per turn on the turn's new messages. If
 * `scope.loadedFacts` is populated (the write subflow ran `loadFacts`
 * first), existing facts are passed to the extractor so LLM-based
 * extractors can update rather than duplicate.
 *
 * **Stable ids**: each produced entry gets id `fact:${fact.key}`. When
 * the same key is written again in a future turn, the storage layer
 * overwrites in place — no duplicate accumulation. This is the core
 * property that makes facts different from beats (append-only) and
 * messages (append-only).
 *
 * Empty-extraction behavior: `newFacts = []`. Downstream `writeFacts`
 * short-circuits on empty — no store round-trip.
 */
import type { TypedScope } from 'footprintjs';
import type { LLMMessage as Message } from '../../adapters/types';
import type { MemoryEntry } from '../entry';
import type { MemoryState } from '../stages';
import type { FactExtractor } from './extractor';
import type { Fact } from './types';
import { factId } from './types';

export interface ExtractFactsConfig {
  /** The extractor to call. See `patternFactExtractor` / `llmFactExtractor`. */
  readonly extractor: FactExtractor;

  /**
   * Optional tier for the persisted facts. Typical pattern: `'hot'` for
   * current identity / preferences, `'warm'` for older commitments.
   * Omit for no tier.
   */
  readonly tier?: 'hot' | 'warm' | 'cold';

  /**
   * Optional TTL in ms from `Date.now()` applied to persisted fact
   * entries. Useful for facts that should decay (task statuses,
   * short-term preferences). Identity facts typically have no TTL.
   */
  readonly ttlMs?: number;
}

/** State added to `MemoryState` by the fact pipeline stages. */
export interface FactPipelineState extends MemoryState {
  /** Produced by `extractFacts`, consumed by `writeFacts`. */
  newFacts?: readonly MemoryEntry<Fact>[];
  /** Produced by `loadFacts`, consumed by `formatFacts` and `extractFacts`. */
  loadedFacts?: readonly MemoryEntry<Fact>[];
}

export function extractFacts(config: ExtractFactsConfig) {
  const { extractor } = config;

  return async (scope: TypedScope<FactPipelineState>): Promise<void> => {
    const messages = (scope.newMessages ?? []) as readonly Message[];
    const turnNumber = scope.turnNumber ?? 1;
    const identity = scope.identity;

    if (messages.length === 0) {
      scope.newFacts = [];
      return;
    }

    const env = scope.$getEnv?.();
    const signal = env?.signal;

    // Pass existing facts (if loaded) to the extractor so LLM-based
    // extractors can update/refine rather than duplicate.
    const existing = (scope.loadedFacts ?? []).map((e) => e.value);

    const facts = await extractor.extract({
      messages,
      turnNumber,
      ...(existing.length > 0 ? { existing } : {}),
      ...(signal ? { signal } : {}),
    });

    if (facts.length === 0) {
      scope.newFacts = [];
      return;
    }

    const now = Date.now();
    const ttl = config.ttlMs !== undefined ? now + config.ttlMs : undefined;

    const entries: MemoryEntry<Fact>[] = facts.map((fact) => ({
      id: factId(fact.key),
      value: fact,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      ...(ttl !== undefined && { ttl }),
      ...(config.tier && { tier: config.tier }),
      source: {
        turn: turnNumber,
        identity,
      },
    }));

    scope.newFacts = entries;
  };
}
