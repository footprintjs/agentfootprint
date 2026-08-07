/**
 * provenance — read a stored entry's coordinates back out of it.
 *
 * Pattern: pure projection.
 * Role:    memory/ layer. One place that knows which metadata keys mean
 *          "which document", "which page", "which section", so the
 *          retrieval record and the citation the model sees can never
 *          disagree about a chunk's origin.
 * Emits:   N/A.
 *
 * The keys are the ones `indexDocuments` already accepts on
 * `RagDocument.metadata`, and the ones a document splitter will write.
 * Nothing is invented: an entry that carries no metadata simply has no
 * coordinates, and the record says so by omitting the fields rather than
 * by guessing a filename from an id.
 */

/** The document coordinates a chunk can carry. All optional — absence is honest. */
export interface ChunkProvenance {
  /** Which document this text came from. Read from `docUri`, else `source`. */
  readonly docUri?: string;
  /** Which page, for paginated formats. */
  readonly page?: number;
  /** Which section heading the splitter cut under. */
  readonly heading?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Pull the coordinates out of a stored value.
 *
 * Accepts metadata at the value's `metadata` key (where `indexDocuments`
 * puts it) or directly on the value, so a hand-built entry works too.
 */
export function chunkProvenance(value: unknown): ChunkProvenance {
  const root = asRecord(value);
  if (!root) return {};
  const meta = asRecord(root['metadata']) ?? root;

  const rawDoc = meta['docUri'] ?? meta['source'];
  const docUri = typeof rawDoc === 'string' && rawDoc.length > 0 ? rawDoc : undefined;

  const rawPage = meta['page'];
  const page = typeof rawPage === 'number' && Number.isFinite(rawPage) ? rawPage : undefined;

  const rawHeading = meta['heading'];
  const heading = typeof rawHeading === 'string' && rawHeading.length > 0 ? rawHeading : undefined;

  return {
    ...(docUri !== undefined && { docUri }),
    ...(page !== undefined && { page }),
    ...(heading !== undefined && { heading }),
  };
}

/**
 * The text a stored value carries.
 *
 * THREE shapes reach the formatter through the same pipeline, and they do
 * not agree on the key:
 *
 *   • a chat `Message` (`{ role, content }`) from conversation memory;
 *   • a document (`{ id, content, metadata }`) from `indexDocuments`;
 *   • a `Chunk` (`{ id, docUri, text, charStart, … }`) from `indexCorpus`
 *     / `indexFolder`, which keeps its passage on **`text`**.
 *
 * Until 8.19.0 this read `content` only, and returned `''` for everything
 * else. That is how a chunk indexed by this library's own `rag` door
 * rendered a perfectly-formed citation — right document, right heading,
 * right score — around an EMPTY BODY. The model was handed the coordinates
 * of a passage and not the passage; a retrieval that looks like it worked
 * is the most expensive way for this to fail, because nothing in the run
 * says anything is wrong.
 *
 * So the accessor reads both keys. `content` wins when both are present:
 * it is the older meaning, and no shape this library writes carries the two
 * with different text. A value carrying NEITHER has no passage at all —
 * that is a different fact from "an unrenderable one", and it is refused at
 * WRITE time by `indexDocuments` rather than discovered as a blank citation
 * at read time.
 */
export function chunkText(value: unknown): string {
  const root = asRecord(value);
  const content = root?.['content'];
  if (typeof content === 'string') return content;
  const text = root?.['text'];
  return typeof text === 'string' ? text : '';
}
