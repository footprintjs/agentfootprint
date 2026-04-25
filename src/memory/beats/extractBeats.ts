/**
 * extractBeats — write-side stage that compresses `scope.newMessages`
 * into `NarrativeBeat`s via a pluggable `BeatExtractor`.
 *
 * Reads from scope:  `newMessages`, `turnNumber`
 * Writes to scope:   `newBeats` (MemoryEntry<NarrativeBeat>[])
 *
 * This stage produces full `MemoryEntry<NarrativeBeat>` records so the
 * downstream write stage (a thin adapter over `writeMessages`) can
 * persist them via the ordinary `MemoryStore.putMany` batched API.
 * Entry ids are `beat-{turn}-{index}` — deterministic, idempotent on
 * re-run within the same turn (matches the `writeMessages` convention).
 *
 * The extractor is called ONCE per turn on the turn's new messages.
 * Returning an empty array is valid — not every turn produces a beat.
 */
import type { TypedScope } from 'footprintjs';
import type { LLMMessage as Message } from '../../adapters/types';
import type { MemoryEntry } from '../entry';
import type { MemoryState } from '../stages';
import type { BeatExtractor } from './extractor';
import type { NarrativeBeat } from './types';

export interface ExtractBeatsConfig {
  /** The extractor to call. See `heuristicExtractor` / `llmExtractor`. */
  readonly extractor: BeatExtractor;

  /**
   * Optional tier for the persisted beats (passed through to the write
   * stage downstream). Typical pattern: `'hot'` for recent turns,
   * `'warm'` for older, `'cold'` for archival. Omit for no tier.
   */
  readonly tier?: 'hot' | 'warm' | 'cold';

  /**
   * Optional TTL in ms from `Date.now()` applied to persisted beat
   * entries. Useful for retention windows — `'hot'` beats expire in 7
   * days, `'cold'` beats live indefinitely, etc.
   */
  readonly ttlMs?: number;

  /**
   * Optional id producer — receives `(turn, index, beat)` and returns
   * the MemoryEntry id. Defaults to `beat-{turn}-{index}` which makes
   * re-runs of the same turn idempotent.
   */
  readonly idFrom?: (turn: number, index: number, beat: NarrativeBeat) => string;
}

/** State added to `MemoryState` by this stage. */
export interface ExtractBeatsState extends MemoryState {
  /**
   * Extracted beats as complete `MemoryEntry` records, ready for a
   * downstream write stage to persist via `store.putMany`.
   */
  newBeats?: readonly MemoryEntry<NarrativeBeat>[];
}

const defaultIdFrom = (turn: number, index: number): string => `beat-${turn}-${index}`;

/**
 * Build the `extractBeats` stage function.
 *
 * ```ts
 * let b = flowChart<ExtractBeatsState>('Seed', seed, 'seed');
 * b = b.addFunction('ExtractBeats', extractBeats({ extractor }), 'extract-beats');
 * b = b.addFunction('WriteBeats', writeBeats({ store }), 'write-beats');
 * ```
 */
export function extractBeats(config: ExtractBeatsConfig) {
  const { extractor } = config;
  const idFrom = config.idFrom ?? defaultIdFrom;

  return async (scope: TypedScope<ExtractBeatsState>): Promise<void> => {
    const messages = (scope.newMessages ?? []) as readonly Message[];
    const turnNumber = scope.turnNumber ?? 1;
    const identity = scope.identity;

    if (messages.length === 0) {
      scope.newBeats = [];
      return;
    }

    const env = scope.$getEnv?.();
    const signal = env?.signal;

    const beats = await extractor.extract({
      messages,
      turnNumber,
      ...(signal ? { signal } : {}),
    });

    if (beats.length === 0) {
      scope.newBeats = [];
      return;
    }

    const now = Date.now();
    const ttl = config.ttlMs !== undefined ? now + config.ttlMs : undefined;

    const entries: MemoryEntry<NarrativeBeat>[] = beats.map((beat, index) => ({
      id: idFrom(turnNumber, index, beat),
      value: beat,
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

    scope.newBeats = entries;
  };
}
