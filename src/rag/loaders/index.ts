/**
 * rag/loaders — one adapter per format, each doing exactly one job: turn
 * bytes into text plus the positions that text came from.
 *
 * Pattern: Adapter (one per format) behind the `DocumentLoader` port.
 * Role:    rag/ layer, outermost ring. Three of the five need no dependency
 *          at all; only PDF does, and it lazy-loads a single optional peer so
 *          importing this barrel costs nothing for a consumer indexing
 *          Markdown.
 * Emits:   N/A — a loader reads a file and returns text.
 *
 * `DEFAULT_LOADERS` is the routing table `loadDocuments` uses when you pass
 * none. A loader you pass yourself is consulted FIRST, so overriding one is
 * putting yours in front rather than editing a registry.
 */
import type { DocumentLoader } from '../types.js';
import { textLoader } from './text.js';
import { markdownLoader } from './markdown.js';
import { htmlLoader } from './html.js';
import { pdfLoader } from './pdf.js';

export { textLoader } from './text.js';
export { markdownLoader } from './markdown.js';
export { htmlLoader } from './html.js';
export { pdfLoader, MissingPdfSupportError, type PdfLoaderOptions } from './pdf.js';
export { mockLoader, type MockLoaderOptions } from './mock.js';

/**
 * The loaders `loadDocuments` uses when the caller names none, in routing
 * order.
 *
 * `pdfLoader()` is in the list, but constructing it costs nothing — the
 * optional peer is loaded on the first PDF it is actually asked to read, so a
 * corpus of Markdown never touches it and never needs it installed.
 */
export const DEFAULT_LOADERS: readonly DocumentLoader[] = Object.freeze([
  markdownLoader(),
  textLoader(),
  htmlLoader(),
  pdfLoader(),
]);
