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
import type { Embedder, EmbedArgs, EmbedBatchArgs } from './types.js';

const DEFAULT_DIMENSIONS = 32;

/**
 * Declared input ceiling (9.1.0). Not a model limit — there is no model. This
 * embedder reads every character it is given, so the number is a practical
 * bound (a megabyte of text) rather than a cliff.
 */
const MOCK_MAX_INPUT_CHARS = 1_000_000;

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
    // Named like the others so a store can refuse the swap between a mock
    // index and a real one — which is a swap worth refusing, since a corpus
    // indexed by letter frequency and queried by meaning scores nothing.
    id: 'mock',
    // Deliberately generous: this counts characters in a loop, so there is no
    // window to fall off and nothing is ever clipped. It is declared anyway
    // (rather than left absent) so a mock-first run does not report truncation
    // that only the DEFAULT ceiling believes in — a warning about a limit the
    // embedder does not have teaches the wrong lesson before the real embedder
    // is swapped in.
    maxInputChars: MOCK_MAX_INPUT_CHARS,
    async embed({ text }: EmbedArgs): Promise<number[]> {
      return charFrequency(text, dimensions);
    },
    async embedBatch({ texts }: EmbedBatchArgs): Promise<number[][]> {
      return texts.map((text) => charFrequency(text, dimensions));
    },
  };
}
