export type {
  MemoryStore,
  ListOptions,
  ListResult,
  MemoryCursor,
  PutIfVersionResult,
  SearchOptions,
  ScoredEntry,
} from './types.js';
export { InMemoryStore } from './InMemoryStore.js';
// The declared-capability readers (9.3.0). `resolveRankingMode` is exported so
// an adapter author can check their own two declarations agree without waiting
// for a corpus builder to tell them.
export { assertServesVectors, resolveRankingMode } from './capability.js';
export {
  staticVectorStore,
  assertCorpusBundle,
  bundleEntryToMemoryEntry,
  CORPUS_BUNDLE_FORMAT,
  type CorpusBundle,
  type CorpusBundleEntry,
  type EmbedderFingerprint,
} from './staticVectorStore.js';
