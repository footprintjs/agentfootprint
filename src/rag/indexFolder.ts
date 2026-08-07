/**
 * indexFolder — the one-call version, over the same pieces.
 *
 * Pattern: sugar. It composes `indexCorpus` and adds nothing the pieces do not
 *          already do — which is the test a convenience has to pass here: if
 *          it could not be written by a consumer in five lines using the
 *          public API, it is hiding something instead of shortening it.
 * Role:    rag/ layer.
 * Emits:   whatever `indexCorpus` emits.
 *
 * The only judgement it adds is the splitter default, and it is the judgement
 * you would make yourself: a folder of Markdown gets `byHeading` (the document
 * declares its own sections), anything else gets `byParagraph`. Name a
 * `splitter` and that guess is not made.
 *
 * @example
 * ```ts
 * const report = await indexFolder('./docs', {
 *   to: sqliteVectorStore({ file: './corpus.db' }),
 *   embedder: staticEmbedder(),
 * });
 * console.log(`${report.embedded} embedded, ${report.skipped} skipped`);
 * ```
 */
import { indexCorpus, type IndexCorpusConfig } from './indexCorpus.js';
import { byHeading } from './splitters/byHeading.js';
import { byParagraph } from './splitters/byParagraph.js';
import type { IndexReport } from './types.js';

export interface IndexFolderOptions
  extends Omit<IndexCorpusConfig, 'source' | 'store' | 'splitter'> {
  /** The store to index into. Named `to` because that is what it reads as. */
  readonly to: IndexCorpusConfig['store'];
  /** Extensions to include, with the dot. Default: everything a loader claims. */
  readonly include?: readonly string[];
  /** Descend into subdirectories. Default true. */
  readonly recursive?: boolean;
  /**
   * How to cut. Omitted, a folder that is mostly Markdown gets `byHeading()`
   * and anything else gets `byParagraph()`.
   */
  readonly splitter?: IndexCorpusConfig['splitter'];
}

export async function indexFolder(dir: string, options: IndexFolderOptions): Promise<IndexReport> {
  const { to, include, recursive, splitter, ...rest } = options;
  const looksLikeMarkdown =
    include === undefined || include.some((e) => e === '.md' || e === '.markdown');

  return indexCorpus({
    ...rest,
    source: {
      dir,
      ...(include && { include }),
      ...(recursive !== undefined && { recursive }),
    },
    store: to,
    splitter: splitter ?? (looksLikeMarkdown ? byHeading() : byParagraph()),
  });
}
