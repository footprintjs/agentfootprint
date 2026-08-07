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
 * Two shapes reach the formatter through the same pipeline: a chat
 * `Message` (`{ role, content }`) from conversation memory, and a
 * document (`{ id, content, metadata }`) from `indexDocuments`. Both
 * keep their text on `content`, which is why one accessor serves both —
 * but only the message shape has a meaningful `role`, which is why the
 * corpus formatter does not print one.
 */
export function chunkText(value: unknown): string {
  const root = asRecord(value);
  const content = root?.['content'];
  return typeof content === 'string' ? content : '';
}
