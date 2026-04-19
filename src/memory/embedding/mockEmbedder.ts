/**
 * mockEmbedder — deterministic character-frequency embedder for tests.
 *
 * Produces a vector of length `dimensions` (default 32) where each
 * coordinate is the count of characters whose code-point modulo
 * `dimensions` lands on that index. Same text → same vector always,
 * and texts that share characters have elevated cosine similarity.
 *
 * This is good enough for testing pipeline plumbing and basic
 * retrieval semantics (e.g. "dogs" retrieves beats mentioning "dog"
 * over beats mentioning "car"). It is NOT a real embedder — do not
 * use for anything consumer-facing.
 */
import type { Embedder, EmbedArgs, EmbedBatchArgs } from './types';

const DEFAULT_DIMENSIONS = 32;

function charFrequency(text: string, dims: number): number[] {
  const vec = new Array<number>(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[text.charCodeAt(i) % dims] += 1;
  }
  return vec;
}

export interface MockEmbedderOptions {
  readonly dimensions?: number;
}

/**
 * Build a deterministic mock embedder. Same text always yields the
 * same vector; texts sharing characters share cosine similarity.
 */
export function mockEmbedder(options: MockEmbedderOptions = {}): Embedder {
  const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`mockEmbedder: dimensions must be a positive integer (got ${dimensions})`);
  }

  return {
    dimensions,
    async embed({ text }: EmbedArgs): Promise<number[]> {
      return charFrequency(text, dimensions);
    },
    async embedBatch({ texts }: EmbedBatchArgs): Promise<number[][]> {
      return texts.map((text) => charFrequency(text, dimensions));
    },
  };
}
