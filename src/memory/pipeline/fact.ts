/**
 * factPipeline — key/value fact memory preset.
 *
 * Distills stable user claims out of each turn and recalls them as a
 * compact key/value block. Complements `narrativePipeline` (beats are
 * "what happened") — facts are "what's true right now."
 *
 *   READ   :  LoadFacts → FormatFacts
 *   WRITE  :  LoadFacts → ExtractFacts → WriteFacts
 *
 * Why `LoadFacts` on BOTH sides?
 *   - Read side: obvious — inject what we know.
 *   - Write side: surfaces existing facts to the extractor via
 *     `scope.loadedFacts`, so LLM-based extractors can UPDATE rather
 *     than duplicate. Costs one extra `store.list` per turn; saves
 *     many LLM-emitted duplicate facts.
 *
 * **Default extractor**: `patternFactExtractor()` — zero-dep, zero-cost
 * regex heuristics for common identity / contact disclosures. Opt into
 * `llmFactExtractor({ provider })` when you want semantic-quality
 * extraction (preferences, commitments, task statuses).
 *
 * **Stable ids**: every fact is stored under `fact:${key}`, so writing
 * `user.name = "Alice"` twice in two turns produces ONE entry in the
 * store, not two. Updates overwrite in place — there's no
 * accumulation, no "fact history" by default. Consumers who need fact
 * history should run `narrativePipeline` alongside.
 *
 * Most consumers reach for `factPipeline` indirectly through
 * `defineMemory({ type: MEMORY_TYPES.SEMANTIC, strategy: { kind:
 * MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' | 'llm' }, store })`.
 *
 * @example Direct usage (low-level — custom flowchart composition):
 * ```ts
 * import { factPipeline, llmFactExtractor, InMemoryStore } from 'agentfootprint/memory';
 *
 * // Cheap default — regex heuristics, no LLM cost.
 * const pipeline = factPipeline({ store: new InMemoryStore() });
 *
 * // Or opt into LLM-backed extraction (pass any LLMProvider):
 * const hqPipeline = factPipeline({
 *   store: new InMemoryStore(),
 *   extractor: llmFactExtractor({ provider: yourLLMProvider }),
 * });
 * ```
 */
import { flowChart } from 'footprintjs';

import type { MemoryStore } from '../store';
import type { MemoryPipeline } from './types';

import {
  extractFacts,
  type ExtractFactsConfig,
  type FactPipelineState,
} from '../facts/extractFacts';
import { writeFacts } from '../facts/writeFacts';
import { loadFacts, type LoadFactsConfig } from '../facts/loadFacts';
import { formatFacts, type FormatFactsConfig } from '../facts/formatFacts';
import { patternFactExtractor } from '../facts/patternFactExtractor';
import type { FactExtractor } from '../facts/extractor';

export interface FactPipelineConfig {
  /** The store both subflows share. */
  readonly store: MemoryStore;

  /**
   * Fact extractor. Defaults to `patternFactExtractor()` — zero-dep,
   * zero-cost, baseline quality. Swap for
   * `llmFactExtractor({ provider })` for semantic quality.
   */
  readonly extractor?: FactExtractor;

  /** Forwarded to `loadFacts` (upper bound on `list` page size). */
  readonly loadLimit?: number;

  /** Tier filter for read (e.g. `['hot']`). */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;

  /** Tier to tag written facts with. */
  readonly writeTier?: 'hot' | 'warm' | 'cold';

  /** Optional TTL for written facts (ms from write time). */
  readonly writeTtlMs?: number;

  /** Forwarded to `formatFacts`. */
  readonly formatHeader?: string;
  readonly formatFooter?: string;
  readonly formatShowConfidence?: boolean;
}

export function factPipeline(config: FactPipelineConfig): MemoryPipeline {
  const extractor = config.extractor ?? patternFactExtractor();

  const loadConfig: LoadFactsConfig = {
    store: config.store,
    ...(config.loadLimit !== undefined && { limit: config.loadLimit }),
    ...(config.tiers && { tiers: config.tiers }),
  };
  const formatConfig: FormatFactsConfig = {
    ...(config.formatHeader !== undefined && { header: config.formatHeader }),
    ...(config.formatFooter !== undefined && { footer: config.formatFooter }),
    ...(config.formatShowConfidence !== undefined && {
      showConfidence: config.formatShowConfidence,
    }),
  };
  const extractConfig: ExtractFactsConfig = {
    extractor,
    ...(config.writeTier && { tier: config.writeTier }),
    ...(config.writeTtlMs !== undefined && { ttlMs: config.writeTtlMs }),
  };

  // ── Read subflow: LoadFacts → FormatFacts
  const read = flowChart<FactPipelineState>(
    'LoadFacts',
    loadFacts(loadConfig),
    'load-facts',
    undefined,
    'Load stored Fact entries (ids starting with `fact:`) into scope.loadedFacts',
  )
    .addFunction(
      'FormatFacts',
      formatFacts(formatConfig),
      'format-facts',
      'Render loaded facts as one system message; writes scope.formatted',
    )
    .build();

  // ── Write subflow: LoadFacts → ExtractFacts → WriteFacts
  // LoadFacts first so llmFactExtractor can see existing facts and
  // update rather than duplicate.
  const write = flowChart<FactPipelineState>(
    'LoadFacts',
    loadFacts(loadConfig),
    'load-facts-for-extract',
    undefined,
    'Surface existing facts to the extractor for update-awareness',
  )
    .addFunction(
      'ExtractFacts',
      extractFacts(extractConfig),
      'extract-facts',
      'Distill scope.newMessages into Fact entries',
    )
    .addFunction(
      'WriteFacts',
      writeFacts({ store: config.store }),
      'write-facts',
      'Batch-persist extracted facts via store.putMany (overwrite on key collision)',
    )
    .build();

  return { read, write };
}
