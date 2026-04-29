/**
 * Memory subsystem — narrative beats, fact extraction, embedding-based
 * retrieval, and pipelines that compose them.
 *
 * Re-exported from agentfootprint's main entry. See individual module
 * READMEs for usage.
 */

export * from './beats/index.js';
export * from './causal/index.js';
export * from './embedding/index.js';
export * from './entry/index.js';
export * from './facts/index.js';
export * from './identity/index.js';
export * from './pipeline/index.js';
export * from './stages/index.js';
export * from './store/index.js';
export * from './wire/index.js';

// Consumer-facing factory + const-objects for memory configuration.
export {
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  MEMORY_TIMING,
  SNAPSHOT_PROJECTIONS,
  MEMORY_INJECTION_KEY_PREFIX,
  isMemoryType,
  isMemoryStrategyKind,
  isMemoryTiming,
  isSnapshotProjection,
  memoryInjectionKey,
  isMemoryInjectionKey,
  type MemoryType,
  type MemoryStrategyKind,
  type MemoryTiming,
  type SnapshotProjection,
  type Strategy,
  type WindowStrategy,
  type BudgetStrategy,
  type SummarizeStrategy,
  type TopKStrategy,
  type ExtractStrategy,
  type DecayStrategy,
  type HybridStrategy,
  type MemoryDefinition,
  type DefineMemoryOptions,
  type DefineEpisodicOptions,
  type DefineSemanticOptions,
  type DefineNarrativeOptions,
  type DefineCausalOptions,
  type MemoryRedactionPolicy,
} from './define.types.js';
export { defineMemory } from './define.js';
