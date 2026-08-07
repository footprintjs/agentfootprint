/**
 * mockLoader — a loader with no filesystem and no format, for tests.
 *
 * Pattern: Adapter behind `DocumentLoader`.
 * Role:    rag/ layer. The first rung of the mock-first ladder for indexing:
 *          prove the pipeline runs — discover, split, plan, embed, store,
 *          report — before a single real file or a single real embedding is
 *          involved.
 * Emits:   N/A.
 *
 * It claims whatever extensions you give it (default: everything a test is
 * likely to name), and returns the text you handed it. Unlike the other
 * loaders it never touches bytes at all, which is exactly what makes it
 * useful: a test can assert on chunking and planning without a temp directory.
 */
import type { DocumentInput, DocumentLoader, LoadedDocumentDraft } from '../types.js';
import { decodeText } from './text.js';

export interface MockLoaderOptions {
  /** Extensions to claim. Default: a broad set, so routing is never the thing under test. */
  readonly extensions?: readonly string[];
  /**
   * Return text for a uri, instead of decoding the bytes. Use for a fixture
   * corpus that exists only in the test file.
   */
  readonly textFor?: (uri: string) => string | undefined;
  /** Pretend this uri is paginated — for exercising page provenance without a PDF. */
  readonly pagesFor?: (uri: string) => readonly string[] | undefined;
}

export function mockLoader(options: MockLoaderOptions = {}): DocumentLoader {
  return {
    name: 'mock',
    extensions: options.extensions ?? ['.md', '.txt', '.html', '.pdf', '.mock'],
    // eslint-disable-next-line @typescript-eslint/require-await
    async load(input: DocumentInput): Promise<LoadedDocumentDraft> {
      const pages = options.pagesFor?.(input.uri);
      const text = options.textFor?.(input.uri) ?? decodeText(input.bytes);
      return { text: pages ? pages.join('\n\n') : text, ...(pages && { pages }) };
    },
  };
}
