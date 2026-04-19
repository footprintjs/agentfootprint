/**
 * defaultPipeline — the 90%-use-case memory preset.
 *
 * Composes Layer 2-3 stages into two flowchart subflows that the wire
 * layer mounts inside the agent's main flowchart:
 *
 *   READ  :  LoadRecent → PickByBudget → FormatDefault
 *   WRITE :  WriteMessages
 *
 * Why this particular composition?
 *   - Load-then-pick-then-format matches the cognitive sequence:
 *     retrieve candidates, choose what fits, present it.
 *   - Single-stage write keeps the persistence story simple for Phase 1;
 *     Phase 1.5 adds a second stage (extractFacts) to the write side.
 *
 * This preset is intentionally opinionated. Users who need more
 * control should compose their own FlowChart and pass it to
 * `.memoryPipeline()` directly — the preset is teaching code, not a
 * one-size-fits-all.
 *
 * **Build once, mount many.** Call `defaultPipeline(config)` at application
 * startup (or whenever the config changes). The returned `{read, write}`
 * are immutable compiled FlowChart objects safe to share across many
 * agent builds and many `.run()` calls. Rebuilding per-turn is wasteful —
 * the stages capture their config at build time and don't read it later.
 *
 * @example
 * ```ts
 * import { Agent, anthropic } from 'agentfootprint';
 * import { defaultPipeline, InMemoryStore } from 'agentfootprint/memory';
 *
 * const pipeline = defaultPipeline({
 *   store: new InMemoryStore(),
 *   loadCount: 20,
 *   reserveTokens: 512,
 * });
 *
 * const agent = Agent.create({ provider: anthropic('claude-sonnet-4') })
 *   .system('You are a helpful assistant.')
 *   .memoryPipeline(pipeline)
 *   .build();
 * ```
 */
import { flowChart } from 'footprintjs';

import { loadRecent, type LoadRecentConfig } from '../stages/loadRecent';
import { pickByBudget, type PickByBudgetConfig } from '../stages/pickByBudget';
import { formatDefault, type FormatDefaultConfig } from '../stages/formatDefault';
import { writeMessages, type WriteMessagesConfig } from '../stages/writeMessages';
import type { MemoryState } from '../stages';
import type { MemoryStore } from '../store';
import type { MemoryPipeline } from './types';

export interface DefaultPipelineConfig {
  /** The store both subflows share. */
  readonly store: MemoryStore;

  /** How many recent entries to load per turn. Default 20 (see loadRecent). */
  readonly loadCount?: number;

  /**
   * Token reserve for prompt headers / new user message / safety margin.
   * Default 256.
   */
  readonly reserveTokens?: number;

  /** Minimum memory-token budget before the picker skips injection. Default 100. */
  readonly minimumTokens?: number;

  /**
   * Hard cap on entries selected per turn, independent of tokens. Helps
   * with "lost-in-the-middle" degradation. Default: no cap.
   */
  readonly maxEntries?: number;

  /**
   * Optional tier constraint — e.g. `['hot']` to read only entries
   * marked `hot` by the write side. Combines with `loadCount` (cap
   * AFTER filter).
   */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;

  /**
   * Optional tier written entries are tagged with. Matches the `tiers`
   * read filter when both sides want to coordinate tier policy.
   */
  readonly writeTier?: 'hot' | 'warm' | 'cold';

  /**
   * Optional write-side TTL in milliseconds from `now`. Every written
   * entry expires this long after storage. Useful for compliance
   * retention windows.
   */
  readonly writeTtlMs?: number;

  /**
   * Override for the formatter's header text. Omit to use the default
   * "Relevant context from prior conversations..." phrasing.
   */
  readonly formatHeader?: string;

  /** Override for the formatter's footer text. Default: empty. */
  readonly formatFooter?: string;
}

/**
 * Build the default read + write pipelines sharing a single store.
 * Returns two FlowChart subflows ready to be mounted by the wire layer.
 */
export function defaultPipeline(config: DefaultPipelineConfig): MemoryPipeline {
  // Explicit per-stage config construction — keeps each stage's defaults
  // visible in the preset source (which doubles as teaching code).
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
  const writeConfig: WriteMessagesConfig = {
    store: config.store,
    ...(config.writeTier && { tier: config.writeTier }),
    ...(config.writeTtlMs !== undefined && { ttlMs: config.writeTtlMs }),
  };

  // Compose: LoadRecent → [PickDecider → skip-empty | skip-no-budget | pick] → Format
  // pickByBudget is a builder-extension — it appends a decider + 3
  // branches to the pipeline so "why did / didn't we inject memory?" is
  // answerable via FlowRecorder.onDecision evidence, not just emit events.
  let readBuilder = flowChart<MemoryState>(
    'LoadRecent',
    loadRecent(loadConfig),
    'load-recent',
    undefined,
    'Read N most-recent entries from storage into scope.loaded',
  );
  readBuilder = pickByBudget(pickConfig)(readBuilder);
  const read = readBuilder
    .addFunction(
      'Format',
      formatDefault(formatConfig),
      'format-default',
      'Render selected entries as a system message; writes scope.formatted',
    )
    .build();

  const write = flowChart<MemoryState>(
    'WriteMessages',
    writeMessages(writeConfig),
    'write-messages',
    undefined,
    'Persist new turn messages to storage',
  ).build();

  return { read, write };
}
