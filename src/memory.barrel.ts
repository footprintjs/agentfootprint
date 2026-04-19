/**
 * agentfootprint/memory — subpath barrel.
 *
 * Public API for the memory system. Organized by layer:
 *   - identity + entry types (Layer 0)
 *   - MemoryStore contract + InMemoryStore reference impl (Layer 1)
 *   - reusable stages for building your own pipelines (Layers 2-3, 8)
 *   - pipeline presets (Layers 4, 7)
 *   - wire helpers for mounting pipelines into custom flowcharts (Layer 5)
 *
 * High-level consumer pattern:
 *
 *   import { Agent, mock } from 'agentfootprint';
 *   import { defaultPipeline, InMemoryStore } from 'agentfootprint/memory';
 *
 *   const pipeline = defaultPipeline({ store: new InMemoryStore() });
 *
 *   const agent = Agent.create({ provider: mock([...]) })
 *     .system('You remember what the user tells you.')
 *     .memoryPipeline(pipeline)
 *     .build();
 *
 *   await agent.run('My name is Alice', {
 *     identity: { conversationId: 'alice-session-1' },
 *   });
 */

// ── Identity ────────────────────────────────────────────────
export type { MemoryIdentity } from './memory/identity';
export { identityNamespace } from './memory/identity';

// ── Entry + decay ───────────────────────────────────────────
export type { MemoryEntry, MemorySource, DecayPolicy } from './memory/entry';
export { computeDecayFactor, computeDecayFactors } from './memory/entry';

// ── Store ───────────────────────────────────────────────────
export type {
  MemoryStore,
  ListOptions,
  ListResult,
  MemoryCursor,
  PutIfVersionResult,
} from './memory/store';
export { InMemoryStore } from './memory/store';

// ── Stages ──────────────────────────────────────────────────
export type { MemoryState } from './memory/stages';
export { loadRecent } from './memory/stages';
export type { LoadRecentConfig } from './memory/stages';
export { writeMessages } from './memory/stages';
export type { WriteMessagesConfig } from './memory/stages';
export { pickByBudget } from './memory/stages';
export type { PickByBudgetConfig } from './memory/stages';
export { formatDefault } from './memory/stages';
export type { FormatDefaultConfig } from './memory/stages';
export { summarize } from './memory/stages';
export type { SummarizeConfig } from './memory/stages';
export { approximateTokenCounter, countMessageTokens } from './memory/stages';
export type { TokenCounter } from './memory/stages';

// ── Pipelines ───────────────────────────────────────────────
export type { MemoryPipeline } from './memory/pipeline';
export { defaultPipeline } from './memory/pipeline';
export type { DefaultPipelineConfig } from './memory/pipeline';
export { ephemeralPipeline } from './memory/pipeline';
export type { EphemeralPipelineConfig } from './memory/pipeline';
export { narrativePipeline } from './memory/pipeline';
export type { NarrativePipelineConfig } from './memory/pipeline';
export { semanticPipeline } from './memory/pipeline';
export type { SemanticPipelineConfig } from './memory/pipeline';

// ── Embedding (SemanticRetrieval building blocks) ──────────
export type { Embedder, EmbedArgs, EmbedBatchArgs } from './memory/embedding';
export { cosineSimilarity, mockEmbedder } from './memory/embedding';
export type { MockEmbedderOptions } from './memory/embedding';
export { embedMessages, loadRelevant } from './memory/embedding';
export type {
  EmbedMessagesConfig,
  EmbedMessagesState,
  LoadRelevantConfig,
} from './memory/embedding';

// ── Vector search (store extensions for SemanticRetrieval) ──
export type { SearchOptions, ScoredEntry } from './memory/store';

// ── Narrative beats (NarrativeMemory building blocks) ──────
export type { NarrativeBeat, BeatImportance, BeatExtractor, ExtractArgs } from './memory/beats';
export {
  asImportance,
  isNarrativeBeat,
  heuristicExtractor,
  llmExtractor,
  extractBeats,
  writeBeats,
  formatAsNarrative,
} from './memory/beats';
export type {
  LLMExtractorConfig,
  ExtractBeatsConfig,
  ExtractBeatsState,
  WriteBeatsConfig,
  FormatAsNarrativeConfig,
} from './memory/beats';

// ── Wire helpers (for custom flowcharts) ────────────────────
export { mountMemoryRead, mountMemoryWrite, mountMemoryPipeline } from './memory/wire';
export type { MountMemoryPipelineConfig } from './memory/wire';
