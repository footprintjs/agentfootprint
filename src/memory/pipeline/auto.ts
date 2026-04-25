/**
 * autoPipeline — opinionated preset combining facts + beats on one store.
 *
 * The one-line default for "I want memory — just make it good."
 *
 *   READ  :  LoadAll → split by payload shape → FormatAuto
 *            (one system msg with facts block + narrative paragraph)
 *
 *   WRITE :  LoadFacts → ExtractFacts → WriteFacts
 *            → ExtractBeats → WriteBeats
 *
 * Facts carry "what's currently true" (identity, preferences,
 * commitments — dedup on key). Beats carry "what happened" (traceable
 * summaries — append-only). Together they cover the two memory shapes
 * that matter for long-running agents without forcing the consumer to
 * compose three presets by hand.
 *
 * **Default extractors**: zero-LLM-cost defaults so `autoPipeline({ store })`
 * works out of the box:
 *   - facts:  `patternFactExtractor()` (regex heuristics, free)
 *   - beats:  `heuristicExtractor()`    (keyword heuristics, free)
 *
 * Pass `provider` to upgrade BOTH to LLM-backed extractors in one
 * knob — `llmFactExtractor({ provider })` and `llmExtractor({ provider })`.
 * The same cheap model (e.g. `claude-haiku-4-5`) handles both extraction
 * calls per turn.
 *
 * **Why not include raw messages?** Raw messages come from the agent's
 * ongoing conversation state — they don't need a memory strategy. This
 * preset focuses on the two *compressed / deduplicated* shapes. Layer on
 * `defaultPipeline` or `semanticPipeline` manually if you want raw recall.
 *
 * @example
 * ```ts
 * import { Agent, anthropic } from 'agentfootprint';
 * import { autoPipeline, InMemoryStore } from 'agentfootprint/memory';
 *
 * // Free defaults — regex + heuristics, no LLM cost.
 * const pipeline = autoPipeline({ store: new InMemoryStore() });
 *
 * // Or upgrade both extractors in one knob:
 * const hq = autoPipeline({
 *   store: new InMemoryStore(),
 *   provider: anthropic('claude-haiku-4-5'),
 * });
 *
 * const agent = Agent.create({ provider: anthropic('claude-sonnet-4-5') })
 *   .system('You remember the user across turns.')
 *   .memoryPipeline(pipeline)
 *   .build();
 * ```
 */
import { flowChart, type TypedScope } from 'footprintjs';

import type { LLMProvider } from '../../adapters/types';
import type { MemoryStore } from '../store';
import type { MemoryEntry } from '../entry';
import type { LLMMessage as Message } from '../../adapters/types';
import type { MemoryPipeline } from './types';

import {
  extractFacts,
  writeFacts,
  loadFacts,
  patternFactExtractor,
  llmFactExtractor,
  isFactId,
  type Fact,
  type FactPipelineState,
  type FactExtractor,
} from '../facts';
import {
  extractBeats,
  writeBeats,
  heuristicExtractor,
  llmExtractor,
  isNarrativeBeat,
  type NarrativeBeat,
  type BeatExtractor,
  type ExtractBeatsState,
} from '../beats';

export interface AutoPipelineConfig {
  /** The store both extractors share. */
  readonly store: MemoryStore;

  /**
   * When present, upgrades both fact AND beat extraction to LLM-backed
   * variants. Typically a cheap/fast model like Claude Haiku. Omit to
   * use the free heuristic + regex defaults.
   */
  readonly provider?: LLMProvider;

  /**
   * Override the fact extractor explicitly. Takes precedence over
   * `provider`. Use when you want facts via LLM but beats via heuristic,
   * or vice-versa.
   */
  readonly factExtractor?: FactExtractor;

  /**
   * Override the beat extractor explicitly. Takes precedence over
   * `provider`.
   */
  readonly beatExtractor?: BeatExtractor;

  /**
   * Upper bound on the `store.list` page size during read. Large enough
   * to fit typical identity+history; raise for long-lived agents with
   * dozens of fact categories and hundreds of beats. Default `200`.
   */
  readonly loadLimit?: number;

  /** Tier filter for read. */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;

  /** Tier to tag newly written entries (both facts and beats). */
  readonly writeTier?: 'hot' | 'warm' | 'cold';

  /** TTL in ms applied to newly written entries. */
  readonly writeTtlMs?: number;

  /** Header for the facts block in the injected system message. */
  readonly factsHeader?: string;

  /** Lead-in phrase for the narrative paragraph. Default `"From earlier: "`. */
  readonly narrativeLeadIn?: string;

  /**
   * When `true`, appends `(conf 0.xx)` after each fact. Off by default
   * — confidence is noise for the LLM in typical flows.
   */
  readonly showConfidence?: boolean;

  /**
   * When `true`, appends `(refs: msg-x-y, ...)` after each beat line.
   * Off by default.
   */
  readonly showRefs?: boolean;
}

/** State used by the auto pipeline's subflows. */
export interface AutoPipelineState extends FactPipelineState, ExtractBeatsState {
  /** Beats loaded from the store during auto-READ. */
  loadedBeats?: readonly MemoryEntry<NarrativeBeat>[];
}

const DEFAULT_FACTS_HEADER = 'Known facts about the user:';
const DEFAULT_LEAD_IN = 'From earlier: ';
const DEFAULT_LOAD_LIMIT = 200;

/** Escape `</memory>` in user-controlled text to prevent tag-escape injection. */
function escapeMemoryTag(text: string): string {
  return text.replace(/<\/memory>/gi, '</m\u200Demory>');
}

function renderValue(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Emit a single system message combining facts (key/value block) and
 * beats (narrative paragraph). Empty sections are skipped; when BOTH
 * are empty, `formatted = []` (no injection).
 */
function renderAutoMessage(
  facts: readonly MemoryEntry<Fact>[],
  beats: readonly MemoryEntry<NarrativeBeat>[],
  opts: {
    factsHeader: string;
    leadIn: string;
    showConfidence: boolean;
    showRefs: boolean;
  },
): Message[] {
  const sections: string[] = [];

  if (facts.length > 0) {
    const lines = facts.map((entry) => {
      const f = entry.value;
      const value = escapeMemoryTag(renderValue(f.value));
      const conf =
        opts.showConfidence && typeof f.confidence === 'number'
          ? ` (conf ${f.confidence.toFixed(2)})`
          : '';
      return `- ${f.key}: ${value}${conf}`;
    });
    sections.push(`${opts.factsHeader}\n\n${lines.join('\n')}`);
  }

  if (beats.length > 0) {
    const sentences = beats.map((entry) => {
      const beat = entry.value;
      const text = escapeMemoryTag(beat.summary.trim());
      const withRefs =
        opts.showRefs && beat.refs.length > 0 ? `${text} (refs: ${beat.refs.join(', ')})` : text;
      return /[.!?]$/.test(withRefs) ? withRefs : `${withRefs}.`;
    });
    sections.push(`${opts.leadIn}${sentences.join(' ')}`);
  }

  if (sections.length === 0) return [];
  return [{ role: 'system', content: sections.join('\n\n') }];
}

export function autoPipeline(config: AutoPipelineConfig): MemoryPipeline {
  const factExtractor =
    config.factExtractor ??
    (config.provider ? llmFactExtractor({ provider: config.provider }) : patternFactExtractor());
  const beatExtractor =
    config.beatExtractor ??
    (config.provider ? llmExtractor({ provider: config.provider }) : heuristicExtractor());

  const loadLimit = config.loadLimit ?? DEFAULT_LOAD_LIMIT;
  const factsHeader = config.factsHeader ?? DEFAULT_FACTS_HEADER;
  const leadIn = config.narrativeLeadIn ?? DEFAULT_LEAD_IN;
  const showConfidence = config.showConfidence ?? false;
  const showRefs = config.showRefs ?? false;

  // ── READ subflow ────────────────────────────────────────────
  // One combined load + split stage. Keeps the subflow short and
  // avoids pulling `loadRecent` + `pickByBudget` (which were designed
  // for single-payload pipelines) into a mixed-payload context.
  const read = flowChart<AutoPipelineState>(
    'LoadAll',
    async (scope: TypedScope<AutoPipelineState>): Promise<void> => {
      const listOpts = {
        limit: loadLimit,
        ...(config.tiers && { tiers: config.tiers }),
      };
      const { entries } = await config.store.list(scope.identity, listOpts);

      const loadedFacts: MemoryEntry<Fact>[] = [];
      const loadedBeats: MemoryEntry<NarrativeBeat>[] = [];
      for (const entry of entries) {
        if (isFactId(entry.id)) {
          loadedFacts.push(entry as MemoryEntry<Fact>);
        } else if (isNarrativeBeat(entry.value)) {
          loadedBeats.push(entry as MemoryEntry<NarrativeBeat>);
        }
        // Other payloads (raw messages) are intentionally ignored —
        // auto() is the "compressed + deduped" preset.
      }

      // Stores typically return most-recently-updated first. Beats are
      // more readable oldest-first (chronological narrative), so
      // reverse before injection. Facts render as a list, order-agnostic.
      scope.loadedFacts = loadedFacts;
      scope.loadedBeats = [...loadedBeats].reverse();
    },
    'load-all',
    undefined,
    'Load facts + beats from the shared store; split by payload shape',
  )
    .addFunction(
      'FormatAuto',
      async (scope: TypedScope<AutoPipelineState>): Promise<void> => {
        const facts = (scope.loadedFacts ?? []) as readonly MemoryEntry<Fact>[];
        const beats = (scope.loadedBeats ?? []) as readonly MemoryEntry<NarrativeBeat>[];
        scope.formatted = renderAutoMessage(facts, beats, {
          factsHeader,
          leadIn,
          showConfidence,
          showRefs,
        });
      },
      'format-auto',
      'Emit one system message with facts block + narrative paragraph',
    )
    .build();

  // ── WRITE subflow ───────────────────────────────────────────
  // LoadFacts first so the (possibly LLM-backed) fact extractor sees
  // existing facts via scope.loadedFacts and can update rather than
  // duplicate. Then extract+write facts, then extract+write beats.
  const write = flowChart<AutoPipelineState>(
    'LoadFacts',
    loadFacts({
      store: config.store,
      limit: loadLimit,
      ...(config.tiers && { tiers: config.tiers }),
    }),
    'load-facts',
    undefined,
    'Surface existing facts for update-awareness',
  )
    .addFunction(
      'ExtractFacts',
      extractFacts({
        extractor: factExtractor,
        ...(config.writeTier && { tier: config.writeTier }),
        ...(config.writeTtlMs !== undefined && { ttlMs: config.writeTtlMs }),
      }),
      'extract-facts',
      'Distill scope.newMessages into stable Fact entries',
    )
    .addFunction(
      'WriteFacts',
      writeFacts({ store: config.store }),
      'write-facts',
      'Persist facts via store.putMany (overwrite on key collision)',
    )
    .addFunction(
      'ExtractBeats',
      extractBeats({
        extractor: beatExtractor,
        ...(config.writeTier && { tier: config.writeTier }),
        ...(config.writeTtlMs !== undefined && { ttlMs: config.writeTtlMs }),
      }),
      'extract-beats',
      'Compress scope.newMessages into NarrativeBeat entries',
    )
    .addFunction(
      'WriteBeats',
      writeBeats({ store: config.store }),
      'write-beats',
      'Persist beats via store.putMany',
    )
    .build();

  return { read, write };
}
