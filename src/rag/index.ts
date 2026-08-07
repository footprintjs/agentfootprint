/**
 * rag/ — a folder of documents becomes an answering agent.
 *
 * @see ./types.ts          the ports and the value objects
 * @see ./loadDocuments.ts  step 1 — bytes to text
 * @see ./splitDocuments.ts step 2 — text to chunks that know where they came from
 * @see ./indexCorpus.ts    step 3 — the chart that embeds and stores them
 */
export {
  loadDocuments,
  type LoadDocumentsOptions,
  type LoadDocumentsResult,
} from './loadDocuments.js';
export { splitDocuments, type SplitDocumentsOptions } from './splitDocuments.js';
export { indexCorpus, buildIndexChart, type IndexCorpusConfig } from './indexCorpus.js';
export { indexFolder, type IndexFolderOptions } from './indexFolder.js';
export { sha256 } from './hash.js';

export {
  DEFAULT_LOADERS,
  textLoader,
  markdownLoader,
  htmlLoader,
  pdfLoader,
  mockLoader,
  MissingPdfSupportError,
  type PdfLoaderOptions,
  type MockLoaderOptions,
} from './loaders/index.js';
export { stripTags } from './loaders/html.js';

export {
  byParagraph,
  byHeading,
  fixedWithOverlap,
  wholeDocument,
  DEFAULT_MAX_CHARS,
  DEFAULT_OVERLAP_CHARS,
  type ByParagraphOptions,
  type ByHeadingOptions,
  type FixedWithOverlapOptions,
} from './splitters/index.js';

export type {
  Chunk,
  DocumentInput,
  DocumentLoader,
  DocumentSource,
  FailedDocument,
  IndexReport,
  LoadedDocument,
  LoadedDocumentDraft,
  Splitter,
  SplitPiece,
  TruncatedChunk,
} from './types.js';
