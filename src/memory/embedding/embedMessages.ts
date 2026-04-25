/**
 * embedMessages — write-side stage that attaches an embedding vector
 * to each `MemoryEntry` in `scope.newMessages` before persistence.
 *
 * Reads from scope:  `newMessages` (Message[]) — same input as writeMessages
 * Writes to scope:   `newMessages` (with entries pre-wrapped — see note)
 *
 * Note on composition:
 *   Unlike the `extractBeats → writeBeats` pair (which produces fully
 *   wrapped `MemoryEntry<NarrativeBeat>[]`), `embedMessages` runs
 *   AFTER a packaging step and BEFORE `writeMessages`. The simplest
 *   shape is: stage writes `scope.newMessageEmbeddings: number[][]`
 *   — one vector per message — and `writeMessages` merges it into the
 *   entries it builds.
 *
 * We take the cleaner path: embed here, write the embeddings to
 * scope as a parallel array keyed by message index, and extend
 * `writeMessages` to pick them up. No reshuffle of the existing
 * write stage's contract.
 */
import type { TypedScope } from 'footprintjs';
import type { Embedder } from './types';
import type { LLMMessage as Message } from '../../adapters/types';
import type { MemoryState } from '../stages';

/** Extend MemoryState to carry per-message embeddings for writeMessages. */
export interface EmbedMessagesState extends MemoryState {
  /**
   * Per-message embedding vectors, indexed by position in `newMessages`.
   * Produced by `embedMessages`; consumed by `writeMessages` when the
   * pipeline is a semantic one.
   */
  newMessageEmbeddings?: readonly (readonly number[])[];

  /** Identifier of the embedder — carried onto entries for model-mismatch guards. */
  newMessageEmbeddingModel?: string;
}

export interface EmbedMessagesConfig {
  /** The embedder to call. Typically OpenAI / Voyage / Cohere / custom. */
  readonly embedder: Embedder;

  /**
   * Identifier for the embedder — stored on each entry's
   * `embeddingModel` so `store.search({ embedderId })` can guard
   * against cross-model pollution. Use a stable string like
   * `"openai-text-embedding-3-small"`.
   */
  readonly embedderId?: string;

  /**
   * Pull the text to embed from a message. Default: extracts the
   * message content as a string (supports both `string` content and
   * `[{ type: 'text', text: ... }]` block arrays).
   */
  readonly textFrom?: (message: Message) => string;
}

/** Default: extract plaintext from any supported content shape. */
function defaultTextFrom(message: Message): string {
  return message.content ?? '';
}

/**
 * Build the `embedMessages` stage. Prefers `embedBatch()` when the
 * embedder implements it (one round-trip for the whole turn), otherwise
 * falls back to N sequential `embed()` calls.
 */
export function embedMessages(config: EmbedMessagesConfig) {
  const { embedder } = config;
  const textFrom = config.textFrom ?? defaultTextFrom;

  return async (scope: TypedScope<EmbedMessagesState>): Promise<void> => {
    const messages = (scope.newMessages ?? []) as readonly Message[];
    if (messages.length === 0) {
      scope.newMessageEmbeddings = [];
      return;
    }

    const texts = messages.map(textFrom);
    const signal = scope.$getEnv?.()?.signal;

    let vectors: number[][];
    if (embedder.embedBatch) {
      vectors = (await embedder.embedBatch({
        texts,
        ...(signal ? { signal } : {}),
      })) as number[][];
    } else {
      vectors = await Promise.all(
        texts.map(
          (text) => embedder.embed({ text, ...(signal ? { signal } : {}) }) as Promise<number[]>,
        ),
      );
    }

    scope.newMessageEmbeddings = vectors;
    if (config.embedderId !== undefined) {
      scope.newMessageEmbeddingModel = config.embedderId;
    }
  };
}
