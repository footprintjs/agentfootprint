/**
 * Retriever types — the contract for retrieval providers.
 * Users implement RetrieverProvider for their vector store (Pinecone, Chroma, pg_vector, etc.).
 */

import type { Message } from './messages';

export interface RetrieveOptions {
  /** Number of chunks to retrieve. */
  readonly topK?: number;
  /** Metadata filter for narrowing results. */
  readonly filter?: Record<string, unknown>;
  /** Minimum relevance score (0-1). Chunks below this are excluded. */
  readonly minScore?: number;
}

export interface RetrievalChunk {
  /** The text content of this chunk. */
  readonly content: string;
  /** Relevance score (0-1). */
  readonly score?: number;
  /** Source metadata (document ID, page number, URL, etc.). */
  readonly metadata?: Record<string, unknown>;
  /** Unique chunk identifier for citation. */
  readonly id?: string;
}

export interface RetrievalResult {
  /** Retrieved chunks, ordered by relevance. */
  readonly chunks: RetrievalChunk[];
  /** The query that was used for retrieval. */
  readonly query: string;
}

/** The retriever contract. Implement this for your vector store. */
export interface RetrieverProvider {
  retrieve(query: string, options?: RetrieveOptions): Promise<RetrievalResult>;
}

/** Result returned by RAGRunner.run(). */
export interface RAGResult {
  readonly content: string;
  readonly messages: Message[];
  readonly chunks: RetrievalChunk[];
  readonly query: string;
}
