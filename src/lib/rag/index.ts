/**
 * RAG — retrieval-augmented generation as a context-engineering
 * flavor. ONE factory + ONE seeding helper. Composes over the memory
 * subsystem (semantic + top-K + strict threshold).
 */
export { defineRAG, type DefineRAGOptions } from './defineRAG.js';
export { indexDocuments, type IndexDocumentsOptions, type RagDocument } from './indexDocuments.js';
