/**
 * ephemeralPipeline — read-only memory preset.
 *
 * Loads from store but NEVER writes. Use when:
 *   - The conversation is "incognito" and must not accumulate history
 *     (OpenAI-team reviewer ask: ChatGPT-style ephemeral mode).
 *   - You've pre-seeded the store externally and want the agent to
 *     consume it as read-only facts.
 *   - Compliance requires a hard no-write boundary on certain sessions.
 *
 * Implementation: identical to `defaultPipeline` on the read side; the
 * `write` subflow is deliberately omitted. `mountMemoryWrite` is a no-op
 * when write is absent, so wiring code doesn't need to branch.
 *
 * @example
 * ```ts
 * import { ephemeralPipeline, InMemoryStore } from 'agentfootprint/memory';
 *
 * const store = new InMemoryStore();
 * // Pre-seed facts the agent should know about (but cannot modify)
 * await store.put(identity, factEntry);
 *
 * const pipeline = ephemeralPipeline({ store });
 * // → { read: FlowChart, write: undefined }
 * ```
 */
import { flowChart } from 'footprintjs';

import { loadRecent, type LoadRecentConfig } from '../stages/loadRecent';
import { pickByBudget, type PickByBudgetConfig } from '../stages/pickByBudget';
import { formatDefault, type FormatDefaultConfig } from '../stages/formatDefault';
import type { MemoryState } from '../stages';
import type { MemoryStore } from '../store';
import type { MemoryPipeline } from './types';

export interface EphemeralPipelineConfig {
  /** The store to read from. Writes never happen — backend can be read-only. */
  readonly store: MemoryStore;

  /** How many recent entries to load per turn. Default 20. */
  readonly loadCount?: number;

  /** Token reserve for prompt headers / safety margin. Default 256. */
  readonly reserveTokens?: number;

  /** Minimum memory-token budget before the picker skips injection. Default 100. */
  readonly minimumTokens?: number;

  /** Hard cap on entries selected per turn. Default: no cap. */
  readonly maxEntries?: number;

  /**
   * Optional tier filter — e.g. `['hot']` to load only pre-seeded "hot"
   * entries. Omitted means all tiers.
   */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;

  /** Override for the formatter's header text. */
  readonly formatHeader?: string;

  /** Override for the formatter's footer text. */
  readonly formatFooter?: string;
}

/**
 * Build an ephemeral (read-only) pipeline. The returned object has
 * `write: undefined`; wire helpers no-op on it.
 */
export function ephemeralPipeline(config: EphemeralPipelineConfig): MemoryPipeline {
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
  const formatConfig: FormatDefaultConfig = {
    ...(config.formatHeader !== undefined && { header: config.formatHeader }),
    ...(config.formatFooter !== undefined && { footer: config.formatFooter }),
  };

  let readBuilder = flowChart<MemoryState>(
    'LoadRecent',
    loadRecent(loadConfig),
    'load-recent',
    undefined,
    'Read N most-recent entries from storage into scope.loaded (read-only)',
  );
  readBuilder = pickByBudget(pickConfig)(readBuilder);
  const read = readBuilder
    .addFunction(
      'Format',
      formatDefault(formatConfig),
      'format-default',
      'Render selected entries as a system message',
    )
    .build();

  // NO write subflow — `write` is deliberately omitted. Wire helpers
  // (`mountMemoryWrite`) check for absence and no-op. The `MemoryPipeline`
  // contract declares `write?` optional precisely for this case.
  return { read };
}
