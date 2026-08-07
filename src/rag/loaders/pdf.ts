/**
 * pdfLoader — PDF text extraction, page by page.
 *
 * Pattern: Adapter behind `DocumentLoader`, over a lazily-loaded optional peer.
 * Role:    rag/ layer. The ONE loader that needs a dependency, and the reason
 *          it is optional rather than bundled.
 * Emits:   N/A.
 *
 * ── Why `unpdf`, measured rather than assumed ───────────────────────────────
 * PDF text extraction cannot be done without a real library. The candidates
 * were installed and measured:
 *
 * | package | installed size | packages | deps | verdict |
 * |---|---|---|---|---|
 * | **`unpdf`** | **2.5 MB** | **1** | **none** | chosen |
 * | `pdf-parse@2` | 86 MB | 3 | `@napi-rs/canvas` (**native**) | a native binary, to read text |
 * | `pdf-parse@1` | 34 MB | 4 | debug, node-ensure | unmaintained since 2018 |
 * | `pdfjs-dist@6` | 62 MB | 2 | none | 25× the size for the same engine |
 *
 * `unpdf` is a serverless build of the same pdf.js engine the heavyweight
 * options wrap, with dual CJS/ESM exports and zero transitive dependencies.
 * A real 2-page PDF extracts in ~95 ms.
 *
 * ── Pages are the point ─────────────────────────────────────────────────────
 * It returns text PER PAGE, and that is why the page number in a citation is a
 * fact rather than a guess. `<source id="handbook.pdf#7" page="2">` can be
 * checked by opening page 2. A loader that flattened the document first could
 * only ever say "somewhere in this PDF".
 *
 * ── A known warning on Node 22 ──────────────────────────────────────────────
 * pdf.js v5 calls `Math.sumPrecise`, which arrives in V8 later than Node 22.
 * The extraction is correct; the console shows `Warning: TypeError:
 * Math.sumPrecise is not a function` per page. It is upstream and harmless,
 * and it is documented here so it does not read as data loss.
 */
import { lazyRequire } from '../../lib/lazyRequire.js';
import type { DocumentInput, DocumentLoader, LoadedDocumentDraft } from '../types.js';

/**
 * The slice of `unpdf` this loader uses — declared structurally, so a stub, a
 * pinned fork, or a future version satisfies it without this package taking a
 * hard type dependency on an optional peer.
 */
export interface UnpdfBackend {
  getDocumentProxy(data: Uint8Array): Promise<unknown>;
  extractText(
    doc: unknown,
    options?: { mergePages?: boolean },
  ): Promise<{ totalPages: number; text: string | string[] }>;
}

export interface PdfLoaderOptions {
  /**
   * An ALREADY-IMPORTED `unpdf`. Supply this and the lazy load never happens —
   * which is what makes the loader work in a BUNDLED app, where a bare
   * specifier reaches the runtime unresolved:
   *
   * ```ts
   * import * as unpdf from 'unpdf';
   * pdfLoader({ backend: unpdf });
   * ```
   *
   * The same mechanism the embedders and the store adapters use: the library
   * states the surface it needs, the host owns the construction.
   */
  readonly backend?: UnpdfBackend;
}

/** Raised when a PDF is met and `unpdf` is not installed. */
export class MissingPdfSupportError extends Error {
  readonly code = 'ERR_MISSING_PDF_SUPPORT' as const;
  /** The file that could not be read. */
  readonly uri: string;

  constructor(uri: string) {
    super(
      `Reading '${uri}' requires the \`unpdf\` peer dependency.\n` +
        '  Install:  npm install unpdf\n' +
        '  Or pass `backend` to pdfLoader() if your bundler resolves it statically.',
    );
    this.name = 'MissingPdfSupportError';
    this.uri = uri;
  }
}

export function pdfLoader(options: PdfLoaderOptions = {}): DocumentLoader {
  let backend: Promise<UnpdfBackend> | undefined;

  const getBackend = (uri: string): Promise<UnpdfBackend> => {
    if (options.backend) return Promise.resolve(options.backend);
    return (backend ??= (async (): Promise<UnpdfBackend> => {
      // `unpdf` is ESM-only in its import condition, so a dynamic import is
      // tried first and the CJS require is the fallback — one of the two works
      // on every runtime this package supports.
      try {
        const spec = 'unpdf';
        return (await import(spec)) as unknown as UnpdfBackend;
      } catch {
        try {
          return lazyRequire<UnpdfBackend>('unpdf');
        } catch {
          throw new MissingPdfSupportError(uri);
        }
      }
    })());
  };

  return {
    name: 'pdf',
    extensions: ['.pdf'],
    async load(input: DocumentInput): Promise<LoadedDocumentDraft> {
      const unpdf = await getBackend(input.uri);
      const doc = await unpdf.getDocumentProxy(input.bytes);
      const extracted = await unpdf.extractText(doc, { mergePages: false });
      const pages = Array.isArray(extracted.text)
        ? extracted.text.map((p) => String(p))
        : [String(extracted.text)];
      // Pages are joined with a blank line so `byParagraph` sees a boundary at
      // every page break — and so the offsets a splitter computes index THIS
      // string, which is the one that gets stored.
      return { text: pages.join('\n\n'), pages };
    },
  };
}
