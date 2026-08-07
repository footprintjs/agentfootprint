/**
 * rag/types — the ports and value objects between a folder of documents and
 * an answering agent.
 *
 * Pattern: Ports (DocumentLoader, Splitter) + value objects (LoadedDocument,
 *          Chunk, IndexReport).
 * Role:    rag/ layer. The law this folder exists to keep is stated once,
 *          here, because everything downstream implements a piece of it:
 *          **a chunk must be able to say where it came from.** Not "which
 *          document, roughly" — which document, which characters of it, which
 *          page, under which heading. A passage the agent read and cannot
 *          locate is a passage nobody can check.
 * Emits:   N/A (types only).
 *
 * That is why `Chunk` carries offsets rather than only text, why `LoadedDocument`
 * keeps per-page text rather than one flattened string, and why every loader
 * is required to preserve positions rather than normalise them away.
 */

/** A file's raw bytes plus the path they came from, as a loader receives them. */
export interface DocumentInput {
  /** Where this came from. A filesystem path, a URL, or any stable identifier. */
  readonly uri: string;
  /** The bytes. */
  readonly bytes: Uint8Array;
  /** Last-modified time in unix ms, when the source knew one. */
  readonly mtimeMs?: number;
}

/** One document, read into text, with whatever structure the format carried. */
export interface LoadedDocument {
  /** Where this came from — the id every chunk of it will reference. */
  readonly uri: string;
  /**
   * The document's full text. Chunk offsets index into THIS string, so a
   * loader that rewrites text after computing offsets breaks provenance.
   */
  readonly text: string;
  /**
   * Per-page text, for formats that paginate (PDF). Present means the loader
   * knew page boundaries; absent means the format has none. It is never
   * fabricated — a Markdown file does not get "page 1".
   */
  readonly pages?: readonly string[];
  /** sha-256 of the raw bytes. The key incremental re-indexing skips on. */
  readonly contentHash: string;
  /** Raw byte length, before decoding. */
  readonly bytes: number;
  /** Last-modified time in unix ms, when the source knew one. */
  readonly mtimeMs?: number;
  /** Which loader read it — recorded so a bad extraction can be traced to its adapter. */
  readonly loader: string;
}

/**
 * One retrievable piece of a document, and its coordinates in it.
 *
 * `text.slice(charStart, charEnd)` on the source document must equal
 * `chunk.text`. That is not a nicety: it is what lets a citation be checked
 * against the original, and it is pinned by a property test.
 */
export interface Chunk {
  /** `'<docUri>#<index>'` — stable, human-readable, and what the model cites. */
  readonly id: string;
  /** The document this came from. */
  readonly docUri: string;
  /** 0-based position among this document's chunks. */
  readonly index: number;
  /** The chunk's text. */
  readonly text: string;
  /** Inclusive start offset into the source document's `text`. */
  readonly charStart: number;
  /** Exclusive end offset into the source document's `text`. */
  readonly charEnd: number;
  /** Page number, when the loader knew one. Never guessed. */
  readonly page?: number;
  /** The heading this chunk sits under, when the splitter tracked one. */
  readonly heading?: string;
  /** sha-256 of `text`. The key incremental re-indexing skips on, per chunk. */
  readonly contentHash: string;
}

/**
 * Turn one document's bytes into text plus the positions that text came from.
 *
 * A loader NEVER decides what a chunk is — that is the splitter's job — and
 * never embeds anything. It reads a format, and it says which formats it reads
 * so `loadDocuments` can route a folder without being told file by file.
 */
export interface DocumentLoader {
  /** Stable name. Recorded on every document it loads. */
  readonly name: string;
  /**
   * Lower-case extensions this loader handles, with the dot (`['.md', '.markdown']`).
   * `loadDocuments` routes on this; the first loader claiming an extension wins,
   * so a custom loader passed ahead of the built-ins overrides one.
   */
  readonly extensions: readonly string[];
  /** Read the bytes. Throwing is fine — the caller records the failure by uri. */
  load(input: DocumentInput): Promise<LoadedDocumentDraft>;
}

/** What a loader returns: the text and structure, without the bookkeeping. */
export interface LoadedDocumentDraft {
  readonly text: string;
  readonly pages?: readonly string[];
}

/**
 * Cut one document's text into retrievable pieces that carry their own
 * coordinates.
 *
 * A strategy, in the same shape as the window and retrieval families: a
 * factory function returning `{ name, split }`, not a `{ kind }` union. That
 * keeps the seam open — a splitter you write yourself is the same shape as the
 * ones shipped here — and keeps unused ones out of a bundle.
 */
export interface Splitter {
  /** Stable name. Recorded on the indexing run, so a re-chunk is explicable. */
  readonly name: string;
  /**
   * Cut the document. Implementations MUST return chunks whose `charStart` /
   * `charEnd` index into `doc.text`, in ascending order, non-overlapping except
   * where the strategy deliberately overlaps.
   */
  split(doc: LoadedDocument): readonly SplitPiece[];
}

/** One cut, before it is given an id and a hash. */
export interface SplitPiece {
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly heading?: string;
  readonly page?: number;
}

/**
 * Where documents come from. A discriminated union because the modes EXCLUDE:
 * a call naming both a directory and an explicit file list is a contradiction,
 * not a merge, and the type refuses it before the call is written.
 */
export type DocumentSource =
  | {
      /** Walk this directory. */
      readonly dir: string;
      /** Extensions to include, with the dot. Default: every extension a loader claims. */
      readonly include?: readonly string[];
      /** Descend into subdirectories. Default true. */
      readonly recursive?: boolean;
      readonly files?: never;
      readonly text?: never;
    }
  | {
      /** Read exactly these paths, in this order. */
      readonly files: readonly string[];
      readonly dir?: never;
      readonly include?: never;
      readonly recursive?: never;
      readonly text?: never;
    }
  | {
      /** Index a string you already have. */
      readonly text: string;
      /** The identifier it gets — chunk ids are built from it, so it is required. */
      readonly uri: string;
      readonly dir?: never;
      readonly files?: never;
      readonly include?: never;
      readonly recursive?: never;
    };

/** One document that could not be read, and why. */
export interface FailedDocument {
  readonly uri: string;
  readonly reason: string;
}

/** One chunk that exceeded the embedder's stated input ceiling. */
export interface TruncatedChunk {
  readonly id: string;
  readonly chars: number;
}

/**
 * What an indexing run did. Returned by `indexCorpus`, and — more usefully —
 * committed to the run's own commit log, so the report is EVIDENCE rather than
 * only a return value: a later reader can ask the trace what happened without
 * the caller having saved anything.
 */
export interface IndexReport {
  /** Files found by the source. */
  readonly discovered: number;
  /** Files successfully read. */
  readonly loaded: number;
  /** Chunks the splitter produced. */
  readonly chunks: number;
  /** Chunks embedded on THIS run. On a no-change re-run this is 0. */
  readonly embedded: number;
  /** Chunks already in the index with the same content and embedder. */
  readonly skipped: number;
  /** Chunks deleted because their document changed or disappeared. */
  readonly removed: number;
  /** Files that could not be read, by uri. */
  readonly failed: readonly FailedDocument[];
  /** Chunks longer than the embedder's declared ceiling — embedded, but clipped by it. */
  readonly truncated: readonly TruncatedChunk[];
  /** `'<embedderId>@<dims>'` — what this index is now fingerprinted with. */
  readonly embedderFingerprint: string;
  /** The splitter that produced the chunks. */
  readonly splitter: string;
  /** Wall-clock duration of the whole run. */
  readonly elapsedMs: number;
}
