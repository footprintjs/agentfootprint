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
// Write options — what a write asks a managed service to do after storing it,
// in names no vendor owns. A store DECLARES what it honours and refuses the rest
// by name; `refuseUnhonouredWriteOptions` is exported so a third-party store
// refuses in the same words.
export {
  MEMORY_WRITE_OPTION_NAMES,
  NO_SERVER_EXTRACTION,
  UnsupportedMemoryWriteOptionError,
  refuseUnhonouredWriteOptions,
  requestedWriteOptions,
  type MemoryWriteOptionName,
  type MemoryNamespaceScope,
  type MemoryWriteOptions,
  type MemoryWriteOptionsConfig,
} from './writeOptions.js';
export {
  staticVectorStore,
  assertCorpusBundle,
  bundleEntryToMemoryEntry,
  CORPUS_BUNDLE_FORMAT,
  type CorpusBundle,
  type CorpusBundleEntry,
  type EmbedderFingerprint,
} from './staticVectorStore.js';
