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
export * from './retrieval/index.js';

// Consumer-facing factory + const-objects for memory configuration.
export {
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  MEMORY_TIMING,
  SNAPSHOT_PROJECTIONS,
  MEMORY_INJECTION_KEY_PREFIX,
  RETRIEVAL_EVIDENCE_KEY_PREFIX,
  isMemoryType,
  isMemoryStrategyKind,
  isMemoryTiming,
  isSnapshotProjection,
  memoryInjectionKey,
  isMemoryInjectionKey,
  retrievalEvidenceKey,
  isRetrievalEvidenceKey,
  type MemoryType,
  type MemoryStrategyKind,
  type MemoryTiming,
  type SnapshotProjection,
  type Strategy,
  type MemoryWindowStrategy,
  type BudgetStrategy,
  type SummarizeStrategy,
  type TopKStrategy,
  type TopKShorthandStrategy,
  type TopKRetrievalStrategy,
  type MemoryFlavor,
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
// `WindowStrategy` was this module's 7.27.0 name for `MemoryWindowStrategy`.
// It collided with the CONVERSATION-window seam of the same name on the
// package root (`{ name, plan(input) }`) — same name, two entry points,
// incompatible shapes — so the memory one was renamed in 7.27.1 and the old
// spelling kept as a deprecated alias. 9.0.0 removed the alias:
// `MemoryWindowStrategy` is the only name for `{ kind: 'window', size }`.

export { defineMemory } from './define.js';
