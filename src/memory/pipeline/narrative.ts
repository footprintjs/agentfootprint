/**
 * narrativePipeline — beats-based memory preset.
 *
 * Compresses each turn into `NarrativeBeat`s on write, recalls them
 * as a story paragraph on read. Two subflows, shared store:
 *
 *   READ  :  LoadRecent → PickByBudget → FormatAsNarrative
 *   WRITE :  ExtractBeats → WriteBeats
 *
 * Contrast with `defaultPipeline` (raw messages, block-formatted) —
 * the read side is structurally identical; only the format stage and
 * write path differ. `LoadRecent` + `PickByBudget` don't care whether
 * the entry payload is a `Message` or a `NarrativeBeat` — they operate
 * on `MemoryEntry<T>` generically.
 *
 * **Why narrative memory?**
 *   Raw-message recall grows linearly with conversation length and
 *   loses salience signal. Beats compress 100 turns of chat into
 *   ~20 summary sentences, each with `refs[]` traceable back to the
 *   source messages. The picker prefers high-importance beats; the
 *   formatter composes them into a single cohesive paragraph.
 *
 * **Default extractor**: `heuristicExtractor()` — zero-dep, zero-cost.
 * Produces sensible-but-baseline beats. Opt into `llmExtractor({ provider })`
 * when you want semantic quality.
 *
 * @example
 * Most consumers reach for `narrativePipeline` indirectly through
 * `defineMemory({ type: MEMORY_TYPES.NARRATIVE, strategy: { kind:
 * MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' | 'llm' }, store })`.
 *
 * @example Direct usage (low-level — custom flowchart composition):
 * ```ts
 * import { narrativePipeline, llmExtractor, InMemoryStore } from 'agentfootprint/memory';
 *
 * // Cheap default — heuristic beats, no LLM cost.
 * const pipeline = narrativePipeline({ store: new InMemoryStore() });
 *
 * // Or opt into LLM-backed beats (pass any LLMProvider):
 * const pipelineHQ = narrativePipeline({
 *   store: new InMemoryStore(),
 *   extractor: llmExtractor({ provider: yourLLMProvider }),
 * });
 * ```
 */
import { flowChart } from 'footprintjs';

import { loadRecent, type LoadRecentConfig } from '../stages/loadRecent';
import { pickByBudget, type PickByBudgetConfig } from '../stages/pickByBudget';
import type { MemoryState } from '../stages';
import type { MemoryStore } from '../store';
import type { MemoryPipeline } from './types';

import {
  extractBeats,
  type ExtractBeatsConfig,
  type ExtractBeatsState,
} from '../beats/extractBeats';
import { writeBeats } from '../beats/writeBeats';
import { formatAsNarrative, type FormatAsNarrativeConfig } from '../beats/formatAsNarrative';
import { heuristicExtractor } from '../beats/heuristicExtractor';
import type { BeatExtractor } from '../beats/extractor';

export interface NarrativePipelineConfig {
  /** The store both subflows share. */
  readonly store: MemoryStore;

  /**
   * Beat extractor. Defaults to `heuristicExtractor()` — zero-dep,
   * zero-cost, baseline quality. Swap for `llmExtractor({ provider })`
   * for semantic quality.
   */
  readonly extractor?: BeatExtractor;

  /** Forwarded to `loadRecent` (how many beats to consider per turn). */
  readonly loadCount?: number;

  /** Forwarded to `pickByBudget`. */
  readonly reserveTokens?: number;
  readonly minimumTokens?: number;
  readonly maxEntries?: number;

  /** Tier filter for read (e.g. `['hot']`). */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;

  /** Tier to tag written beats with. */
  readonly writeTier?: 'hot' | 'warm' | 'cold';

  /** Optional TTL for written beats (ms from write time). */
  readonly writeTtlMs?: number;

  /** Forwarded to `formatAsNarrative`. */
  readonly formatHeader?: string;
  readonly formatFooter?: string;
  readonly formatShowRefs?: boolean;
  readonly formatLeadIn?: string;
}

/**
 * Build the narrative read + write pipelines sharing a single store.
 * Returns `{ read, write }` ready to be passed to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).
 */
export function narrativePipeline(config: NarrativePipelineConfig): MemoryPipeline {
  const extractor = config.extractor ?? heuristicExtractor();

  const loadConfig: LoadRecentConfig = {
    store: config.store,
    ...(config.loadCount !== undefined && { count: config.loadCount }),
    ...(config.tiers && { tiers: config.tiers }),
  };
  const pickConfig: PickByBudgetConfig = {
    ...(config.reserveTokens !== undefined && { reserveTokens: config.reserveTokens }),
    ...(config.minimumTokens !== undefined && { minimumTokens: config.minimumTokens }),
    ...(config.maxEntries !== undefined && { maxEntries: config.maxEntries }),
  };
  const formatConfig: FormatAsNarrativeConfig = {
    ...(config.formatHeader !== undefined && { header: config.formatHeader }),
    ...(config.formatFooter !== undefined && { footer: config.formatFooter }),
    ...(config.formatShowRefs !== undefined && { showRefs: config.formatShowRefs }),
    ...(config.formatLeadIn !== undefined && { leadIn: config.formatLeadIn }),
  };
  const extractConfig: ExtractBeatsConfig = {
    extractor,
    ...(config.writeTier && { tier: config.writeTier }),
    ...(config.writeTtlMs !== undefined && { ttlMs: config.writeTtlMs }),
  };

  // ── Read subflow: LoadRecent → PickByBudget (decider + 3 branches) → FormatAsNarrative
  let readBuilder = flowChart<MemoryState>(
    'LoadRecent',
    loadRecent(loadConfig),
    'load-recent',
    undefined,
    'Load N most-recent beats from storage into scope.loaded',
  );
  readBuilder = pickByBudget(pickConfig)(readBuilder);
  const read = readBuilder
    .addFunction(
      'Format',
      formatAsNarrative(formatConfig),
      'format-as-narrative',
      'Compose selected beats into a story paragraph; writes scope.formatted',
    )
    .build();

  // ── Write subflow: ExtractBeats → WriteBeats
  const write = flowChart<ExtractBeatsState>(
    'ExtractBeats',
    extractBeats(extractConfig),
    'extract-beats',
    undefined,
    'Compress scope.newMessages into NarrativeBeat entries',
  )
    .addFunction(
      'WriteBeats',
      writeBeats({ store: config.store }),
      'write-beats',
      'Batch-persist extracted beats via store.putMany',
    )
    .build();

  return { read, write };
}
